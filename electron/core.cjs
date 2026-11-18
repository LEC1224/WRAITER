const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { validatedProjectJSON, validateProject, validateRequest, buildPrompt, cleanResult, contextBefore, MAX_DOCUMENT_BYTES, DEFAULT_SUGGESTION_COUNTS, getSuggestionCounts, getSuggestionLimit } = require('./document-core.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function atomicWrite(file, data, backup = false, options = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data, { encoding: 'utf8', flag: 'wx' });
    const handle = await fs.open(temp, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      try {
        // Recheck named documents after staging and before every retry. A
        // brief Windows lock must not hide a concurrent author edit.
        if (Object.hasOwn(options, 'expectedHash')) {
          let actual = null;
          try { actual = hash(await readLimited(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (actual !== options.expectedHash) throw new Error(options.conflictMessage || 'This file changed outside WRAITER. Your edits are safe in recovery. Refresh from disk or locate the file to load it, or save a copy to keep both versions.');
        }
        if (backup) await fs.copyFile(file, `${file}.bak`).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await fs.rename(temp, file);
        break;
      } catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 5) throw error;
        await delay(20 * 2 ** attempt);
      }
    }
  } catch (error) { await fs.unlink(temp).catch(() => {}); throw error; }
}
async function readLimited(file, max = 60 * 1024 * 1024) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Choose a regular document file.');
    if (stat.size > max) throw new Error(`This file exceeds the ${Math.round(max / 1024 / 1024)} MB import limit.`);
    // A stable file fits in one buffer. Reserve one extra byte to observe
    // growth, then fall back to bounded chunks only if the stat was stale.
    const chunks = [];
    let buffer = Buffer.alloc(stat.size + 1), offset = 0, total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) {
        const tail = buffer.subarray(0, offset);
        return chunks.length ? Buffer.concat([...chunks, tail], total) : tail;
      }
      offset += bytesRead;
      total += bytesRead;
      if (total > max) throw new Error('The file grew beyond the import limit while it was being read.');
      if (offset === buffer.length) {
        chunks.push(buffer);
        buffer = Buffer.alloc(Math.min(256 * 1024, max - total + 1));
        offset = 0;
      }
    }
  } finally { await handle.close(); }
}
async function writeSnapshot(file, data, previous = null, backup = false) {
  const fingerprint = hash(data);
  let unchanged = false;
  if (previous?.path === file && previous.hash === fingerprint) {
    // Reuse only a snapshot this process already flushed, after verifying
    // its bytes still exist. Missing, changed or unreadable files rewrite.
    try { unchanged = hash(await readLimited(file, 70 * 1024 * 1024)) === fingerprint; } catch {}
  }
  if (!unchanged) await atomicWrite(file, data, backup);
  return { path: file, hash: fingerprint };
}
const samePath = (a, b) => Boolean(a && b && (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)));
function safeFilename(title) { return String(title || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[ .]+$/, '').slice(0, 100) || 'Untitled'; }
// Call store operations through one queue. The project identifier rejects delayed renderer saves after a document switch.
class DocumentStore {
  constructor(directory) { this.directory = path.resolve(directory); this.currentPath = null; this.expectedHash = null; this.project = null; this.lastRecoverySnapshot = null; }
  get recoveryPath() { return path.join(this.directory, 'recovery.json'); }
  async writeRecovery(project, target, expectedHash) {
    const data = JSON.stringify({ project, path: target, expectedHash });
    this.lastRecoverySnapshot = await writeSnapshot(this.recoveryPath, data, this.lastRecoverySnapshot, true);
    this.project = project; this.currentPath = target; this.expectedHash = expectedHash;
  }
  async boot() {
    const warnings = [];
    for (const target of [this.recoveryPath, `${this.recoveryPath}.bak`]) {
      try {
        const recovery = JSON.parse((await readLimited(target, 70 * 1024 * 1024)).toString('utf8')); validateProject(recovery.project);
        if (recovery.path != null && (typeof recovery.path !== 'string' || !path.isAbsolute(recovery.path) || !/\.(wraiter|odt|docx|txt|md|markdown|html|htm)$/i.test(recovery.path))) throw new Error('Invalid recovery path.');
        if (recovery.expectedHash != null && !/^[a-f0-9]{64}$/.test(recovery.expectedHash)) throw new Error('Invalid recovery fingerprint.');
        this.project = recovery.project; this.currentPath = recovery.path || null; this.expectedHash = recovery.expectedHash || null;
        return { project: this.project, path: this.currentPath, warning: warnings.length ? 'Restored the preceding recovery backup because the latest recovery could not be read.' : '' };
      } catch (error) { if (error.code !== 'ENOENT') warnings.push(error.message); }
    }
    return { project: null, path: null, warning: warnings.length ? 'Recovery could not be read. Your named documents and recovered drafts are unchanged.' : '' };
  }
  async archiveUntitled() {
    if (!this.project || this.currentPath) return null;
    const target = path.join(this.directory, 'Recovered drafts', `${safeFilename(this.project.title)} - ${hash(this.project.id).slice(0, 12)}.wraiter`);
    await atomicWrite(target, JSON.stringify(this.project, null, 2), true);
    return target;
  }
  async replace(project, target = null, fingerprint = null) {
    validateProject(project);
    const recoveredPath = await this.archiveUntitled();
    await this.writeRecovery(project, target, fingerprint);
    return { project, path: target, recoveredPath };
  }
  async open(target) {
    const bytes = await readLimited(target); const project = JSON.parse(bytes.toString('utf8'));
    return this.replace(project, path.resolve(target), hash(bytes));
  }
  async persist(project, target = this.currentPath, overwrite = false, { serialized = validatedProjectJSON(project), expectedTargetHash } = {}) {
    if (this.project && project.id !== this.project.id) throw new Error('This save belongs to a document that is no longer open. Its earlier recovery is preserved.');
    if (target != null && (typeof target !== 'string' || !path.isAbsolute(target) || !target.toLowerCase().endsWith('.wraiter'))) throw new Error('Native documents must use an absolute .wraiter path.');
    const fingerprint = hash(serialized);
    await this.writeRecovery(project, this.currentPath, this.expectedHash);
    if (target) {
      let actual = null;
      try { actual = hash(await readLimited(target)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (expectedTargetHash !== undefined && actual !== expectedTargetHash) throw new Error('The save destination changed after it was chosen. Choose a new destination to preserve both versions.');
      const conflictMessage = 'This file changed outside WRAITER, or already exists. Your edits are safe in recovery. Refresh from disk or locate the file to load it, or save a copy to keep both versions.';
      if ((samePath(target, this.currentPath) && actual !== this.expectedHash) || (!samePath(target, this.currentPath) && actual && !overwrite)) throw new Error(conflictMessage);
      if (actual !== fingerprint) await atomicWrite(target, serialized, true, { expectedHash: actual, conflictMessage });
      await this.writeRecovery(project, target, fingerprint);
    }
    return { path: this.currentPath, savedAt: new Date().toISOString() };
  }
}
module.exports = { hash, validatedProjectJSON, validateProject, validateRequest, atomicWrite, readLimited, writeSnapshot, buildPrompt, cleanResult, contextBefore, DocumentStore, samePath, safeFilename, MAX_DOCUMENT_BYTES, DEFAULT_SUGGESTION_COUNTS, getSuggestionCounts, getSuggestionLimit };
