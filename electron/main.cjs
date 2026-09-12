const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { hash, atomicWrite, readLimited, validateProject, validateRequest, DocumentStore, samePath, safeFilename } = require('./core.cjs');
const providers = require('./providers.cjs');
const { defaults, TASKS, PROVIDERS, validateSettings, resolveTask, keySlot, mergeSettings } = require('./preferences.cjs');
const { GitHistory } = require('./git-history.cjs');
const { listFonts, spellLanguage, menuTemplate } = require('./desktop.cjs');
const { ReferenceLibrary } = require('./references.cjs');

if (process.env.WRAITER_USER_DATA) app.setPath('userData', path.resolve(process.env.WRAITER_USER_DATA));
app.setName('WRAITER');
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let win, closing = false, closePending = false, closeFinishing = false, closeTimer, store, bootResult, gitHistory, fontList, referenceLibrary, lastReferenceWarnings = '';
let writeQueue = Promise.resolve();
let prefs = {};
const activeRequests = new Map();
const cancelAll = async () => {
  const controllers = [...activeRequests.values()];
  for (const controller of controllers) controller.abort();
  await Promise.all(controllers.map(controller => controller.finished));
};
const file = name => path.join(app.getPath('userData'), name);
const serial = fn => { const result = writeQueue.then(fn); writeQueue = result.catch(() => {}); return result; };
const tryRead = async (name, fallback) => { try { return JSON.parse(await fs.readFile(file(name), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error(`Could not load ${name}:`, e.message); return fallback; } };
function publicPrefs() {
  const { keys, ...rest } = prefs;
  const taskHasKey = Object.fromEntries(TASKS.map(task => [task, Boolean(keys?.[keySlot(resolveTask(prefs, task))])]));
  return { ...defaults, ...rest, hasKey: taskHasKey.continue, taskHasKey };
}
async function getKey(settings) {
  const encrypted = prefs.keys?.[keySlot(settings)];
  if (!encrypted) return '';
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch { throw new Error('The saved API key cannot be decrypted. Enter it again in Connections.'); }
}
async function rememberPath(target) {
  prefs.recent = [target, ...(prefs.recent || []).filter(x => !samePath(x, target))].slice(0, 12);
  // Opening has already committed its recovery. A preferences error must not leave the renderer on the preceding document.
  await atomicWrite(file('settings.json'), JSON.stringify(prefs)).catch(error => console.error('Could not save recent documents:', error.message));
}
async function openPath(target) {
  const extension = path.extname(target).toLowerCase();
  if (extension === '.wraiter') {
    const result = await store.open(target);
    gitHistory.record(result.project, 'Opened manuscript').catch(error => console.error('Git history:', error.message));
    if (result.recoveredPath) await rememberPath(result.recoveredPath);
    await rememberPath(target);
    return result;
  }
  if (!['.odt', '.docx', '.txt', '.md', '.html', '.htm'].includes(extension)) throw new Error('Choose a WRAITER, ODT, DOCX, text, Markdown, or HTML document.');
  const bytes = await readLimited(target);
  return { import: true, name: path.basename(target, extension), extension, bytes: new Uint8Array(bytes) };
}
function updateMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(command => win?.webContents.send('command', command), () => win?.close(), prefs.hotkeys)));
}
function setDocumentLanguage(language) {
  const session = win.webContents.session;
  const resolved = spellLanguage(language, session.availableSpellCheckerLanguages || []);
  if (resolved) session.setSpellCheckerLanguages([resolved]);
  else session.setSpellCheckerLanguages([]);
  return { language, dictionary: resolved, supported: Boolean(resolved) };
}
function draftConnection(draft = {}) {
  if (typeof draft === 'string') return resolveTask(prefs, draft);
  const settings = resolveTask(prefs, draft.task || 'continue');
  return { ...settings, ...validateSettings(draft) };
}
async function providerProbe(draft = {}) {
  const settings = draftConnection(draft);
  const key = typeof draft === 'object' && draft.apiKey?.trim() || (draft.clearKey ? '' : await getKey(settings));
  return providers.probe(settings, key);
}
function createWindow() {
  win = new BrowserWindow({ width: 1450, height: 960, minWidth: 960, minHeight: 650, title: 'WRAITER', icon: path.join(__dirname, '../assets/icon.png'), backgroundColor: '#ececed', frame: true, autoHideMenuBar: false, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true } });
  setDocumentLanguage(store.project?.language || prefs.language);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.on('context-menu', (_event, params) => {
    const items = params.dictionarySuggestions.slice(0, 5).map(label => ({ label, click: () => win.webContents.replaceMisspelling(label) }));
    if (params.misspelledWord) items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' });
    items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true; win.webContents.send('command', 'close-request');
    closeTimer = setTimeout(async () => {
      if (closing || closeFinishing || !win) return;
      const result = await dialog.showMessageBox(win, { type: 'warning', message: 'The editor is not responding', detail: 'The last successful recovery is preserved. Closing now may lose typing that had not reached autosave.', buttons: ['Keep open', 'Close using last recovery'], defaultId: 0, cancelId: 0 });
      if (closing || closeFinishing || !win) return;
      if (result.response === 1) { await writeQueue; await cancelAll(); await gitHistory.flush(); await providers.shutdown?.(); closing = true; win.close(); }
      else closePending = false;
    }, 10000);
  });
  win.on('closed', () => { clearTimeout(closeTimer); win = null; });
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  const savedPrefs = await tryRead('settings.json', {});
  try { prefs = { ...mergeSettings(defaults, savedPrefs), keys: savedPrefs.keys || {}, recent: savedPrefs.recent || [] }; }
  catch (error) { console.error('Some preferences were invalid:', error.message); prefs = { ...defaults, keys: savedPrefs.keys || {}, recent: savedPrefs.recent || [] }; }
  // Keys in the original preview had no endpoint scope. Preserve the active connection only; never guess another key's destination.
  if (typeof prefs.keys?.[prefs.provider] === 'string') prefs.keys[keySlot(prefs)] = prefs.keys[prefs.provider];
  for (const provider of PROVIDERS) {
    if (prefs.keys?.[provider]) { prefs.keys[`legacy:${provider}`] = prefs.keys[provider]; delete prefs.keys[provider]; }
  }
  prefs.recent = Array.isArray(prefs.recent) ? prefs.recent.filter(x => typeof x === 'string' && path.isAbsolute(x)).slice(0, 12) : [];
  store = new DocumentStore(app.getPath('userData'));
  referenceLibrary = new ReferenceLibrary(file('linked-references.json'));
  bootResult = await store.boot();
  gitHistory = new GitHistory(app.getPath('userData'));
  if (store.project) gitHistory.record(store.project, 'Recovered manuscript').catch(error => console.error('Git history:', error.message));
  updateMenu();
  createWindow();
  ipcMain.handle('boot', () => ({ ...bootResult, project: store.project, path: store.currentPath, prefs: publicPrefs(), availableSpellLanguages: win.webContents.session.availableSpellCheckerLanguages }));
  ipcMain.handle('recent:list', () => [...(prefs.recent || [])]);
  ipcMain.handle('autosave', (_e, project) => serial(async () => { const result = await store.persist(project); gitHistory.schedule(project); return result; }));
  ipcMain.handle('new-project', (_e, project) => serial(async () => {
    const result = await store.replace(project);
    gitHistory.record(project, 'New manuscript').catch(error => console.error('Git history:', error.message));
    if (result.recoveredPath) await rememberPath(result.recoveredPath);
    return result;
  }));
  ipcMain.handle('save', (_e, project, copy = false) => serial(async () => {
    validateProject(project);
    let target = store.currentPath;
    if (!target || copy) {
      const result = await dialog.showSaveDialog(win, { title: copy ? 'Save a copy' : 'Save manuscript', defaultPath: `${safeFilename(project.title)}.wraiter`, filters: [{ name: 'WRAITER manuscript', extensions: ['wraiter'] }] });
      if (result.canceled) return null;
      target = result.filePath;
      if (!target.toLowerCase().endsWith('.wraiter')) target += '.wraiter';
    }
    const result = await store.persist(project, target, !samePath(target, store.currentPath));
    await rememberPath(target);
    try { await gitHistory.record(project, copy ? 'Saved a copy' : 'Saved manuscript'); } catch (error) { result.gitWarning = error.message; }
    return result;
  }));
  ipcMain.handle('open', () => serial(async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Open or import a manuscript', properties: ['openFile'], filters: [{ name: 'Writing documents', extensions: ['wraiter', 'odt', 'docx', 'txt', 'md', 'html'] }] });
    if (result.canceled) return null;
    return openPath(result.filePaths[0]);
  }));
  ipcMain.handle('open-recent', (_e, target) => { if (!(prefs.recent || []).includes(target)) throw new Error('This document is not in the recent list.'); return serial(() => openPath(target)); });
  ipcMain.handle('reference', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Add reference material', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Text references', extensions: ['txt', 'md'] }] });
    if (result.canceled) return [];
    return referenceLibrary.addFiles(result.filePaths);
  });
  ipcMain.handle('image', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Insert an image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (result.canceled) return null;
    const target = result.filePaths[0];
    const mime = path.extname(target).slice(1).replace('jpg', 'jpeg');
    return `data:image/${mime};base64,${(await readLimited(target, 10 * 1024 * 1024)).toString('base64')}`;
  });
  ipcMain.handle('settings', async (_e, update) => serial(async () => {
    validateSettings(update);
    const { apiKey, clearKey } = update;
    const next = { ...mergeSettings(prefs, update), keys: { ...prefs.keys } };
    const keySettings = update.apiKeyTask ? resolveTask(next, update.apiKeyTask) : ('provider' in update || 'baseUrl' in update) ? next : resolveTask(next, 'continue');
    if (clearKey) delete next.keys[keySlot(keySettings)];
    if (apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable. The key was not saved.');
      next.keys[keySlot(keySettings)] = safeStorage.encryptString(apiKey.trim()).toString('base64');
    }
    await atomicWrite(file('settings.json'), JSON.stringify(next));
    prefs = next;
    if ('hotkeys' in update) updateMenu();
    if ('language' in update) setDocumentLanguage(store.project?.language || prefs.language);
    return publicPrefs();
  }));
  ipcMain.handle('generate', async (_e, request) => {
    if (!prefs.enabled) throw new Error('Enable writing assistance in Connections first.');
    if (activeRequests.size) throw new Error('A request is already running. Cancel it before starting another.');
    request = validateRequest(request);
    const settings = resolveTask(prefs, request.mode);
    request = { ...request, language: request.language || store.project?.language || prefs.language, nativeLanguage: request.nativeLanguage ?? prefs.nativeLanguage };
    const controller = new AbortController();
    let finished; controller.finished = new Promise(resolve => { finished = resolve; });
    const timeout = setTimeout(() => controller.abort(), 180000);
    activeRequests.set(request.id, controller);
    try {
      const refreshed = await referenceLibrary.refresh(request.references || [], { verifyContents: settings.provider === 'codex', signal: controller.signal });
      const warnings = refreshed.warnings.join(' ');
      if (warnings && warnings !== lastReferenceWarnings) win?.webContents.send('command', `reference-warning:${warnings}`);
      lastReferenceWarnings = warnings;
      return await providers.generate(settings, await getKey(settings), { ...request, references: refreshed.references }, controller.signal);
    }
    catch (error) { throw new Error(controller.signal.aborted ? 'Request cancelled or timed out.' : error.message); }
    finally { clearTimeout(timeout); activeRequests.delete(request.id); finished(); }
  });
  ipcMain.handle('cancel', cancelAll);
  ipcMain.handle('probe', (_e, draft) => providerProbe(draft));
  ipcMain.handle('provider:models', (_e, draft) => providerProbe(draft));
  ipcMain.handle('provider:connect', async (_e, task = 'continue') => {
    const settings = draftConnection(task);
    const key = typeof task === 'object' && task.apiKey?.trim() || (task.clearKey ? '' : await getKey(settings));
    return providers.connect(settings, key);
  });
  ipcMain.handle('provider:status', async (_e, task = 'continue') => {
    const settings = draftConnection(task);
    return settings.provider === 'codex' ? providers.connectionStatus(settings) : providerProbe(task);
  });
  ipcMain.handle('provider:reconnect', async (_e, task = 'continue') => {
    if (activeRequests.size) throw new Error('Finish or cancel the current AI request before reconnecting.');
    const settings = draftConnection(task);
    if (settings.provider === 'codex') await providers.disconnect?.();
    return providers.connect(settings, typeof task === 'object' && task.apiKey?.trim() || (task.clearKey ? '' : await getKey(settings)));
  });
  ipcMain.handle('provider:login', async (_e, task = 'continue') => {
    const settings = draftConnection(task);
    if (settings.provider !== 'codex') throw new Error('This connection uses an API key or a local server.');
    const result = await providers.login(settings);
    if (result.authUrl) {
      const url = new URL(result.authUrl);
      if (url.protocol !== 'https:' || !(['openai.com', 'chatgpt.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host)))) throw new Error('Codex returned an unexpected sign-in address.');
      await shell.openExternal(url.toString());
    }
    return result;
  });
  ipcMain.handle('fonts:list', () => fontList ||= listFonts());
  ipcMain.handle('shortcuts:capture', (_event, capturing) => { win?.webContents.setIgnoreMenuShortcuts(capturing === true); return true; });
  ipcMain.handle('document:language', (_e, language) => setDocumentLanguage(language));
  ipcMain.handle('git:list', () => store.project ? gitHistory.list(store.project.id) : { available: true, entries: [] });
  ipcMain.handle('git:revision', (_e, revision) => { if (!store.project) throw new Error('Open a manuscript first.'); return gitHistory.revision(store.project.id, revision); });
  ipcMain.handle('git:snapshot', (_e, project, label) => serial(async () => {
    await store.persist(project);
    return gitHistory.record(project, label || 'Manual checkpoint', true);
  }));
  ipcMain.handle('choose-codex', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Choose codex.exe', properties: ['openFile'], filters: [{ name: 'Codex executable', extensions: ['exe'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('export', async (_e, payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid export.');
    const { format, title, data, html } = payload;
    if (!['txt', 'md', 'html', 'pdf', 'docx', 'bbcode'].includes(format)) throw new Error('Unsupported export.');
    if (typeof title !== 'string' || title.length > 2000) throw new Error('Invalid export title.');
    if (format === 'pdf' ? typeof html !== 'string' || Buffer.byteLength(html) > 100 * 1024 * 1024 : format === 'docx' ? !(data instanceof Uint8Array || data instanceof ArrayBuffer) || data.byteLength > 100 * 1024 * 1024 : typeof data !== 'string' || Buffer.byteLength(data) > 100 * 1024 * 1024) throw new Error('Invalid or oversized export content.');
    const extension = format === 'bbcode' ? 'txt' : format;
    const result = await dialog.showSaveDialog(win, { title: `Export ${format.toUpperCase()}`, defaultPath: `${safeFilename(title)}.${extension}`, filters: [{ name: format.toUpperCase(), extensions: [extension] }] });
    if (result.canceled) return null;
    const target = result.filePath.toLowerCase().endsWith(`.${extension}`) ? result.filePath : `${result.filePath}.${extension}`;
    if (samePath(target, store.currentPath) || path.extname(target).toLowerCase() === '.wraiter') throw new Error('Choose an export filename separate from the manuscript.');
    if (format === 'pdf') {
      const print = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: false, partition: `wraiter-print-${Date.now()}` } });
      print.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      print.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
      try {
        await print.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const pdf = await print.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.8, bottom: 0.8, left: 0.8, right: 0.8 }, preferCSSPageSize: true });
        await atomicWrite(target, pdf);
      } finally { print.destroy(); }
    } else await atomicWrite(target, format === 'docx' ? Buffer.from(data) : String(data));
    return target;
  });
  ipcMain.handle('reveal', () => { if (store.currentPath) shell.showItemInFolder(store.currentPath); });
  ipcMain.handle('finish-close', async (_e, project) => {
    if (closing) return true;
    if (closeFinishing) return false;
    closeFinishing = true; clearTimeout(closeTimer);
    try { if (project) await serial(async () => { await store.persist(project); gitHistory.schedule(project); }); else await writeQueue; }
    catch (error) {
      const result = await dialog.showMessageBox(win, { type: 'warning', message: 'The latest save needs attention', detail: error.message, buttons: ['Keep writing', 'Close anyway'], defaultId: 0, cancelId: 0 });
      if (result.response === 0) { closePending = false; closeFinishing = false; return false; }
    }
    await cancelAll();
    await gitHistory.flush();
    await providers.shutdown?.();
    closing = true; win?.close(); return true;
  });
  ipcMain.on('window', (_e, action) => { if (action === 'minimize') win.minimize(); else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (action === 'close') win.close(); });
});
app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('before-quit', () => { for (const controller of activeRequests.values()) controller.abort(); });
