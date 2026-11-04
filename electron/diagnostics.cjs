const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { defaults, TASKS, PROVIDERS, DEFAULT_HOTKEYS } = require('./preferences.cjs');

const LOG_NAME = /^wraiter-\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}-\d{4,}\.jsonl$/;
const SURFACES = {
  panel: ['assist', 'references', 'notes', 'comments', 'history', 'review', 'search', 'manuscript-sidebar'],
  dialog: ['settings', 'setup', 'tutorial', 'notice', 'snapshot', 'git-preview', 'export', 'go-paragraph', 'page-setup', 'proofread', 'local-grammar', 'thesaurus', 'statistics', 'image-properties', 'link', 'rename', 'templates', 'note', 'document-notes', 'tracked-review', 'tab-stops', 'named-styles', 'table', 'format', 'delete-chapter', 'reference', 'assistant-changes', 'version-tree', 'git-restore', 'restore', 'recent', 'privacy', 'report-ai', 'about'],
  settings: ['general', 'appearance', 'grammar', 'language', 'connections', 'local', 'ai', 'hotkeys', 'logging'],
  view: ['focus'],
};
// Explicit operations only. Autosave, history append, view/cursor updates,
// background suggestions and polling never produce successful-operation logs.
const OPERATIONS = new Set(['open', 'open-recent', 'external-files:open', 'drop:open', 'new-project', 'native:bind', 'save', 'save:encoded', 'workspace:activate', 'workspace:close', 'workspace:reload', 'workspace:reorder', 'recent:clear', 'export', 'export:clipboard', 'export:preview-pdf', 'reference', 'drop:reference', 'image', 'provider:connect', 'provider:reconnect', 'provider:login', 'setup:install', 'setup:cancel', 'setup:choose', 'setup:claude-login', 'setup:test', 'local:configure', 'local:folder', 'local:start', 'local:stop', 'local:unload', 'local:install', 'local:cancel', 'local:pull', 'local:import', 'git:snapshot', 'git:activate-revision']);
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError']);
const ERROR_CODES = new Set(['EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'ENOSPC', 'EIO', 'EBUSY', 'EMFILE', 'ENFILE', 'EROFS', 'ENOTDIR', 'EISDIR', 'EINVAL', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'ABORT_ERR', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE']);

function errorDetails(error) {
  // Error messages and provider responses can echo manuscript text, paths or
  // credentials. Retain the category, known code and source locations instead.
  const result = { name: ERROR_NAMES.has(error?.name) ? error.name : 'Error' };
  if (ERROR_CODES.has(error?.code)) result.code = error.code;
  const message = typeof error?.message === 'string' ? error.message.slice(0, 8000) : '';
  result.category = /abort|cancel/i.test(message) ? 'cancelled' : /timed? ?out|timeout/i.test(message) ? 'timeout' : /permission|access denied|not permitted/i.test(message) ? 'permission' : /network|fetch|connect|socket/i.test(message) ? 'connection' : /invalid|malformed|must be|out of range/i.test(message) ? 'validation' : 'other';
  const frames = typeof error?.stack === 'string' ? error.stack.slice(0, 16000).split('\n').slice(1) : [];
  result.locations = frames.filter(line => /^\s+at\s/.test(line)).flatMap(line => {
    const location = line.match(/(?:[/\\])((?:electron|src|dist[/\\]assets)[/\\][a-zA-Z0-9_./\\-]+\.(?:cjs|mjs|js|jsx)):(\d+):(\d+)(?:\)?$)/)
      || line.match(/\b(node:[a-zA-Z0-9_/-]+):(\d+):(\d+)\)?$/);
    return location ? [`${location[1].replaceAll('\\', '/')}:${location[2]}:${location[3]}`] : [];
  }).slice(0, 12);
  return result;
}

function retentionCutoff(now, months) {
  const cutoff = new Date(now), day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff.getTime();
}

function settingChanges(previous, next) {
  const changes = [];
  const enums = { provider: PROVIDERS, theme: ['paper', 'dark', 'contrast'], startup: ['new', 'restore'], pageMode: ['continuous', 'pages'], ollamaMode: ['auto', 'guided', 'raw'], setupMode: ['simple', 'advanced'] };
  function changed(key, before, after, allowed) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const safe = value => typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || allowed?.includes(value);
    changes.push({ key, ...(safe(before) && safe(after) ? { from: before, to: after } : { value: 'changed' }) });
  }
  for (const key of Object.keys(defaults)) {
    // Walkthrough state advances during typing; it isn't a settings action.
    if (key === 'tutorialSession') continue;
    if (key === 'taskProfiles') {
      for (const task of TASKS) for (const field of ['provider', 'baseUrl', 'model', 'codexPath', 'claudePath']) changed(`taskProfiles.${task}.${field}`, previous.taskProfiles?.[task]?.[field] ?? previous[field], next.taskProfiles?.[task]?.[field] ?? next[field], field === 'provider' ? PROVIDERS : undefined);
    } else if (key === 'hotkeys') {
      for (const command of Object.keys(DEFAULT_HOTKEYS)) changed(`hotkeys.${command}`, previous.hotkeys?.[command], next.hotkeys?.[command]);
    } else changed(key, previous[key], next[key], enums[key]);
  }
  if (JSON.stringify(previous.keys) !== JSON.stringify(next.keys)) changes.push({ key: 'credentials', value: 'changed' });
  return changes;
}

class Diagnostics {
  constructor(userData, { now = () => new Date(), maxBytes = 2 * 1024 * 1024 } = {}) {
    this.directory = path.join(userData, 'Logs');
    this.now = now; this.maxBytes = maxBytes; this.session = randomUUID();
    this.cleanupEnabled = true; this.retentionMonths = 1; this.failures = 0;
    this.part = 0; this.bytes = 0; this.day = ''; this.currentFile = null;
    this.errorCounts = new Map(); this.lastCleanup = null; this.cleanupPending = null;
  }
  ensureDirectory() {
    fs.mkdirSync(this.directory, { recursive: true });
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid diagnostics directory.');
  }
  failure(error) { this.failures++; this.lastFailure = ERROR_CODES.has(error?.code) ? error.code : 'UNAVAILABLE'; }
  write(event, details = {}, level = 'info') {
    try {
      this.ensureDirectory();
      const now = this.now(), day = now.toISOString().slice(0, 10);
      const line = JSON.stringify({ time: now.toISOString(), level, event, session: this.session, ...details }) + '\n';
      if (!this.currentFile || this.day !== day || this.bytes + Buffer.byteLength(line) > this.maxBytes) {
        this.day = day; this.bytes = 0;
        this.currentFile = path.join(this.directory, `wraiter-${day}-${this.session}-${String(++this.part).padStart(4, '0')}.jsonl`);
      }
      // Small, infrequent records are synchronous so the final crash/exit record
      // reaches disk before Electron exits. No editor/typing events use this path.
      if (fs.existsSync(this.currentFile) && fs.lstatSync(this.currentFile).isSymbolicLink()) throw new Error('Invalid diagnostics file.');
      fs.appendFileSync(this.currentFile, line, { encoding: 'utf8', mode: 0o600 });
      this.bytes += Buffer.byteLength(line);
      return true;
    } catch (error) { this.failure(error); return false; }
  }
  error(event, error, details = {}) {
    const safe = errorDetails(error), now = this.now().getTime();
    const key = JSON.stringify([event, details.operation, safe]);
    let recent = this.errorCounts.get(key);
    if (!recent || now - recent.since >= 60000) {
      if (recent?.suppressed) this.write('logging.repeated-errors-suppressed', { operation: event, count: recent.suppressed }, 'warn');
      if (this.errorCounts.size >= 100) this.errorCounts.clear();
      recent = { since: now, count: 0, suppressed: 0 }; this.errorCounts.set(key, recent);
    }
    if (++recent.count > 5) { recent.suppressed++; return; }
    this.write(event, { ...details, error: safe }, 'error');
  }
  start(metadata) {
    try {
      this.ensureDirectory();
      this.marker = path.join(this.directory, 'session.json');
      if (fs.existsSync(this.marker) && fs.lstatSync(this.marker).isSymbolicLink()) throw new Error('Invalid session file.');
      let previous;
      try { previous = JSON.parse(fs.readFileSync(this.marker, 'utf8')); } catch {}
      if (previous?.clean === false) this.write('app.previous-session-interrupted', {}, 'warn');
      fs.writeFileSync(this.marker, JSON.stringify({ session: this.session, clean: false }), { mode: 0o600 });
    } catch (error) { this.failure(error); }
    this.write('app.started', metadata);
  }
  stop(exitCode = 0) {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer);
    this.write('app.exited', { exitCode }, exitCode === 0 ? 'info' : 'error');
    try {
      if (this.marker && !fs.lstatSync(this.marker).isSymbolicLink()) fs.writeFileSync(this.marker, JSON.stringify({ session: this.session, clean: exitCode === 0 }), { mode: 0o600 });
    } catch (error) { this.failure(error); }
  }
  configure(prefs) {
    this.cleanupEnabled = prefs.logCleanupEnabled !== false;
    this.retentionMonths = Number.isInteger(prefs.logRetentionMonths) && prefs.logRetentionMonths >= 1 && prefs.logRetentionMonths <= 24 ? prefs.logRetentionMonths : 1;
    clearInterval(this.timer);
    if (this.cleanupEnabled) {
      this.timer = setInterval(() => this.cleanup(), 60 * 60 * 1000); this.timer.unref?.();
      return this.cleanup();
    }
    return Promise.resolve({ deleted: 0, disabled: true });
  }
  cleanup() {
    if (!this.cleanupEnabled) return Promise.resolve({ deleted: 0, disabled: true });
    if (this.cleanupPending) return this.cleanupPending;
    if (this.day && this.day !== this.now().toISOString().slice(0, 10)) this.currentFile = null;
    this.cleanupPending = this.removeExpired().finally(() => { this.cleanupPending = null; });
    return this.cleanupPending;
  }
  async removeExpired() {
    let deleted = 0, failed = 0;
    try {
      this.ensureDirectory();
      const entries = await fs.promises.readdir(this.directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!this.cleanupEnabled) break;
        if (!entry.isFile() || !LOG_NAME.test(entry.name)) continue;
        const target = path.resolve(this.directory, entry.name);
        if (path.dirname(target) !== path.resolve(this.directory) || target === this.currentFile) continue;
        try {
          const stat = await fs.promises.lstat(target);
          // Re-read the policy immediately before unlink: Settings may have
          // disabled cleanup or extended retention while the scan was running.
          if (this.cleanupEnabled && stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < retentionCutoff(this.now(), this.retentionMonths)) {
            await fs.promises.unlink(target); deleted++;
          }
        } catch (error) { if (error.code !== 'ENOENT') { failed++; this.failure(error); } }
      }
      this.lastCleanup = { time: this.now().toISOString(), deleted, failed };
      if (deleted || failed) this.write('logging.cleanup', { deleted, failed, retentionMonths: this.retentionMonths }, failed ? 'warn' : 'info');
    } catch (error) { this.failure(error); failed++; }
    return { deleted, failed };
  }
  status() { return { directory: this.directory, cleanupEnabled: this.cleanupEnabled, retentionMonths: this.retentionMonths, failures: this.failures, lastFailure: this.lastFailure || null, lastCleanup: this.lastCleanup }; }
  settingsChanged(previous, next) {
    const changes = settingChanges(previous, next);
    if (changes.length) this.write('settings.changed', { changes });
  }
  surface(kind, name, opened) {
    if (!Object.hasOwn(SURFACES, kind) || !SURFACES[kind].includes(name) || typeof opened !== 'boolean') return false;
    this.write(`ui.${kind}.${opened ? 'opened' : 'closed'}`, { name }); return true;
  }
}

function observedIPC(ipcMain, log) {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, async (event, ...args) => {
        const started = performance.now(), tracked = OPERATIONS.has(channel);
        if (tracked) log.write('operation.started', { operation: channel });
        try {
          const result = await handler(event, ...args);
          if (tracked) log.write('operation.finished', { operation: channel, outcome: result === null || result?.canceled === true ? 'cancelled' : 'completed', durationMs: Math.round(performance.now() - started) });
          return result;
        } catch (error) {
          log.error('operation.failed', error, { operation: channel, durationMs: Math.round(performance.now() - started) });
          throw error;
        }
      });
    },
  };
}

function installDiagnostics({ app, ipcMain, dialog, shell, log, processObject = process }) {
  const observed = observedIPC(ipcMain, log);
  observed.handle('diagnostics:status', () => log.status());
  observed.handle('diagnostics:open-folder', async () => {
    log.ensureDirectory();
    const failure = await shell.openPath(log.directory);
    if (failure) throw new Error('The log folder could not be opened.');
    log.write('logging.folder-opened'); return true;
  });
  let minute = 0, count = 0;
  ipcMain.on('diagnostics:surface', (_event, kind, name, opened) => {
    const current = Math.floor(Date.now() / 60000);
    if (minute !== current) { minute = current; count = 0; }
    if (++count <= 240) log.surface(kind, name, opened);
  });
  ipcMain.on('diagnostics:error', (_event, source, error) => {
    if (['window.error', 'window.unhandled-rejection', 'react.boundary', 'app.operation', 'settings.operation'].includes(source)) log.error(`renderer.${source}`, error);
  });
  // Observe fatal errors without swallowing Node/Electron's normal handling.
  processObject.on('uncaughtExceptionMonitor', (error, origin) => log.error(origin === 'unhandledRejection' ? 'process.unhandled-rejection' : 'process.uncaught-exception', error));
  processObject.on('warning', warning => log.error('process.warning', warning));
  app.on('render-process-gone', (_event, contents, details) => log.write('process.renderer-gone', { windowId: contents.id, reason: details.reason, exitCode: details.exitCode }, details.reason === 'clean-exit' ? 'info' : 'error'));
  app.on('child-process-gone', (_event, details) => log.write('process.child-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode }, details.reason === 'clean-exit' ? 'info' : 'error'));
  app.on('browser-window-created', (_event, window) => {
    const windowId = window.id;
    log.write('window.created', { windowId });
    for (const event of ['show', 'hide', 'minimize', 'maximize', 'unmaximize', 'restore', 'closed', 'unresponsive', 'responsive']) window.on(event, () => log.write(`window.${event}`, { windowId }, event === 'unresponsive' ? 'warn' : 'info'));
    window.webContents.on('did-fail-load', (_e, code, _description, _url, isMainFrame) => log.write('window.load-failed', { windowId, code, isMainFrame }, 'error'));
    window.webContents.on('preload-error', (_e, _file, error) => log.error('window.preload-failed', error, { windowId }));
  });
  app.on('quit', (_event, exitCode) => log.stop(exitCode));
  // Wrap only the dialog object passed to WRAITER's code, not Electron globals.
  const dialogs = Object.create(dialog);
  for (const [method, kind] of Object.entries({ showOpenDialog: 'open-file', showSaveDialog: 'save-file', showMessageBox: 'message' })) {
    dialogs[method] = async (...args) => {
      log.write('dialog.opened', { kind });
      try { return await dialog[method](...args); }
      finally { log.write('dialog.closed', { kind }); }
    };
  }
  return { handle: observed.handle, dialog: dialogs };
}

module.exports = { Diagnostics, installDiagnostics, observedIPC, errorDetails, settingChanges, retentionCutoff, LOG_NAME };
