const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DocumentStore, atomicWrite, readLimited, hash, samePath, safeFilename, validateProject } = require('./core.cjs');
const { DocumentFiles, contentHash } = require('./document-files.cjs');

const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
function cleanView(value = {}) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (typeof value.chapterId === 'string' && value.chapterId.length <= 200) result.chapterId = value.chapterId;
  if (Number.isFinite(value.scrollTop)) result.scrollTop = Math.max(0, Math.min(1e8, value.scrollTop));
  if (value.selection && ['from', 'to'].every(key => Number.isSafeInteger(value.selection[key]) && value.selection[key] >= 0 && value.selection[key] <= 1e8)) result.selection = { from: value.selection.from, to: value.selection.to };
  return result;
}

// Every tab has an independent recovery file. The small manifest only records
// tab order, the active tab and reading positions; it never holds manuscript text.
class WorkspaceSession {
  constructor(directory) {
    this.directory = directory; this.entries = []; this.activeId = null; this.pending = new Map();
    this.manifest = path.join(directory, 'open-projects.json');
    this.legacy = new DocumentStore(directory); this.lastManifest = ''; this.lastMirror = null;
  }
  get active() { return this.entries.find(entry => entry.id === this.activeId); }
  entry(id = randomUUID()) {
    if (!validId(id)) throw new Error('Invalid project tab.');
    const store = new DocumentStore(path.join(this.directory, 'Open projects', id));
    return { id, store, files: new DocumentFiles(store, this.directory), view: {} };
  }
  snapshot(extra = {}) {
    const entry = this.active;
    return { project: entry.store.project, path: entry.store.currentPath, binding: entry.files.binding,
      workspace: { activeId: entry.id, tabs: this.entries.map(item => ({ id: item.id, title: item.store.project?.title || 'Untitled', path: item.store.currentPath, view: item.view })) }, ...extra };
  }
  async checkpoint() {
    const entry = this.active;
    if (!entry) return;
    // Keep the previous single-document recovery usable by older releases and
    // as a fallback if the session manifest becomes unreadable.
    if (entry.store.project && (!this.lastMirror || this.lastMirror.project !== entry.store.project || this.lastMirror.path !== entry.store.currentPath || this.lastMirror.expectedHash !== entry.store.expectedHash)) {
      await this.legacy.writeRecovery(entry.store.project, entry.store.currentPath, entry.store.expectedHash);
      this.lastMirror = { project: entry.store.project, path: entry.store.currentPath, expectedHash: entry.store.expectedHash };
    }
    const data = JSON.stringify({ version: 1, activeId: this.activeId, tabs: this.entries.map(item => ({ id: item.id, empty: !item.store.project, view: item.view })) });
    if (data !== this.lastManifest) { await atomicWrite(this.manifest, data, true); this.lastManifest = data; }
  }
  async boot(startup = 'restore') {
    const warnings = []; let saved;
    for (const target of [this.manifest, this.manifest + '.bak']) {
      try {
        const data = JSON.parse((await readLimited(target, 2 * 1024 * 1024)).toString('utf8'));
        if (data.version !== 1 || !Array.isArray(data.tabs) || data.tabs.length > 200 || data.tabs.some(tab => !validId(tab.id)) || new Set(data.tabs.map(tab => tab.id)).size !== data.tabs.length) throw new Error('Invalid open-project list.');
        saved = data; break;
      } catch (error) { if (error.code !== 'ENOENT') warnings.push('The latest open-project list could not be read; a recovery copy was used where available.'); }
    }
    if (saved) for (const tab of saved.tabs) {
      const entry = this.entry(tab.id), recovered = await entry.store.boot();
      entry.view = cleanView(tab.view); await entry.files.recover();
      if (recovered.warning) warnings.push(recovered.warning);
      if (entry.store.project || tab.empty === true) this.entries.push(entry);
      else warnings.push('An open project could not be recovered. Its recovery files have been left in place.');
    }
    if (!this.entries.length) {
      const recovered = await this.legacy.boot();
      if (recovered.warning) warnings.push(recovered.warning);
      if (recovered.project) {
        const entry = this.entry(); await entry.store.writeRecovery(recovered.project, recovered.path, this.legacy.expectedHash); await entry.files.recover(); this.entries.push(entry);
      }
    }
    const archivedPaths = [];
    if (startup === 'new') {
      for (const entry of this.entries) { const archived = await this.archiveDraft(entry); if (archived) archivedPaths.push(archived); }
      this.entries = [];
    }
    if (!this.entries.length) this.entries.push(this.entry());
    this.activeId = this.entries.find(entry => entry.id === saved?.activeId)?.id || this.entries[0].id;
    await this.checkpoint();
    return this.snapshot({ warning: [...new Set(warnings)].join(' '), archivedPaths });
  }
  rememberView(view) { this.active.view = cleanView(view); }
  async persistChat(projectId, chat) {
    const entry = this.entries.find(item => item.store.project?.id === projectId);
    if (!entry) throw new Error('This chat belongs to a project that is no longer open.');
    const current = entry.store.project, chats = current.chats || [], index = chats.findIndex(item => item.id === chat?.id);
    const nextChats = [...chats];
    if (index < 0) nextChats.push(chat); else nextChats[index] = chat;
    const next = { ...current, chats: nextChats, activeChatId: current.activeChatId || chat?.id || null, updatedAt: new Date().toISOString() };
    validateProject(next);
    const result = await entry.files.persist(next, null);
    if (entry === this.active) await this.checkpoint();
    return result;
  }
  async activate(id) {
    if (!this.entries.some(entry => entry.id === id)) throw new Error('That project tab is no longer open.');
    const previous = this.activeId; this.activeId = id;
    try { await this.checkpoint(); return this.snapshot(); }
    catch (error) { this.activeId = previous; throw error; }
  }
  findPath(target) { return this.entries.find(entry => samePath(entry.store.currentPath, target)); }
  assertSaveTarget(target) {
    const other = this.findPath(target);
    if (other && other.id !== this.activeId) throw new Error('This file is already open in another tab. Switch to that tab or choose another filename.');
  }
  async adopt(entry) {
    if (this.entries.length >= 200) throw new Error('Close a project tab before opening another.');
    // A separately saved copy can carry the original project ID. Give that copy
    // its own journal instead of mixing edits from two files into one history.
    if (this.entries.some(item => item.store.project?.id === entry.store.project?.id)) {
      const project = { ...entry.store.project, id: randomUUID() }; delete project.historySequence;
      await entry.store.writeRecovery(project, entry.store.currentPath, entry.store.expectedHash);
      await entry.files.saveSidecar(project);
    }
    this.entries.push(entry);
    try { return await this.activate(entry.id); }
    catch (error) { this.entries = this.entries.filter(item => item !== entry); throw error; }
  }
  async create(project) {
    validateProject(project);
    const entry = this.entry(); await entry.store.writeRecovery(project, null, null); return this.adopt(entry);
  }
  async open(target) {
    const existing = this.findPath(target);
    if (existing) return this.activate(existing.id);
    const entry = this.entry(), result = await entry.files.open(target);
    if (result.import) { this.pending.set(result.openToken, entry); return result; }
    return this.adopt(entry);
  }
  async bind(project, source) {
    const entry = this.pending.get(source?.openToken);
    if (!entry) throw new Error('Reopen this document before attaching its file.');
    try { await entry.files.bind(project, source); return entry.reloadOf ? await this.finishReload(entry) : await this.adopt(entry); }
    finally { this.pending.delete(source.openToken); }
  }
  async reload(project) {
    validateProject(project);
    const previous = this.active;
    if (!previous.store.currentPath || previous.store.project?.id !== project.id) throw new Error('This document is no longer attached to the active file.');
    // Save recovery only: attempting a normal save would hit the very conflict
    // this operation resolves, or overwrite the version the user wants to load.
    await previous.store.writeRecovery(project, previous.store.currentPath, previous.store.expectedHash);
    const entry = this.entry(); entry.reloadOf = previous.id;
    const result = await entry.files.open(previous.store.currentPath);
    if (result.import) { this.pending.set(result.openToken, entry); return result; }
    return this.finishReload(entry);
  }
  async finishReload(entry) {
    const index = this.entries.findIndex(item => item.id === entry.reloadOf), previous = this.entries[index];
    if (!previous || this.activeId !== previous.id) throw new Error('Switch back to the original tab before reloading.');
    if (hash(await readLimited(entry.store.currentPath)) !== entry.store.expectedHash) throw new Error('The file changed while reloading. Load the modified version again.');
    // A new journal identity prevents old undo/recovery events from replaying
    // over the externally edited content, even if the file carries the old ID.
    const project = { ...entry.store.project, id: randomUUID() }; delete project.historySequence;
    await entry.store.writeRecovery(project, entry.store.currentPath, entry.store.expectedHash);
    const preservedPath = path.join(this.directory, 'Recovered drafts', `${safeFilename(previous.store.project.title)} - before reload - ${randomUUID()}.wraiter`);
    await atomicWrite(preservedPath, JSON.stringify(previous.store.project, null, 2));
    await entry.files.saveSidecar(project);
    this.entries[index] = entry; this.activeId = entry.id;
    try { await this.checkpoint(); return this.snapshot({ preservedPath }); }
    catch (error) { this.entries[index] = previous; this.activeId = previous.id; throw error; }
  }
  async archiveDraft(entry) {
    const { project, currentPath, expectedHash } = entry.store;
    if (!project) return null;
    if (!currentPath && project.title === 'Untitled manuscript' && (project.historySequence || 0) <= 1 && project.chapters.length === 1 && !project.notes && !project.style && !project.references?.length && !(project.chats || []).some(chat => chat.messages?.length) && !(project.chapters[0].content.content || []).some(node => node.type !== 'paragraph' || node.content?.length)) return null;
    const dirty = !currentPath || (entry.files.binding ? contentHash(project) !== entry.files.binding.contentHash : hash(JSON.stringify(project, null, 2)) !== expectedHash);
    if (!dirty) return null;
    const target = path.join(this.directory, 'Recovered drafts', `${safeFilename(project.title)} - ${hash(project.id).slice(0, 12)}.wraiter`);
    await atomicWrite(target, JSON.stringify(project, null, 2), true); return target;
  }
  async close(id) {
    const index = this.entries.findIndex(entry => entry.id === id);
    if (index < 0) throw new Error('That project tab is no longer open.');
    const archivedPath = await this.archiveDraft(this.entries[index]);
    const previousEntries = [...this.entries], previousId = this.activeId;
    this.entries.splice(index, 1);
    if (!this.entries.length) this.entries.push(this.entry());
    if (this.activeId === id) this.activeId = this.entries[Math.min(index, this.entries.length - 1)].id;
    try { await this.checkpoint(); return this.snapshot({ archivedPath }); }
    catch (error) { this.entries = previousEntries; this.activeId = previousId; throw error; }
  }
}
module.exports = { WorkspaceSession, cleanView };
