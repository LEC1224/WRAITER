const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash, atomicWrite, validateProject } = require('./core.cjs');

const PAGE_BYTES = 512 * 1024;
const PAGE_EVENTS = 1024;
const newIndex = () => ({ offsets: [], bytes: 0, generation: randomUUID() });
function records(text) { return text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); }

// Retain byte offsets, not a second object graph for the renderer's undo history.
// Validate every record before publishing its count, including count-only saves.
async function indexFile(target) {
  const index = newIndex();
  let handle;
  try { handle = await fs.open(target, 'r'); }
  catch (error) { if (error.code === 'ENOENT') return index; throw error; }
  let start = 0, fragments = [], interrupted = false;
  function indexLine(bytes) {
    const text = bytes.toString('utf8');
    if (!text.trim()) return;
    if (JSON.parse(text).sequence !== index.offsets.length + 1) throw new Error('Invalid sequence');
    index.offsets.push(start);
  }
  try {
    for await (const chunk of handle.createReadStream({ highWaterMark: PAGE_BYTES, autoClose: false })) {
      let from = 0;
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, from)) {
        const tail = chunk.subarray(from, end);
        try { indexLine(fragments.length ? Buffer.concat([...fragments, tail]) : tail); }
        catch { throw Object.assign(new Error('Editing history contains an unreadable record. The original journal was preserved.'), { code: 'CORRUPT_JOURNAL' }); }
        fragments = []; from = end + 1; start = index.bytes + from;
      }
      if (from < chunk.length) fragments.push(chunk.subarray(from));
      index.bytes += chunk.length;
    }
    if (fragments.length) {
      try { indexLine(Buffer.concat(fragments)); }
      catch { interrupted = true; }
    }
  } finally { await handle.close(); }
  if (fragments.length) {
    // Preserve the exact interrupted file before dropping only its incomplete
    // final record. A valid final record without a newline merely needs a separator.
    if (interrupted) {
      const archive = `${target}.interrupted-${randomUUID()}`;
      await fs.copyFile(target, archive, require('node:fs').constants.COPYFILE_EXCL);
      await syncFile(archive);
    }
    const repair = await fs.open(target, interrupted ? 'r+' : 'a');
    try {
      if (interrupted) { await repair.truncate(start); index.bytes = start; }
      else { await repair.writeFile('\n'); index.bytes++; }
      await repair.sync();
    } finally { await repair.close(); }
  }
  return index;
}

async function readRange(target, from, to) {
  const handle = await fs.open(target, 'r');
  try {
    const buffer = Buffer.allocUnsafe(to - from);
    for (let offset = 0; offset < buffer.length;) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, from + offset);
      if (!bytesRead) throw new Error('The editing journal changed while it was being read.');
      offset += bytesRead;
    }
    return buffer.toString('utf8');
  } finally { await handle.close(); }
}

async function syncFile(target) {
  const handle = await fs.open(target, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

class EditJournal {
  constructor(directory) { this.directory = path.join(directory, 'Edit history'); this.cache = new Map(); this.needsSync = new Set(); }
  filename(projectId) { return path.join(this.directory, `${hash(projectId)}.jsonl`); }
  async index(projectId) {
    if (typeof projectId !== 'string' || !projectId || projectId.length > 200) throw new Error('Invalid history document.');
    if (this.needsSync.has(projectId)) {
      // A write can reach the filesystem and still fail its flush. A retry
      // must never publish those bytes as a durable recovery checkpoint yet.
      await syncFile(this.filename(projectId));
      this.needsSync.delete(projectId);
    }
    if (!this.cache.has(projectId)) {
      const pending = indexFile(this.filename(projectId));
      this.cache.set(projectId, pending);
      try { return await pending; }
      catch (error) { if (this.cache.get(projectId) === pending) this.cache.delete(projectId); throw error; }
    }
    return this.cache.get(projectId);
  }
  async readPage(projectId, from = 0, snapshot) {
    const index = await this.index(projectId);
    const totalEvents = snapshot?.totalEvents ?? index.offsets.length;
    if ((snapshot && snapshot.generation !== index.generation) || !Number.isSafeInteger(totalEvents) || totalEvents < 0 || totalEvents > index.offsets.length || !Number.isSafeInteger(from) || from < 0 || from > totalEvents) throw new Error('The editing history changed during loading.');
    let next = from;
    while (next < totalEvents && next - from < PAGE_EVENTS && (next === from || (index.offsets[next + 1] ?? index.bytes) - index.offsets[from] <= PAGE_BYTES)) next++;
    const text = next === from ? '' : await readRange(this.filename(projectId), index.offsets[from], index.offsets[next] ?? index.bytes);
    return { text, next, totalEvents, generation: index.generation };
  }
  async read(projectId, sequence = Infinity) {
    const index = await this.index(projectId), totalEvents = index.offsets.length;
    const snapshot = { totalEvents: Math.max(0, Math.min(totalEvents, Math.floor(sequence))), generation: index.generation };
    const events = [];
    for (let from = 0; from < snapshot.totalEvents;) {
      const page = await this.readPage(projectId, from, snapshot);
      events.push(...records(page.text)); from = page.next;
    }
    return { events, totalEvents };
  }
  async append(projectId, supplied = [], expectedSequence) {
    if (!Array.isArray(supplied)) throw new Error('Invalid editing history.');
    const index = await this.index(projectId), target = this.filename(projectId);
    if (expectedSequence !== undefined && index.offsets.length !== expectedSequence) return null;
    const additions = [], offsets = [];
    let bytes = index.bytes, existingPage, pageStart;
    for (const event of supplied) {
      if (!event || !Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error('Invalid editing history event.');
      const serialized = JSON.stringify(event);
      if (event.sequence <= index.offsets.length) {
        const position = event.sequence - 1;
        if (!existingPage || position < pageStart || position >= pageStart + existingPage.length) {
          const page = await this.readPage(projectId, position);
          existingPage = records(page.text); pageStart = position;
        }
        if (JSON.stringify(existingPage[position - pageStart]) !== serialized) throw new Error('An earlier history record cannot be overwritten.');
        continue;
      }
      if (event.sequence !== index.offsets.length + additions.length + 1) throw new Error('Editing history is missing an earlier event.');
      const length = Buffer.byteLength(serialized);
      if (length > 100 * 1024 * 1024) throw new Error('This edit exceeds the history record limit.');
      offsets.push(bytes); bytes += length + 1; additions.push(serialized);
    }
    if (additions.length) {
      await fs.mkdir(this.directory, { recursive: true });
      const handle = await fs.open(target, 'a');
      try {
        if ((await handle.stat()).size !== index.bytes) throw new Error('The editing journal changed before its next edit could be saved.');
        await handle.writeFile(additions.join('\n') + '\n'); await handle.sync();
      } catch (error) { this.cache.delete(projectId); this.needsSync.add(projectId); throw error; }
      finally { await handle.close(); }
      for (const offset of offsets) index.offsets.push(offset);
      index.bytes = bytes;
    }
    return { sequence: index.offsets.length };
  }
  async restart(project, initial, reason = '') {
    validateProject(project);
    if (initial?.kind !== 'init' || initial.version !== 1 || initial.sequence !== 1 || initial.projectId !== project.id || !/^(?:v2:)?[a-f0-9]{16}:\d+$/.test(initial.fingerprint || '') || typeof initial.timestamp !== 'string' || !Number.isFinite(Date.parse(initial.timestamp))) throw new Error('Invalid replacement history baseline.');
    // Copy the exact prior journal and the current document before installing a
    // new baseline. A mismatch never authorizes replaying or deleting old edits.
    const target = this.filename(project.id), archive = `${target}.preserved-${Date.now()}-${require('node:crypto').randomUUID()}`;
    await fs.mkdir(this.directory, { recursive: true });
    let archived = false;
    try {
      await fs.copyFile(target, archive, require('node:fs').constants.COPYFILE_EXCL);
      const handle = await fs.open(archive, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      archived = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await atomicWrite(`${archive}.snapshot.json`, JSON.stringify({ project, reason, timestamp: new Date().toISOString(), previousJournal: archived ? archive : null }));
    await atomicWrite(target, JSON.stringify(initial) + '\n');
    this.cache.delete(project.id); this.needsSync.delete(project.id);
    return { sequence: 1, preservedPath: archived ? archive : `${archive}.snapshot.json` };
  }
}
module.exports = { EditJournal };
