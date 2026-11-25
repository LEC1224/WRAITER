import { newProject, uid } from '../document.js';
import { browserHistory, browserMerge, checkoutCheckpoint, readCheckpoint, saveCheckpoint } from './checkpoints.js';
import { incomingWriting, suggestStoryPlacements } from '../../electron/story-merge.mjs';
import scenes from '../../electron/story-scenes.cjs';
import { request as accountRequest, getRequestSession, download, filename } from './api.js';
import { runBrowserAI } from './ai.js';
import { readRecovery, saveRecovery } from './recovery.js';
import { sealDocument, openGrammarDictionary, sealGrammarDictionary } from '../cloud-vault.js';
import { grammarExceptionStore } from '../../electron/grammar-exceptions.mjs';
import { readCloudDocument } from './vault-client.js';

const TASKS = ['continue', 'correct', 'rewrite', 'proofread', 'chat', 'checkpoint'];
const PROVIDERS = new Set(['openai', 'anthropic', 'compatible']);
const defaults = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', enabled: false, setupComplete: true, tutorialComplete: true, predictionWords: 35, contextWords: 2000, tokenCap: 512, temperature: 0.7, goal: 500, measure: 720, zoom: 100, spellcheck: true, language: 'en-US', translationSuggestions: 3, correctionSuggestions: 1, rephraseSuggestions: 3, distribution: 'web' };
const pickFile = (accept, multiple = false) => new Promise(resolve => {
  const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple;
  input.addEventListener('change', () => resolve([...input.files])); input.addEventListener('cancel', () => resolve([])); input.click();
});
const readDataURL = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The image could not be read.')); reader.readAsDataURL(file); });
const cloudProfile = settings => {
  if (!PROVIDERS.has(settings.provider)) throw new Error('WRAITER web connects to cloud API providers using your own API key. Choose OpenAI API, Claude API, or a supported compatible cloud provider.');
  return settings;
};
function cleanSettings(value) {
  if (Array.isArray(value)) return value.map(cleanSettings);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(apiKey|keys|clearKey|taskHasKey|hasKey|apiKeyTask|codexPath|claudePath|recent)$/i.test(key)).map(([key, item]) => [key, cleanSettings(item)]));
}
export function createBrowserAdapter({ user, vaultKey, sessionTag = getRequestSession(), settings = {}, onLibrary, onChanged, onError }) {
  if (!vaultKey) throw new Error('Unlock your documents before opening the editor.');
  const request = (path, options = {}) => accountRequest(path, { ...options, expectedUser: user.id, expectedSession: sessionTag });
  let prefs = { ...defaults, ...settings, setupComplete: true, tutorialComplete: true, distribution: 'web' };
  if (!PROVIDERS.has(prefs.provider)) prefs = { ...prefs, provider: 'openai', baseUrl: defaults.baseUrl, model: '', enabled: false, taskProfiles: {} };
  let activeId = null, order = [], commands = new Set(), cancelled = new Map(), pendingOpen = new Map(), queues = new Map(), saveCurrent = null;
  const entries = new Map(), keys = new Map();
  const dictionarySlot = 'wraiter-grammar-exceptions:' + user.id;
  const grammarListeners = new Set();
  const dictionaryChanged = event => {
    if (event.storageArea === localStorage && (event.key === dictionarySlot || event.key === null)) {
      for (const listener of grammarListeners) listener();
    }
  };
  const grammarExceptions = grammarExceptionStore({
    async read() {
      if (!vaultKey) throw new Error('Unlock the editor before accessing your dictionary.');
      const saved = localStorage.getItem(dictionarySlot);
      return saved === null ? null : openGrammarDictionary(vaultKey, user.id, JSON.parse(saved));
    },
    async write(json) {
      const sealed = await sealGrammarDictionary(vaultKey, user.id, json);
      if (!vaultKey) throw new Error('Unlock the editor before changing your dictionary.');
      localStorage.setItem(dictionarySlot, JSON.stringify(sealed));
    },
    lock: run => navigator.locks.request(dictionarySlot, run)
  });
  const profile = task => cloudProfile({ ...prefs, ...(prefs.taskProfiles?.[task] || {}) });
  const signature = value => `${value.provider}|${String(value.baseUrl || '').replace(/\/+$/, '')}`;
  const publicPrefs = () => ({ ...prefs, hasKey: keys.has(signature(profile('continue'))), taskHasKey: Object.fromEntries(TASKS.map(task => [task, PROVIDERS.has((prefs.taskProfiles?.[task] || prefs).provider) && keys.has(signature({ ...prefs, ...prefs.taskProfiles?.[task] }))])), recent: order.map(id => `cloud:${id}`) });
  const state = () => { const entry = entries.get(activeId); return { project: entry?.project || null, path: entry ? `Cloud / ${entry.project.title}` : null, binding: null, workspace: { activeId, tabs: order.filter(id => entries.has(id)).map(id => ({ id, title: entries.get(id).project.title, path: `Cloud / ${entries.get(id).project.title}`, view: entries.get(id).view || {} })) } }; };
  function append(entry, events = []) {
    for (const event of events) {
      const index = event.sequence - 1;
      if (!Number.isSafeInteger(index) || index < 0 || index > entry.journal.length) throw new Error('The editing history is out of sequence. Your document remains in browser recovery.');
      if (index === entry.journal.length) entry.journal.push(event);
      else if (JSON.stringify(entry.journal[index]) !== JSON.stringify(event)) throw new Error('Conflicting editing history was preserved. Reopen the document before continuing.');
    }
  }
  async function preserve(entry, pending = true) { await saveRecovery(user.id, { project: entry.project, journal: entry.journal, revision: entry.revision, cloudId: entry.cloudId, pending }, vaultKey); }
  async function sync(entry) {
    const project = structuredClone(entry.project), journal = structuredClone(entry.journal), cloudId = entry.cloudId, baseRevision = entry.revision;
    await saveRecovery(user.id, { project, journal, revision: baseRevision, cloudId, pending: true }, vaultKey);
    const sealed = await sealDocument(vaultKey, user.id, cloudId || project.id, { project, journal });
    let result;
    try { result = await request(cloudId ? `/api/documents/${encodeURIComponent(cloudId)}` : '/api/documents', { method: cloudId ? 'PUT' : 'POST', body: { sealed, ...(cloudId ? { baseRevision } : { id: project.id }) } }); }
    catch (error) {
      if (error.status === 409) throw new Error('This document changed in another window or device. Your edits are preserved in browser recovery. Open Library to download your recovery copy before reopening the cloud version.');
      throw new Error(`${error.message} Your latest draft is preserved in this browser. Keep this window open and retry Save when the connection returns.`);
    }
    entry.cloudId = result.id || cloudId || project.id; entry.revision = result.revision;
    if (entry.project === project) await preserve(entry, false);
    else await saveRecovery(user.id, { project: entry.project, journal: entry.journal, revision: entry.revision, cloudId: entry.cloudId, pending: JSON.stringify(entry.project) !== JSON.stringify(project) || entry.journal.length !== journal.length }, vaultKey);
    onChanged?.(); return { path: `Cloud / ${entry.project.title}`, binding: null, recoveryOnly: false, revision: result.revision };
  }
  function serial(id, action) { const work = (queues.get(id) || Promise.resolve()).catch(() => {}).then(action); queues.set(id, work); return work; }
  async function persist(project, _payload, events = []) {
    let entry = entries.get(project.id);
    if (!entry) { entry = { project, journal: [], revision: null, cloudId: null }; entries.set(project.id, entry); order.push(project.id); activeId = project.id; }
    const previousSnapshots = entry.project.snapshots || [];
    entry.project = { ...project, snapshots: previousSnapshots.length ? previousSnapshots : project.snapshots || [] }; append(entry, events);
    await preserve(entry);
    return serial(project.id, () => sync(entry));
  }
  async function adopt(project, detail = {}) {
    const entry = { project, journal: Array.isArray(detail.journal) ? detail.journal : detail.journal?.events || [], revision: detail.revision ?? null, cloudId: detail.id || detail.cloudId || null, view: {} };
    entries.set(project.id, entry); if (!order.includes(project.id)) order.push(project.id); activeId = project.id;
    if (!entry.cloudId) await serial(project.id, () => sync(entry));
    return state();
  }
  async function loadCloud(id) {
    const data = await readCloudDocument(user.id, vaultKey, id, sessionTag);
    const local = await readRecovery(user.id, data.project.id, vaultKey);
    if (local?.pending) {
      if (local.revision === data.revision) return adopt(local.project, { ...local, id, revision: data.revision });
      onError?.('A recovery draft from this browser differs from the cloud version. Download it in Library before discarding it.');
    }
    return adopt(data.project, { ...data, id });
  }
  async function openFile(file) {
    if (!file) return null;
    if (file.size > 100 * 1024 * 1024) throw new Error('Open a document smaller than 100 MB.');
    const extension = '.' + file.name.split('.').pop().toLowerCase();
    if (extension === '.wraiter' || extension === '.json') {
      const original = JSON.parse(await file.text()), project = original.project || original;
      if (project.format !== 'wraiter' || !Array.isArray(project.chapters)) throw new Error('This is not a WRAITER document.');
      const copy = { ...project, id: uid(), title: project.title || file.name }; delete copy.historySequence;
      return adopt(copy);
    }
    const openToken = uid(); pendingOpen.set(openToken, file.name);
    return { import: true, extension, name: file.name.replace(/\.[^.]+$/, ''), bytes: [...new Uint8Array(await file.arrayBuffer())], openToken };
  }
  async function ai(operation, task, incoming = {}, draft, signal) {
    const selected = cloudProfile(draft ? { ...prefs, ...draft } : profile(task));
    const apiKey = draft?.apiKey?.trim() || keys.get(signature(selected));
    if (!apiKey) throw new Error('Enter your own provider API key in Settings → Connections. Your key is kept for this browser session only.');
    const controller = new AbortController(), id = incoming.id || uid(); cancelled.set(id, controller);
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try { signal?.throwIfAborted(); return await runBrowserAI(operation, { settings: cleanSettings(selected), apiKey, request: incoming }, controller.signal); }
    finally { signal?.removeEventListener('abort', abort); cancelled.delete(id); }
  }
  function openEntry(id = activeId) {
    const entry = entries.get(id);
    if (!entry || activeId !== id) throw new Error('Open the manuscript first.');
    return entry;
  }
  function verifyMerge(entry, expected) {
    if (entry.revision !== expected.cloudRevision || entry.project.historySequence !== expected.targetSequence || browserHistory(entry.project).headRevision !== expected.headRevision) {
      throw new Error('The current draft changed. Review the merge again.');
    }
  }
  const api = {
    platform: 'web', setSessionTag: tag => { sessionTag = tag; }, openLibrary: () => onLibrary?.(),
    dispose() { vaultKey = null; saveCurrent = null; entries.clear(); keys.clear(); commands.clear(); pendingOpen.clear(); queues.clear(); order = []; activeId = null; for (const controller of cancelled.values()) controller.abort(); cancelled.clear(); window.removeEventListener('online', online); window.removeEventListener('storage', dictionaryChanged); grammarListeners.clear(); },
    async selectDocument(id) { return loadCloud(id); },
    async initialize(id) { if (id) await loadCloud(id); },
    registerSave(callback) { saveCurrent = callback; return () => { if (saveCurrent === callback) saveCurrent = null; }; },
    flush: async () => { await saveCurrent?.(); await Promise.all([...queues.values()]); for (const entry of entries.values()) { const local = await readRecovery(user.id, entry.project.id, vaultKey); if (local?.pending) await serial(entry.project.id, () => sync(entry)); } },
    currentProject: () => entries.get(activeId)?.project,
    async boot() { if (!activeId) { const project = newProject(); await adopt(project); } return { ...state(), prefs: publicPrefs(), availableSpellLanguages: [] }; },
    async autosave(project, payload, events) { return persist(project, payload, events); },
    async saveEncoded(project, payload, options = {}, events = []) {
      if (options.token !== 'cloud-copy') return persist(project, payload, events);
      const entry = entries.get(project.id); if (!entry) throw new Error('Open the document before saving a copy.');
      entry.project = { ...project, snapshots: entry.project.snapshots || project.snapshots || [] }; append(entry, events); await preserve(entry);
      return serial(project.id, async () => {
        const original = await readCloudDocument(user.id, vaultKey, entry.cloudId, sessionTag);
        const copy = { ...entry.project, id: uid(), updatedAt: new Date().toISOString() }; delete copy.historySequence;
        const sealed = await sealDocument(vaultKey, user.id, copy.id, { project: copy, journal: [] });
        const result = await request('/api/documents', { method: 'POST', body: { id: copy.id, sealed } });
        entry.project = original.project; entry.journal = original.journal; entry.revision = original.revision; await preserve(entry, false);
        await adopt(copy, { id: result.id, revision: result.revision, journal: [] }); await preserve(entries.get(copy.id), false); onChanged?.();
        return { ...state(), recoveryOnly: false, revision: result.revision };
      });
    },
    async save(project) { return persist(project); },
    async chooseSaveTarget({ copy = false } = {}) { return { token: copy ? 'cloud-copy' : 'cloud', format: 'wraiter' }; },
    async newProject(project) { return adopt(project); },
    async open() { return openFile((await pickFile('.wraiter,.odt,.docx,.txt,.md,.markdown,.html,.htm'))[0]); },
    async openDroppedDocument(file) { return openFile(file); },
    async bindNative(project, source) { if (!pendingOpen.has(source.openToken)) throw new Error('Choose the file again to import it.'); pendingOpen.delete(source.openToken); return adopt(project); },
    async activateProject(id) { if (!entries.has(id)) throw new Error('Open this document from Library.'); activeId = id; return state(); },
    async closeProject(id) { await queues.get(id); entries.delete(id); order = order.filter(item => item !== id); if (activeId === id) activeId = order.at(-1) || null; if (!activeId) { await adopt(newProject()); } return state(); },
    async reorderProjects(ids) { if (ids.length !== order.length || ids.some(id => !entries.has(id))) throw new Error('The document tabs changed. Try again.'); order = ids; return state().workspace; },
    async rememberProjectView(view) { if (entries.has(activeId)) entries.get(activeId).view = view; return true; },
    async reloadProject(project) { await preserve(entries.get(project.id)); return loadCloud(entries.get(project.id).cloudId); },
    async getRecents() { return order.map(id => `cloud:${id}`); }, async clearRecents() { return []; },
    async openRecent(path) { const id = path.replace(/^cloud:/, ''); if (entries.has(id)) { activeId = id; return state(); } return loadCloud(id); },
    async persistChat(projectId, chat) { const entry = entries.get(projectId); if (!entry) throw new Error('Open the document before saving a conversation.'); const chats = [...(entry.project.chats || [])], index = chats.findIndex(item => item.id === chat.id); if (index >= 0) chats[index] = chat; else chats.push(chat); return persist({ ...entry.project, chats }); },
    async loadEditHistory(id) { const entry = entries.get(id); return { events: entry?.journal || [], totalEvents: entry?.journal?.length || 0, recoverySequence: entry?.project.historySequence }; },
    async appendEditHistory(id, events) { const entry = entries.get(id); if (!entry) throw new Error('This editing history belongs to another document.'); append(entry, events); await preserve(entry); return { sequence: entry.journal.length }; },
    async restartEditHistory(project, initial) { const entry = entries.get(project.id); if (!entry) throw new Error('Open the document first.'); download(JSON.stringify({ project: entry.project, journal: entry.journal }), `${filename(project.title)} - preserved history.wraiter`); entry.journal = [initial]; entry.project = { ...project, historySequence: 1 }; await preserve(entry); return { sequence: 1, preservedPath: 'your downloaded preserved-history file and browser recovery' }; },
    async settings(update = {}) {
      const target = update.apiKeyTask || 'continue', selected = { ...prefs, ...prefs.taskProfiles?.[target], ...('provider' in update ? { provider: update.provider, baseUrl: update.baseUrl || '' } : {}) };
      if (update.clearKey) keys.delete(signature(selected)); if (update.apiKey?.trim()) keys.set(signature(selected), update.apiKey.trim());
      prefs = { ...prefs, ...cleanSettings(update), setupComplete: true, tutorialComplete: true, distribution: 'web' };
      for (const item of [prefs, ...Object.values(prefs.taskProfiles || {})]) cloudProfile({ ...prefs, ...item });
      await request('/api/settings', { method: 'PUT', body: cleanSettings(prefs) }); return publicPrefs();
    },
    async exportFile(payload) {
      if (payload.format === 'pdf') return api.previewPDF(payload);
      const data = payload.base64 ? Uint8Array.from(atob(payload.base64), c => c.charCodeAt(0)) : payload.data ?? payload.html ?? '';
      const ext = payload.format === 'bbcode' ? 'txt' : payload.format === 'rich-text' ? 'html' : payload.format;
      download(data, `${filename(payload.title)}.${ext}`, ({ docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text', epub: 'application/epub+zip', html: 'text/html' })[ext] || 'text/plain;charset=utf-8'); return { saved: true, path: 'your browser downloads' };
    },
    async exportClipboard(payload) { if (payload.clipboardHTML && navigator.clipboard?.write && globalThis.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([payload.clipboardHTML], { type: 'text/html' }), 'text/plain': new Blob([payload.clipboardText || ''], { type: 'text/plain' }) })]); else await navigator.clipboard.writeText(payload.clipboardText || payload.data || ''); return true; },
    async previewPDF(payload) {
      const frame = document.createElement('iframe'); frame.className = 'web-print-frame'; frame.setAttribute('sandbox', 'allow-modals allow-same-origin'); frame.srcdoc = payload.html || payload.data; document.body.append(frame);
      await new Promise(resolve => frame.onload = resolve); await frame.contentDocument.fonts.ready; frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); return { preview: true };
    },
    async image() { const file = (await pickFile('image/png,image/jpeg,image/webp,image/gif'))[0]; if (!file) return null; if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.'); return readDataURL(file); },
    async reference() { const files = await pickFile('.txt,.md', true); return Promise.all(files.map(async file => { if (file.size > 5 * 1024 * 1024) throw new Error('Each reference must be smaller than 5 MB.'); return { id: uid(), name: file.name, text: await file.text(), enabled: true }; })); },
    async addDroppedReference(file) { if (file.size > 5 * 1024 * 1024) throw new Error('Each reference must be smaller than 5 MB.'); return [{ id: uid(), name: file.name, text: await file.text(), enabled: true }]; },
    generate: incoming => ai('generate', incoming.mode || 'continue', incoming), proofread: incoming => ai('proofread', 'proofread', incoming), inlineGrammar: incoming => ai('inline', 'proofread', incoming), runAgent: incoming => ai('agent', 'chat', incoming),
    probe: draft => ai('probe', draft?.task || 'continue', {}, draft), listModels: draft => ai('models', draft?.task || 'continue', {}, draft), connectProvider: draft => ai('probe', draft?.task || 'continue', {}, draft), reconnectProvider: draft => ai('probe', draft?.task || 'continue', {}, draft), connectionStatus: draft => ai('probe', draft?.task || 'continue', {}, draft),
    async cancel(id) { if (id) cancelled.get(id)?.abort(); else for (const controller of cancelled.values()) controller.abort(); return true; }, async cancelInlineGrammar(id) { cancelled.get(id)?.abort(); return true; },
    async listGitHistory(id) { return browserHistory(openEntry(id).project); },
    async commitGitSnapshot(project, label, preserveRevision) {
      return serial(project.id, async () => {
        const entry = openEntry(project.id);
        const next = { ...entry, project: saveCheckpoint({ ...project, snapshots: entry.project.snapshots }, label, null, preserveRevision) };
        await sync(next);
        if (entries.get(project.id) === entry) {
          entry.revision = next.revision;
          entry.cloudId = next.cloudId;
          entry.project = { ...entry.project, snapshots: next.project.snapshots };
        }
        return browserHistory(next.project);
      });
    },
    async getGitRevision(revision) { return readCheckpoint(openEntry().project, revision); },
    async activateGitRevision(revision) {
      const entry = openEntry();
      entry.project = checkoutCheckpoint(entry.project, revision);
      return true;
    },
    async prepareGitMerge(tabId, projectId, sourceRevision) {
      if (tabId !== projectId) throw new Error('Open the manuscript first.');
      const entry = openEntry(projectId);
      return { ...browserMerge(entry.project, sourceRevision), cloudRevision: entry.revision };
    },
    async applyGitMerge(tabId, expected, project, event, title) {
      if (tabId !== project.id) throw new Error('Open the manuscript first.');
      return serial(project.id, async () => {
        const entry = openEntry(project.id);
        verifyMerge(entry, expected);
        if (project.historySequence !== entry.journal.length + (event ? 1 : 0)) throw new Error('The merge no longer matches the edit history.');
        const nextProject = saveCheckpoint({ ...project, snapshots: entry.project.snapshots }, ('Merge · ' + title).slice(0, 200), expected.sourceRevision);
        const next = { ...entry, journal: [...entry.journal], project: nextProject };
        append(next, event ? [event] : []);
        await sync(next);
        if (entries.get(project.id) === entry) entries.set(project.id, next);
        return { revision: browserHistory(nextProject).headRevision };
      });
    },
    async adviseGitMerge(tabId, projectId, expected, id) {
      if (tabId !== projectId || !prefs.enabled) throw new Error('Open the manuscript and enable AI assistance to suggest a merge.');
      const entry = openEntry(projectId);
      verifyMerge(entry, expected);
      const { base, source } = browserMerge(entry.project, expected.sourceRevision);
      const target = entry.project, candidates = incomingWriting(base, target, source);
      const controller = new AbortController(); cancelled.set(id, controller);
      try { return await suggestStoryPlacements(target, candidates, prompt => ai('structured', 'chat', { ...prompt, mode: 'chat' }, undefined, controller.signal), controller.signal); }
      finally { cancelled.delete(id); }
    },
    async cancelGitMergeAdvice(id) { return api.cancel(id); },
    async describeStoryPassage(projectId, groupId) {
      if (!prefs.enabled) return { status: 'disabled' };
      const { project } = openEntry(projectId), history = browserHistory(project);
      const group = history.passages.find(item => item.key === groupId && item.hasProse);
      if (!group) return { status: 'unavailable' };
      const facts = Object.fromEntries(history.entries.map(item => [item.revision, item.passage]));
      const { prompt, starts } = scenes.scenePrompt(project, group, facts);
      const raw = await ai('structured', 'checkpoint', { ...prompt, mode: 'checkpoint' });
      return { status: 'ready', sections: scenes.readSections(raw, group.revisions.length, starts) };
    },
    async updateGitCheckpointLabel(revision, metadata) { const entry = entries.get(activeId); entry.project = { ...entry.project, snapshots: (entry.project.snapshots || []).map(item => item.id === revision ? { ...item, name: metadata.title || item.name } : item) }; await serial(activeId, () => sync(entry)); return true; },
    async summarizeCheckpoint(payload) { return { title: 'Manuscript checkpoint', summary: 'Saved changes to this manuscript.', location: payload.after?.chapters?.[0]?.title || '', ai: false }; },
    async openLink(url) { if (!/^(https?:|mailto:)/i.test(url)) throw new Error('Unsupported link.'); window.open(url, '_blank', 'noopener,noreferrer'); return true; },
    async tabFileAction(id, action) { const project = entries.get(id)?.project; if (!project) throw new Error('Open the document first.'); if (action === 'reveal') onLibrary?.(); else await navigator.clipboard.writeText(action === 'copy-name' ? project.title : `${location.origin}/?document=${entries.get(id).cloudId}`); return true; },
    async listFonts() { return ['Arial', 'Cambria', 'Calibri', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Courier New', 'Trebuchet MS', 'serif', 'sans-serif', 'monospace']; },
    async offlineDictionaryWords() { return prefs.personalDictionary || []; }, async addOfflineDictionaryWord(word) { const words = [...new Set([...(prefs.personalDictionary || []), word])]; await api.settings({ personalDictionary: words }); return true; },
    personalGrammarExceptions: grammarExceptions.list,
    addPersonalGrammarException: grammarExceptions.add,
    updatePersonalGrammarException: grammarExceptions.edit,
    removePersonalGrammarException: grammarExceptions.remove,
    onPersonalGrammarExceptionsChanged(listener) {
      grammarListeners.add(listener);
      return () => grammarListeners.delete(listener);
    },
    async offlineGrammar({ texts = [] }) { return texts.map(() => []); },
    async thesaurus(word, language) { return (await import('./thesaurus.js')).browserThesaurus(word, language); },
    async setDocumentLanguage() { return true; }, async setShortcutCapture() { return true; }, async externalFilesReady() { return true; }, async nextExternalFile() { return null; }, async completeExternalFile() { return true; },
    async finishClose() { await api.flush(); onLibrary?.(); }, async reveal() { onLibrary?.(); return true; }, window() {},
    onCommand(callback) { commands.add(callback); return () => commands.delete(callback); }, onEditorMenu() { return () => {}; }, onEditorMenuAction() { return () => {}; },
    emitCommand(command) { for (const callback of commands) callback(command); },
    async diagnosticsStatus() { return { enabled: false, path: '', message: 'Browser error details stay in your browser developer console.' }; }, logSurface() {}, reportError(source, error) { console.error(`[WRAITER] ${source}`, error?.name || 'Error'); },
    async openLogFolder() { throw new Error('Browser logs are available through your browser developer tools.'); }, async openCrashDumpFolder() { throw new Error('Native crash dumps are a desktop feature.'); },
    async localStatus() { return { available: false, running: false, models: [] }; }, onLocalProgress() { return () => {}; },
    async loginProvider() { throw new Error('Use your own cloud API key in Connections. Local account helpers are available in WRAITER desktop.'); }, async setupInstall() { throw new Error('WRAITER web uses cloud API connections.'); },
    async setupTest(draft) { return api.probe(draft); }, async setupChoose() { return true; }, async setupHelp() { return true; }, async setupCancel() { return true; }
  };
  const online = () => api.flush().catch(error => onError?.(error.message));
  window.addEventListener('online', online);
  window.addEventListener('storage', dictionaryChanged);
  return api;
}
