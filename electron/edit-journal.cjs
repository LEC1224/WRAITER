const fs = require('node:fs/promises');
const path = require('node:path');
const { hash, atomicWrite, validateProject } = require('./core.cjs');
// Events are immutable. A recovery snapshot names the last committed sequence;
// interrupted writes never replace an earlier undo chain.
class EditJournal {
  constructor(directory) { this.directory = path.join(directory, 'Edit history'); this.cache = new Map(); }
  filename(projectId) { return path.join(this.directory, `${hash(projectId)}.jsonl`); }
  async read(projectId, sequence = Infinity) {
    if (typeof projectId !== 'string' || !projectId || projectId.length > 200) throw new Error('Invalid history document.');
    let events = this.cache.get(projectId);
    if (!events) {
      events = [];
      try {
        const text = await fs.readFile(this.filename(projectId), 'utf8');
        const lines = text.split('\n');
        let interrupted = false;
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          try { const event = JSON.parse(lines[i]); if (event.sequence !== events.length + 1) throw new Error('Invalid sequence'); events.push(event); }
          catch { if (i < lines.length - 1) throw new Error('Editing history contains an unreadable record. The original journal was preserved.'); interrupted = true; break; }
        }
        if (interrupted) {
          await fs.copyFile(this.filename(projectId), `${this.filename(projectId)}.interrupted-${Date.now()}`);
          await atomicWrite(this.filename(projectId), events.map(event => JSON.stringify(event) + '\n').join(''));
        } else if (text && !text.endsWith('\n')) {
          const handle = await fs.open(this.filename(projectId), 'a');
          try { await handle.writeFile('\n'); await handle.sync(); } finally { await handle.close(); }
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.cache.set(projectId, events);
    }
    return { events: events.filter(event => event.sequence <= sequence), totalEvents: events.length };
  }
  async append(projectId, supplied = []) {
    if (!Array.isArray(supplied)) throw new Error('Invalid editing history.');
    await this.read(projectId);
    const events = this.cache.get(projectId), additions = [];
    for (const event of supplied) {
      if (!event || !Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error('Invalid editing history event.');
      if (event.sequence <= events.length) {
        if (JSON.stringify(events[event.sequence - 1]) !== JSON.stringify(event)) throw new Error('An earlier history record cannot be overwritten.');
        continue;
      }
      if (event.sequence !== events.length + additions.length + 1) throw new Error('Editing history is missing an earlier event.');
      const serialized = JSON.stringify(event);
      if (Buffer.byteLength(serialized) > 100 * 1024 * 1024) throw new Error('This edit exceeds the history record limit.');
      additions.push({ event, serialized });
    }
    if (additions.length) {
      await fs.mkdir(this.directory, { recursive: true });
      const handle = await fs.open(this.filename(projectId), 'a');
      try { await handle.writeFile(additions.map(item => item.serialized + '\n').join('')); await handle.sync(); }
      finally { await handle.close(); }
      events.push(...additions.map(item => item.event));
    }
    return { sequence: events.length };
  }
  async restart(project, initial, reason = '') {
    validateProject(project);
    if (initial?.kind !== 'init' || initial.version !== 1 || initial.sequence !== 1 || initial.projectId !== project.id || !/^[a-f0-9]{16}:\d+$/.test(initial.fingerprint || '') || typeof initial.timestamp !== 'string' || !Number.isFinite(Date.parse(initial.timestamp))) throw new Error('Invalid replacement history baseline.');
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
    this.cache.set(project.id, [initial]);
    return { sequence: 1, preservedPath: archived ? archive : `${archive}.snapshot.json` };
  }
}
module.exports = { EditJournal };
