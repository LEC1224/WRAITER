const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hash, atomicWrite, readLimited, validateProject, samePath } = require('./core.cjs');
const FORMATS = ['wraiter', 'odt', 'docx', 'txt', 'md', 'html'];
const formatOf = target => ({ htm: 'html', markdown: 'md' }[path.extname(target).slice(1).toLowerCase()] || path.extname(target).slice(1).toLowerCase());
const contentHash = project => hash(JSON.stringify({ title: project.title, chapters: project.chapters, documentStyle: project.documentStyle, language: project.language, layout: project.layout }));
class DocumentFiles {
  constructor(store, directory) { this.store = store; this.directory = directory; this.binding = null; this.openings = new Map(); this.targets = new Map(); }
  sidecar(target) { return path.join(this.directory, 'Format state', `${hash(process.platform === 'win32' ? path.resolve(target).toLowerCase() : path.resolve(target))}.json`); }
  async readSidecar(target) { try { return JSON.parse((await readLimited(this.sidecar(target), 70 * 1024 * 1024)).toString('utf8')); } catch { return null; } }
  async recover() {
    const target = this.store.currentPath;
    if (!target || formatOf(target) === 'wraiter') { this.binding = null; return; }
    const saved = await this.readSidecar(target);
    this.binding = { ...saved?.binding, path: target, format: formatOf(target), contentHash: saved?.binding?.contentHash || '', fidelity: saved?.binding?.fidelity || {}, reviewed: saved?.binding?.reviewed || false };
  }
  async open(target) {
    const format = formatOf(target);
    if (!FORMATS.includes(format)) throw new Error('Choose an ODT, DOCX, WRAITER, Markdown, HTML or plain text document.');
    if (format === 'wraiter') { const result = await this.store.open(target); this.binding = null; return { ...result, binding: null }; }
    const bytes = await readLimited(target), fingerprint = hash(bytes), saved = await this.readSidecar(target);
    if (saved?.sourceHash === fingerprint && saved.project) {
      try {
        validateProject(saved.project);
        const result = await this.store.replace(saved.project, path.resolve(target), fingerprint);
        this.binding = { ...saved.binding, path: path.resolve(target), format };
        return { ...result, binding: this.binding };
      } catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
    }
    const token = crypto.randomUUID();
    this.openings.set(token, { path: path.resolve(target), format, sourceHash: fingerprint });
    return { import: true, openToken: token, name: path.basename(target, path.extname(target)), extension: `.${format}`, bytes: new Uint8Array(bytes), path: path.resolve(target), format };
  }
  async bind(project, { openToken, fidelity = {} }) {
    validateProject(project);
    const source = this.openings.get(openToken);
    if (!source) throw new Error('Reopen this document before attaching its file.');
    if (hash(await readLimited(source.path)) !== source.sourceHash) throw new Error('The original file changed while opening. Reopen it to load the latest version.');
    const result = await this.store.replace(project, source.path, source.sourceHash);
    this.binding = { path: source.path, format: source.format, contentHash: contentHash(project), fidelity, reviewed: !fidelity.requiresReview };
    this.openings.delete(openToken);
    await this.saveSidecar(project);
    return { ...result, binding: this.binding };
  }
  async authorizeTarget(target) {
    const format = formatOf(target);
    if (!FORMATS.includes(format) || !path.isAbsolute(target)) throw new Error('Choose a supported document format.');
    let expectedHash = null;
    try { expectedHash = hash(await readLimited(target)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const token = crypto.randomUUID(); this.targets.set(token, { path: target, format, expectedHash }); return { path: target, format, token };
  }
  async saveSidecar(project) {
    if (this.binding) await atomicWrite(this.sidecar(this.binding.path), JSON.stringify({ project, binding: this.binding, sourceHash: this.store.expectedHash }));
  }
  reviewWarnings(project, payload, options = {}) {
    const chosen = options.token ? this.targets.get(options.token) : null;
    const format = chosen?.format || this.binding?.format || 'wraiter';
    if (format === 'wraiter' || (!chosen && this.binding?.contentHash === contentHash(project))) return [];
    const warnings = !chosen && this.binding?.fidelity?.requiresReview && !this.binding.reviewed ? this.binding.fidelity.warnings || ['Some document features cannot be retained in this format.'] : [];
    const acknowledged = !chosen ? this.binding?.reviewedLossWarnings || [] : [];
    return [...new Set([...warnings, ...(payload?.lossWarnings || []).filter(warning => !acknowledged.includes(warning))])];
  }
  async persist(project, payload, options = {}) {
    validateProject(project);
    if (this.store.project && this.store.project.id !== project.id) throw new Error('This save belongs to another document.');
    const chosen = options.token ? this.targets.get(options.token) : null;
    if (options.token && !chosen) throw new Error('Choose the save destination again.');
    const target = chosen?.path || this.store.currentPath, format = chosen?.format || this.binding?.format || 'wraiter';
    if (!target || format === 'wraiter') {
      const previousBinding = this.binding;
      if (chosen) {
        let actual = null;
        try { actual = hash(await readLimited(target)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (actual !== chosen.expectedHash) throw new Error('The save destination changed after it was chosen. Choose a new destination to preserve both versions.');
      }
      // A format change cannot pass a native binary path into the JSON writer.
      const result = await this.store.persist(project, target, Boolean(chosen));
      this.binding = null; if (chosen) this.targets.delete(options.token);
      return { ...result, binding: null, previousFormat: previousBinding?.format };
    }
    await this.store.writeRecovery(project, this.store.currentPath, this.store.expectedHash);
    let actual = null, bytes = null;
    try { bytes = await readLimited(target); actual = hash(bytes); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual !== (chosen ? chosen.expectedHash : this.store.expectedHash)) throw new Error('This file changed outside WRAITER. Your edits are safe in recovery. Save a copy to preserve both versions.');
    const unchanged = !chosen && this.binding?.contentHash === contentHash(project);
    if (this.reviewWarnings(project, payload, options).length && !options.reviewed) {
      await this.saveSidecar(project); return { path: target, binding: this.binding, recoveryOnly: true, needsReview: true };
    }
    if (!unchanged && !payload) { await this.saveSidecar(project); return { path: target, binding: this.binding, recoveryOnly: true }; }
    if (!unchanged) {
      if (payload.format !== format) throw new Error('The encoded document does not match its file format.');
      const binary = ['odt', 'docx'].includes(format);
      const encodedBytes = payload.data instanceof Uint8Array || payload.data instanceof ArrayBuffer;
      if (binary ? !encodedBytes : !(encodedBytes || typeof payload.data === 'string')) throw new Error('Invalid encoded document.');
      // Renderer codecs may deliberately preserve UTF-16, BOM and line endings.
      // Converting their bytes to a UTF-8 string would corrupt a native text file.
      const data = encodedBytes ? Buffer.from(payload.data) : Buffer.from(payload.data, 'utf8');
      if (data.length > 100 * 1024 * 1024 || (binary && data.subarray(0, 2).toString() !== 'PK')) throw new Error('Invalid or oversized office document.');
      let originalBackup = !chosen ? this.binding?.originalBackup : null;
      if (bytes && !originalBackup) {
        originalBackup = path.join(this.directory, 'Format originals', `${actual}.${format}`);
        await fs.mkdir(path.dirname(originalBackup), { recursive: true });
        try { await fs.writeFile(originalBackup, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (actual !== hash(data)) await atomicWrite(target, data, true);
      this.binding = { path: target, format, contentHash: contentHash(project), fidelity: chosen ? {} : this.binding?.fidelity || {}, reviewed: true, reviewedLossWarnings: [...new Set([...(chosen ? [] : this.binding?.reviewedLossWarnings || []), ...(payload.lossWarnings || [])])], originalBackup };
      await this.store.writeRecovery(project, target, hash(data));
    }
    await this.saveSidecar(project);
    if (chosen) this.targets.delete(options.token);
    return { path: target, binding: this.binding, savedAt: new Date().toISOString() };
  }
}
module.exports = { DocumentFiles, FORMATS, formatOf, contentHash };
