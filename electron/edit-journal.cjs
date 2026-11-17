const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash, atomicWrite, validateProject } = require('./core.cjs');

const PAGE_BYTES = 512 * 1024;
const PAGE_EVENTS = 1024;
const APPEND_EXISTING = constants.O_APPEND | constants.O_WRONLY;
const newIndex = () => ({ offsets: [], bytes: 0, signature: null, generation: randomUUID() });
function records(text) { return text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); }
const changedJournal = () => Object.assign(new Error('The editing journal changed on disk. Please try again.'), { code: 'JOURNAL_CHANGED' });
const signatureOf = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
async function verifyPath(target, expected) {
  let actual = null;
  try { actual = signatureOf(await fs.stat(target, { bigint: true })); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (actual !== expected) throw changedJournal();
}

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
    index.signature = signatureOf(await handle.stat({ bigint: true }));
    for await (const chunk of handle.createReadStream({ highWaterMark: PAGE_BYTES, autoClose: false })) {
      let from = 0;
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, from)) {
        const tail = chunk.subarray(from, end);
        try { indexLine(fragments.length ? Buffer.concat([...fragments, tail]) : tail); }
        catch {
          // A sync client can replace the file or change its bytes while it
          // is being indexed. Only report corruption from a stable file.
          await verifyPath(target, index.signature);
          throw Object.assign(new Error('Editing history contains an unreadable record. The original journal was preserved.'), { code: 'CORRUPT_JOURNAL' });
        }
        fragments = []; from = end + 1; start = index.bytes + from;
      }
      if (from < chunk.length) fragments.push(chunk.subarray(from));
      index.bytes += chunk.length;
    }
    if (fragments.length) {
      try { indexLine(Buffer.concat(fragments)); }
      catch { interrupted = true; }
    }
    await verifyPath(target, index.signature);
  } finally { await handle.close(); }
  if (fragments.length) {
    // Preserve the exact interrupted file before dropping only its incomplete
    // final record. A valid final record without a newline merely needs a separator.
    if (interrupted) {
      const archive = `${target}.interrupted-${randomUUID()}`;
      await fs.copyFile(target, archive, constants.COPYFILE_EXCL);
      await syncFile(archive);
    }
    const repair = await fs.open(target, interrupted ? 'r+' : APPEND_EXISTING);
    try {
      if (signatureOf(await repair.stat({ bigint: true })) !== index.signature) throw changedJournal();
      if (interrupted) { await repair.truncate(start); index.bytes = start; }
      else { await repair.writeFile('\n'); index.bytes++; }
      await repair.sync();
      const repaired = await repair.stat({ bigint: true });
      if (Number(repaired.size) !== index.bytes) throw changedJournal();
      index.signature = signatureOf(repaired);
    } finally { await repair.close(); }
    await verifyPath(target, index.signature);
  }
  return index;
}

async function readRange(target, from, to, expected) {
  let handle;
  try { handle = await fs.open(target, 'r'); }
  catch (error) { if (error.code === 'ENOENT') throw changedJournal(); throw error; }
  try {
    if (signatureOf(await handle.stat({ bigint: true })) !== expected) throw changedJournal();
    const buffer = Buffer.allocUnsafe(to - from);
    for (let offset = 0; offset < buffer.length;) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, from + offset);
      if (!bytesRead) throw changedJournal();
      offset += bytesRead;
    }
    await verifyPath(target, expected);
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
  async index(projectId, verify = true) {
    if (typeof projectId !== 'string' || !projectId || projectId.length > 200) throw new Error('Invalid history document.');
    if (this.needsSync.has(projectId)) {
      // A write can reach the filesystem and still fail its flush. A retry
      // must never publish those bytes as a durable recovery checkpoint yet.
      await syncFile(this.filename(projectId));
      this.needsSync.delete(projectId);
    }
    const target = this.filename(projectId);
    if (!this.cache.has(projectId)) this.cache.set(projectId, indexFile(target));
    const pending = this.cache.get(projectId);
    try {
      const index = await pending;
      if (verify) await verifyPath(target, index.signature);
      return index;
    } catch (error) { if (this.cache.get(projectId) === pending) this.cache.delete(projectId); throw error; }
  }
  async readPage(projectId, from = 0, snapshot) {
    const index = await this.index(projectId, false);
    const totalEvents = snapshot?.totalEvents ?? index.offsets.length;
    if ((snapshot && snapshot.generation !== index.generation) || !Number.isSafeInteger(totalEvents) || totalEvents < 0 || totalEvents > index.offsets.length || !Number.isSafeInteger(from) || from < 0 || from > totalEvents) throw new Error('The editing history changed during loading.');
    let next = from;
    while (next < totalEvents && next - from < PAGE_EVENTS && (next === from || (index.offsets[next + 1] ?? index.bytes) - index.offsets[from] <= PAGE_BYTES)) next++;
    const target = this.filename(projectId);
    try {
      let text = '';
      if (next === from) await verifyPath(target, index.signature);
      else text = await readRange(target, index.offsets[from], index.offsets[next] ?? index.bytes, index.signature);
      return { text, next, totalEvents, generation: index.generation };
    } catch (error) { if (error.code === 'JOURNAL_CHANGED') this.cache.delete(projectId); throw error; }
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
    const index = await this.index(projectId, supplied.length === 0), target = this.filename(projectId);
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
      // Open existing journals without O_CREAT so a concurrent removal cannot
      // turn an old index into a newly created empty recovery file.
      let handle;
      try { handle = await fs.open(target, index.signature === null ? 'a' : APPEND_EXISTING); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        this.cache.delete(projectId); throw changedJournal();
      }
      try {
        const before = await handle.stat({ bigint: true });
        if (index.signature === null ? before.size !== 0n : signatureOf(before) !== index.signature) throw changedJournal();
        await handle.writeFile(additions.join('\n') + '\n'); await handle.sync();
        const saved = await handle.stat({ bigint: true });
        if (Number(saved.size) !== bytes) throw changedJournal();
        const signature = signatureOf(saved);
        await verifyPath(target, signature);
        index.signature = signature;
      } catch (error) {
        this.cache.delete(projectId);
        if (error.code !== 'JOURNAL_CHANGED') this.needsSync.add(projectId);
        throw error;
      }
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
      await fs.copyFile(target, archive, constants.COPYFILE_EXCL);
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
