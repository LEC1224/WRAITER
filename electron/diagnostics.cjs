const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const os = require('node:os');
const { SourceMap } = require('node:module');

const LOG_NAME = /^wraiter-\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}-\d{4,}\.jsonl$/;
const REPORT_NAME = /^wraiter-crash-[\dTZ.-]+-[a-f0-9-]{36}\.json$/;
const UUID = /^[a-f0-9-]{36}$/;
const CATEGORIES = new Set(['cancelled', 'timeout', 'permission', 'connection', 'validation', 'other']);
const sourceMaps = new Map();
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

function locations(stack) {
  return (typeof stack === 'string' ? stack.slice(0, 16000).split('\n') : []).filter(line => /^\s+at\s/.test(line)).flatMap(line => {
    const location = line.match(/(?:[/\\])((?:electron|src|dist[/\\]assets)[/\\][a-zA-Z0-9_./\\-]+\.(?:cjs|mjs|js|jsx)):(\d+):(\d+)(?:\)?$)/)
      || line.match(/\b(node:[a-zA-Z0-9_/-]+):(\d+):(\d+)\)?$/);
    if (!location || location[1].split(/[/\\]/).includes('..')) return [];
    return [`${location[1].replaceAll('\\', '/')}:${location[2]}:${location[3]}`];
  }).slice(0, 12);
}

function originalLocation(location) {
  const match = /^dist\/assets\/([\w-]+\.js):(\d+):(\d+)$/.exec(location);
  if (!match) return null;
  try {
    if (!sourceMaps.has(match[1])) {
      if (sourceMaps.size >= 4) sourceMaps.clear();
      const file = path.join(__dirname, '../dist/assets', `${match[1]}.map`);
      sourceMaps.set(match[1], fs.statSync(file).size <= 32 * 1024 * 1024 ? new SourceMap(JSON.parse(fs.readFileSync(file, 'utf8'))) : null);
    }
    const entry = sourceMaps.get(match[1])?.findEntry(Number(match[2]) - 1, Number(match[3]) - 1);
    const source = /(?:^|\/)src\/([\w/.-]+\.(?:js|jsx|mjs))$/.exec(entry?.originalSource || '');
    if (source && !source[1].split('/').includes('..') && Number.isInteger(entry.originalLine) && Number.isInteger(entry.originalColumn)) return `src/${source[1]}:${entry.originalLine + 1}:${entry.originalColumn + 1}`;
  } catch { sourceMaps.set(match[1], null); }
  return null;
}

function errorDetails(error, depth = 0, state = { seen: new Set(), remaining: 8 }) {
  if (depth > 2 || state.remaining <= 0 || state.seen.has(error)) return undefined;
  state.remaining--;
  if (error && typeof error === 'object') state.seen.add(error);
  const get = key => { try { return error?.[key]; } catch { return undefined; } };
  // Error messages and provider responses can echo manuscript text, paths or
  // credentials. Retain the category, known code and source locations instead.
  const name = get('name'), code = get('code'), rawMessage = get('message'), category = get('category');
  const result = { name: ERROR_NAMES.has(name) ? name : 'Error' };
  if (ERROR_CODES.has(code)) result.code = code;
  const message = typeof rawMessage === 'string' ? rawMessage.slice(0, 8000) : typeof error === 'string' ? error.slice(0, 8000) : '';
  result.category = CATEGORIES.has(category) ? category : /abort|cancel/i.test(message) ? 'cancelled' : /timed? ?out|timeout/i.test(message) ? 'timeout' : /permission|access denied|not permitted/i.test(message) ? 'permission' : /network|fetch|connect|socket/i.test(message) ? 'connection' : /invalid|malformed|must be|out of range/i.test(message) ? 'validation' : 'other';
  result.locations = locations(get('stack'));
  const mapped = result.locations.map(originalLocation).filter(Boolean);
  if (mapped.length) result.sourceLocations = mapped;
  const components = locations(get('componentStack'));
  if (components.length) result.componentLocations = components;
  if (depth < 2 && state.remaining > 0) {
    const cause = get('cause'), errors = get('errors');
    if (cause != null) {
      const safe = errorDetails(cause, depth + 1, state); if (safe) result.cause = safe;
    }
    if (Array.isArray(errors)) {
      result.errors = [];
      for (let i = 0; i < Math.min(3, errors.length) && state.remaining > 0; i++) {
        try { const safe = errorDetails(errors[i], depth + 1, state); if (safe) result.errors.push(safe); } catch {}
      }
    }
  }
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
  // Delay application imports until startup crash handlers are installed.
  const { defaults, TASKS, PROVIDERS, DEFAULT_HOTKEYS } = require('./preferences.cjs');
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
    this.breadcrumbs = []; this.pendingOperations = new Map(); this.operationSequence = 0;
    this.incidentCounts = new Map(); this.incidentCount = 0; this.criticalIncidentCount = 0;
    this.incidentWindow = this.now().getTime();
    this.nativeCrashDumps = { enabled: false, directory: path.join(userData, 'CrashDumps') };
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
      const record = { time: now.toISOString(), level, event, session: this.session, ...details };
      const line = JSON.stringify(record) + '\n';
      this.breadcrumbs.push(record); if (this.breadcrumbs.length > 60) this.breadcrumbs.shift();
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
  runtime() {
    const runtime = { ...this.metadata };
    try {
      runtime.uptimeSeconds = Math.round(process.uptime());
      runtime.memoryBytes = process.memoryUsage();
      runtime.systemMemoryBytes = { free: os.freemem(), total: os.totalmem() };
      runtime.processes = (this.app?.getAppMetrics?.() || []).slice(0, 20).map(item => ({ pid: item.pid, type: item.type, cpuPercent: item.cpu?.percentCPUUsage, workingSetSizeKB: item.memory?.workingSetSize, peakWorkingSetSizeKB: item.memory?.peakWorkingSetSize }));
    } catch { /* The process may already be gone. */ }
    return runtime;
  }
  incident(event, error, details = {}) {
    try {
      const safe = error == null ? undefined : errorDetails(error);
      const fingerprint = createHash('sha256').update(JSON.stringify([event, safe, details.reason, details.code, details.exitCode, details.type, details.windowId, details.webContentsId])).digest('hex').slice(0, 16);
      const now = this.now(), previous = this.incidentCounts.get(fingerprint);
      if (now.getTime() - this.incidentWindow >= 3600000) {
        this.incidentWindow = now.getTime(); this.incidentCount = 0; this.criticalIncidentCount = 0; this.incidentCounts.clear();
      }
      const critical = /^(process\.|window\.(unresponsive|preload-failed))/.test(event);
      // Reserve five reports for process failures after a renderer error flood.
      if (previous != null && now.getTime() - previous < 60000 || (this.incidentCount >= 20 && (!critical || this.criticalIncidentCount >= 5))) return;
      this.incidentCounts.set(fingerprint, now.getTime());
      if (this.incidentCount >= 20) this.criticalIncidentCount++; else this.incidentCount++;
      const reportId = randomUUID();
      const filename = `wraiter-crash-${now.toISOString().replaceAll(':', '-')}-${reportId}.json`;
      this.ensureDirectory();
      const report = { schemaVersion: 1, reportId, fingerprint, time: now.toISOString(), event, session: this.session, ...details, ...(safe ? { error: safe } : {}), runtime: this.runtime(), pendingOperations: [...this.pendingOperations.values()].map(item => ({ ...item, durationMs: Math.max(0, now.getTime() - Date.parse(item.startedAt)) })), breadcrumbs: [...this.breadcrumbs] };
      fs.writeFileSync(path.join(this.directory, filename), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true });
      this.write('crash.report-written', { reportId, reportFile: filename, fingerprint, trigger: event }, 'error');
    } catch (failure) { this.failure(failure); }
  }
  start(metadata) {
    this.metadata = metadata;
    try {
      this.ensureDirectory();
      this.marker = path.join(this.directory, 'session.json');
      if (fs.existsSync(this.marker) && fs.lstatSync(this.marker).isSymbolicLink()) throw new Error('Invalid session file.');
      let previous;
      try { previous = JSON.parse(fs.readFileSync(this.marker, 'utf8')); } catch {}
      if (previous?.clean === false) this.write('app.previous-session-interrupted', { ...(UUID.test(previous.session) ? { previousSession: previous.session } : {}) }, 'warn');
      fs.writeFileSync(this.marker, JSON.stringify({ session: this.session, clean: false }), { mode: 0o600, flush: true });
    } catch (error) { this.failure(error); }
    this.write('app.started', metadata);
  }
  stop(exitCode = 0) {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer);
    for (const recent of this.errorCounts.values()) if (recent.suppressed) this.write('logging.repeated-errors-suppressed', { count: recent.suppressed }, 'warn');
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
        if (!entry.isFile() || !(LOG_NAME.test(entry.name) || REPORT_NAME.test(entry.name))) continue;
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
  status() { return { directory: this.directory, nativeCrashDumps: this.nativeCrashDumps, cleanupEnabled: this.cleanupEnabled, retentionMonths: this.retentionMonths, failures: this.failures, lastFailure: this.lastFailure || null, lastCleanup: this.lastCleanup }; }
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
        const operationId = ++log.operationSequence;
        const context = { operation: channel, operationId };
        if (log.pendingOperations.size < 100) log.pendingOperations.set(operationId, { ...context, startedAt: log.now().toISOString() });
        if (tracked) log.write('operation.started', context);
        try {
          const result = await handler(event, ...args);
          if (tracked) log.write('operation.finished', { ...context, outcome: result === null || result?.canceled === true ? 'cancelled' : 'completed', durationMs: Math.round(performance.now() - started) });
          return result;
        } catch (error) {
          log.error('operation.failed', error, { ...context, durationMs: Math.round(performance.now() - started) });
          throw error;
        } finally { log.pendingOperations.delete(operationId); }
      });
    },
  };
}

function installDiagnostics({ app, ipcMain, dialog, shell, log, processObject = process }) {
  log.app = app;
  const observed = observedIPC(ipcMain, log);
  observed.handle('diagnostics:status', () => log.status());
  observed.handle('diagnostics:open-folder', async () => {
    log.ensureDirectory();
    const failure = await shell.openPath(log.directory);
    if (failure) throw new Error('The log folder could not be opened.');
    log.write('logging.folder-opened'); return true;
  });
  observed.handle('diagnostics:open-crash-folder', async () => {
    const directory = log.nativeCrashDumps.directory;
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Invalid crash dump directory.');
    if (await shell.openPath(directory)) throw new Error('The crash dump folder could not be opened.');
    return true;
  });
  let lastSlowTab = -Infinity;
  ipcMain.on('diagnostics:slow-tab', (_event, outgoingMs, openingMs, paintMs) => {
    if (![outgoingMs, openingMs, paintMs].every(ms => Number.isSafeInteger(ms) && ms >= 0 && ms <= 3600000)) return;
    const durationMs = outgoingMs + openingMs + paintMs, now = performance.now();
    if (durationMs < 1000 || now - lastSlowTab < 5000) return;
    lastSlowTab = now;
    log.write('workspace.slow-tab-switch', { durationMs, outgoingMs, openingMs, paintMs }, 'warn');
  });
  let minute = 0, count = 0;
  ipcMain.on('diagnostics:surface', (_event, kind, name, opened) => {
    const current = Math.floor(Date.now() / 60000);
    if (minute !== current) { minute = current; count = 0; }
    if (++count <= 240) log.surface(kind, name, opened);
  });
  ipcMain.on('diagnostics:error', (_event, source, error) => {
    if (['window.error', 'window.unhandled-rejection', 'react.boundary', 'app.operation', 'settings.operation'].includes(source)) {
      log.error(`renderer.${source}`, error);
      if (['window.error', 'window.unhandled-rejection', 'react.boundary'].includes(source)) log.incident(`renderer.${source}`, error);
    }
  });
  // Observe fatal errors without swallowing Node/Electron's normal handling.
  processObject.on('uncaughtExceptionMonitor', (error, origin) => {
    const event = origin === 'unhandledRejection' ? 'process.unhandled-rejection' : 'process.uncaught-exception';
    log.error(event, error); log.incident(event, error);
  });
  // Electron uses Node's warning mode for rejected promises. The exception
  // monitor alone misses these. Keep a warning signal without echoing secrets.
  processObject.on('unhandledRejection', error => {
    log.error('process.unhandled-rejection', error); log.incident('process.unhandled-rejection', error);
    processObject.emitWarning?.('An unhandled rejection was recorded in the local diagnostics.', { code: 'WRAITER_UNHANDLED_REJECTION' });
  });
  processObject.on('warning', warning => log.error('process.warning', warning));
  app.on('render-process-gone', (_event, contents, details) => {
    const context = { webContentsId: contents.id, reason: details.reason, exitCode: details.exitCode };
    log.write('process.renderer-gone', context, details.reason === 'clean-exit' ? 'info' : 'error');
    if (details.reason !== 'clean-exit') log.incident('process.renderer-gone', null, context);
  });
  app.on('child-process-gone', (_event, details) => {
    const context = { type: details.type, reason: details.reason, exitCode: details.exitCode };
    log.write('process.child-gone', context, details.reason === 'clean-exit' ? 'info' : 'error');
    if (details.reason !== 'clean-exit') log.incident('process.child-gone', null, context);
  });
  app.on('browser-window-created', (_event, window) => {
    const windowId = window.id;
    log.write('window.created', { windowId, webContentsId: window.webContents.id });
    for (const event of ['show', 'hide', 'minimize', 'maximize', 'unmaximize', 'restore', 'closed', 'unresponsive', 'responsive']) window.on(event, () => {
      log.write(`window.${event}`, { windowId }, event === 'unresponsive' ? 'warn' : 'info');
      if (event === 'unresponsive') log.incident('window.unresponsive', null, { windowId });
    });
    window.webContents.on('did-fail-load', (_e, code, _description, _url, isMainFrame) => log.write('window.load-failed', { windowId, code, isMainFrame }, 'error'));
    window.webContents.on('preload-error', (_e, _file, error) => { log.error('window.preload-failed', error, { windowId }); log.incident('window.preload-failed', error, { windowId }); });
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

function startNativeCrashReporter({ app, crashReporter, log }) {
  try {
    // This small synchronous read runs before application modules are loaded.
    // Do not include preferences or other user data as crash annotations.
    const file = path.join(path.dirname(log.directory), 'settings.json');
    const enabled = fs.statSync(file).size <= 4 * 1024 * 1024 && JSON.parse(fs.readFileSync(file, 'utf8')).logNativeCrashDumps === true;
    if (!enabled) return;
    fs.mkdirSync(log.nativeCrashDumps.directory, { recursive: true });
    if (fs.lstatSync(log.nativeCrashDumps.directory).isSymbolicLink()) throw new Error('Invalid crash dump directory.');
    app.setPath('crashDumps', log.nativeCrashDumps.directory);
    crashReporter.start({ productName: 'WRAITER', uploadToServer: false, globalExtra: { wraiter_session: log.session, wraiter_version: app.getVersion() } });
    log.nativeCrashDumps.enabled = true;
    log.write('crash.native-reporter-started', { uploadToServer: false });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.nativeCrashDumps.error = ERROR_CODES.has(error.code) ? error.code : 'UNAVAILABLE';
      log.error('crash.native-reporter-failed', error);
    }
  }
}

module.exports = { Diagnostics, installDiagnostics, startNativeCrashReporter, observedIPC, errorDetails, settingChanges, retentionCutoff, LOG_NAME, REPORT_NAME };
