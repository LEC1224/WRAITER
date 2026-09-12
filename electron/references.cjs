const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, readLimited, samePath } = require('./core.cjs');

const MAX_REFERENCE_CHARACTERS = 48000;
const MAX_REFERENCE_FILES = 20;
const MAX_REFERENCE_FILE_BYTES = 2 * 1024 * 1024;
const contents = new Map();
const canonicalKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const supportedPath = value => typeof value === 'string' && path.isAbsolute(value) && ['.txt', '.md'].includes(path.extname(value).toLowerCase());
const stamp = stat => `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;

async function linkedText(sourcePath, verifyContents, signal) {
  signal?.throwIfAborted();
  if (!supportedPath(sourcePath)) throw new Error('unsupported linked file');
  const resolved = await fs.realpath(sourcePath);
  // Imports store the selected file's canonical path. Do not follow a link that
  // has subsequently been redirected to an unrelated file.
  if (!samePath(sourcePath, resolved)) throw new Error('the linked path now points to another file');
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size > MAX_REFERENCE_FILE_BYTES) throw new Error('file is not a readable text reference under 2 MB');
  const key = canonicalKey(sourcePath), fingerprint = stamp(stat), cached = contents.get(key);
  if (!verifyContents && cached?.stamp === fingerprint) {
    // Checking metadata alone must not make newly unreadable files fall back to
    // cached text. Open the source to confirm current read access before reuse.
    const handle = await fs.open(resolved, 'r'); await handle.close();
    return cached.text;
  }
  const bytes = await readLimited(resolved, MAX_REFERENCE_FILE_BYTES); signal?.throwIfAborted();
  const after = await fs.stat(resolved);
  if (stamp(after) !== fingerprint) throw new Error('file changed while it was being read; try again');
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (contents.size >= 100) contents.clear();
  contents.set(key, { stamp: fingerprint, text });
  return text;
}

async function refreshReferences(references = [], { allowedPaths, verifyContents = false, signal } = {}) {
  const result = [], warnings = []; let used = 0;
  const allowed = allowedPaths ? new Set([...allowedPaths].map(canonicalKey)) : null;
  for (const reference of references.slice(0, MAX_REFERENCE_FILES)) {
    signal?.throwIfAborted(); if (!reference || reference.enabled === false) continue;
    const name = String(reference.name || 'Reference').slice(0, 200);
    let text;
    try {
      if (reference.sourcePath) {
        if (!supportedPath(reference.sourcePath) || (allowed && !allowed.has(canonicalKey(reference.sourcePath)))) throw new Error('reattach this file through Add reference to enable its local link');
        text = await linkedText(reference.sourcePath, verifyContents, signal);
      } else text = String(reference.text || ''); // Existing embedded copies remain supported.
    } catch (error) {
      signal?.throwIfAborted();
      if (supportedPath(reference.sourcePath)) contents.delete(canonicalKey(reference.sourcePath));
      const reason = error.code === 'ENOENT' ? 'file is missing' : ['EACCES', 'EPERM'].includes(error.code) ? 'file cannot be read' : error.message;
      warnings.push(`${name} was skipped: ${reason}.`); continue;
    }
    const separator = result.length ? 2 : 0, header = name.length + 3;
    const remaining = MAX_REFERENCE_CHARACTERS - used - separator - header;
    if (remaining <= 0) { warnings.push('Reference context reached its 48,000-character limit; later material was omitted.'); break; }
    const boundedText = text.slice(0, remaining);
    result.push({ name, text: boundedText }); used += separator + header + boundedText.length;
    if (boundedText.length < text.length) warnings.push(`${name} was shortened to fit the reference context limit.`);
  }
  if (references.length > MAX_REFERENCE_FILES) warnings.push('Only the first 20 reference files were considered.');
  return { references: result, warnings };
}

class ReferenceLibrary {
  constructor(registryPath) { this.registryPath = registryPath; this.allowed = null; this.writeQueue = Promise.resolve(); }
  async allowedPaths() {
    if (this.allowed) return this.allowed;
    let data; try { data = JSON.parse((await readLimited(this.registryPath, 2 * 1024 * 1024)).toString('utf8')); } catch {}
    this.allowed = new Set((Array.isArray(data?.paths) ? data.paths.slice(0, 10000) : []).filter(supportedPath).map(canonicalKey));
    return this.allowed;
  }
  async addFiles(paths) {
    const selected = await Promise.all(paths.slice(0, MAX_REFERENCE_FILES).map(async source => {
      if (!supportedPath(source)) throw new Error('Reference files must be Markdown or plain text.');
      const sourcePath = await fs.realpath(source);
      const text = await linkedText(sourcePath, true);
      return { name: path.basename(source), sourcePath, text };
    }));
    const work = this.writeQueue.then(async () => {
      const allowed = new Set(await this.allowedPaths()); for (const reference of selected) allowed.add(canonicalKey(reference.sourcePath));
      await atomicWrite(this.registryPath, JSON.stringify({ version: 1, paths: [...allowed] }));
      this.allowed = allowed; return selected;
    });
    this.writeQueue = work.catch(() => {}); return work;
  }
  async refresh(references, options = {}) { return refreshReferences(references, { ...options, allowedPaths: await this.allowedPaths() }); }
}

module.exports = { ReferenceLibrary, refreshReferences, MAX_REFERENCE_CHARACTERS, MAX_REFERENCE_FILES, MAX_REFERENCE_FILE_BYTES };
