const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Diagnostics, observedIPC, installDiagnostics, startNativeCrashReporter, errorDetails, LOG_NAME } = require('../electron/diagnostics.cjs');

const REPORT_NAME = /^wraiter-crash-[\dTZ.-]+-[a-f0-9-]{36}\.json$/;

async function fixture(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'wraiter-crash-diagnostics-'));
  const log = new Diagnostics(root, options);
  log.ensureDirectory();
  t.after(async () => {
    clearInterval(log.timer); await log.cleanupPending;
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('wraiter-crash-diagnostics-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { root, log };
}

async function records(log) {
  const files = (await fs.readdir(log.directory)).filter(name => LOG_NAME.test(name));
  return (await Promise.all(files.map(name => fs.readFile(path.join(log.directory, name), 'utf8'))))
    .flatMap(text => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
}

async function reports(log) {
  const files = (await fs.readdir(log.directory)).filter(name => REPORT_NAME.test(name));
  return Promise.all(files.map(async name => ({ name, report: JSON.parse(await fs.readFile(path.join(log.directory, name), 'utf8')) })));
}

function nodes(error) {
  return 1 + (error.cause ? nodes(error.cause) : 0) + (error.errors || []).reduce((sum, child) => sum + nodes(child), 0);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('nested error evidence is private, bounded, and cycle-safe', () => {
  const cause = Object.assign(new TypeError('Permission denied reading PRIVATE_DOCUMENT with PRIVATE_KEY'), { code: 'EACCES' });
  cause.stack = 'TypeError: PRIVATE_DOCUMENT\n    at PRIVATE_FUNCTION (D:\\PRIVATE_USER\\WRAITER\\electron\\document-files.cjs:31:7)';
  const wrapper = new Error('PRIVATE_WRAPPER', { cause });
  wrapper.stack = 'Error: PRIVATE_WRAPPER\n    at file:///D:/PRIVATE_USER/WRAITER/src/App.jsx:14:9';
  wrapper.componentStack = '\n    at PRIVATE_COMPONENT (file:///D:/PRIVATE_USER/WRAITER/src/App.jsx:18:3)';
  cause.cause = wrapper;
  const safe = errorDetails(wrapper);
  assert.equal(safe.cause.name, 'TypeError');
  assert.equal(safe.cause.code, 'EACCES');
  assert.equal(safe.cause.category, 'permission');
  assert.deepEqual(safe.cause.locations, ['electron/document-files.cjs:31:7']);
  assert.deepEqual(safe.componentLocations, ['src/App.jsx:18:3']);
  assert.equal(safe.cause.cause, undefined);
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_|file:|D:/);
  assert.equal(errorDetails({ category: 'timeout', message: 'PRIVATE_TEXT' }).category, 'timeout');
  assert.equal(errorDetails({ category: 'PRIVATE_CATEGORY' }).category, 'other');

  const tree = new AggregateError(Array.from({ length: 5 }, () => new AggregateError(Array.from({ length: 5 }, () => new Error('PRIVATE_TEXT')), 'PRIVATE_TEXT')), 'PRIVATE_TEXT');
  assert.ok(nodes(errorDetails(tree)) <= 8, 'total error nodes are capped even with aggregate nesting');
  assert.ok(errorDetails(tree).errors.length <= 3);
  const deep = new Error(); deep.cause = new Error(); deep.cause.cause = new Error(); deep.cause.cause.cause = new Error();
  assert.equal(errorDetails(deep).cause.cause.cause, undefined, 'only three error levels are retained');
});

test('incident reports include bounded breadcrumbs, safe runtime facts and stable fingerprints', async t => {
  let now = new Date('2026-11-06T10:00:00Z');
  const { log } = await fixture(t, { now: () => now });
  log.start({ version: 'test', electron: '44.3.0', platform: process.platform, arch: process.arch });
  log.app = { getAppMetrics: () => Array.from({ length: 30 }, (_, pid) => ({ pid, type: 'Tab', name: 'PRIVATE_PROCESS', serviceName: 'PRIVATE_SERVICE', cpu: { percentCPUUsage: 1.5 }, memory: { workingSetSize: 2048, peakWorkingSetSize: 4096 } })) };
  for (let index = 0; index < 75; index++) log.write('window.show', { windowId: index });
  const error = new TypeError('PRIVATE_FIRST_MESSAGE');
  error.stack = 'TypeError: PRIVATE_FIRST_MESSAGE\n    at /electron/main.cjs:99:3';
  log.incident('process.uncaught-exception', error);
  let found = await reports(log);
  assert.equal(found.length, 1);
  const report = found[0].report;
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.session, log.session);
  assert.match(report.reportId, /^[a-f0-9-]{36}$/);
  assert.match(report.fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(report.breadcrumbs.length, 60);
  assert.equal(report.breadcrumbs[0].windowId, 15);
  assert.equal(report.runtime.version, 'test');
  assert.ok(report.runtime.uptimeSeconds >= 0);
  assert.ok(report.runtime.memoryBytes.rss > 0);
  assert.ok(report.runtime.systemMemoryBytes.total > 0);
  assert.equal(report.runtime.processes.length, 20);
  assert.deepEqual(report.runtime.processes[0], { pid: 0, type: 'Tab', cpuPercent: 1.5, workingSetSizeKB: 2048, peakWorkingSetSizeKB: 4096 });
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|hostname|commandLine/);
  assert.ok((await records(log)).some(item => item.event === 'crash.report-written' && item.reportId === report.reportId && item.reportFile === found[0].name));

  error.message = 'PRIVATE_SECOND_MESSAGE';
  log.incident('process.uncaught-exception', error);
  assert.equal((await reports(log)).length, 1, 'same failure is throttled despite private message differences');
  now = new Date(now.getTime() + 60000);
  log.incident('process.uncaught-exception', error);
  found = await reports(log);
  assert.equal(found.length, 2);
  assert.equal(new Set(found.map(item => item.report.fingerprint)).size, 1);
  for (let index = 0; index < 40; index++) log.incident('process.renderer-gone', null, { reason: 'crashed', code: index });
  assert.equal((await reports(log)).length, 25, 'one hour bounds reports, with five slots reserved for critical process failures');
});

test('renderer error floods preserve critical report capacity and limits reset each hour', async t => {
  const startedAt = Date.parse('2026-11-06T10:00:00Z');
  let now = new Date(startedAt);
  const { log } = await fixture(t, { now: () => now });
  const rendererFlood = () => {
    for (let code = 0; code < 30; code++) log.incident('renderer.window.error', null, { code });
  };
  const processFlood = () => {
    for (let exitCode = 1; exitCode <= 10; exitCode++) log.incident('process.renderer-gone', null, { reason: 'crashed', exitCode });
  };
  rendererFlood();
  assert.equal((await reports(log)).length, 20);
  processFlood();
  let found = await reports(log);
  assert.equal(found.filter(item => item.report.event === 'process.renderer-gone').length, 5, 'five critical reports remain available after 20 renderer errors');
  assert.equal(found.length, 25);
  now = new Date(startedAt + 3599999);
  rendererFlood(); processFlood();
  assert.equal((await reports(log)).length, 25, 'exhausted budgets stay bounded before the hour ends');
  now = new Date(startedAt + 3600000);
  rendererFlood(); processFlood();
  found = await reports(log);
  assert.equal(found.length, 50, 'both regular and reserved critical capacities reset at one hour');
  assert.equal(found.filter(item => item.report.event === 'process.renderer-gone').length, 10);
});

test('different native process types and exit codes have distinct incident fingerprints', async t => {
  const { log } = await fixture(t, { now: () => new Date('2026-11-06T10:00:00Z') });
  const contexts = [
    { type: 'GPU', reason: 'crashed', exitCode: -1 },
    { type: 'GPU', reason: 'crashed', exitCode: -2 },
    { type: 'Utility', reason: 'crashed', exitCode: -1 },
  ];
  for (const context of contexts) log.incident('process.child-gone', null, context);
  log.incident('process.child-gone', null, contexts[0]);
  const found = await reports(log);
  assert.equal(found.length, 3, 'only an identical crash is deduplicated');
  assert.equal(new Set(found.map(item => item.report.fingerprint)).size, 3);
});

test('concurrent operations correlate their completion and appear in crash reports until settled', async t => {
  const { log } = await fixture(t);
  const handlers = new Map(), first = deferred(), second = deferred();
  const ipc = observedIPC({ handle: (channel, handler) => handlers.set(channel, handler) }, log);
  let calls = 0;
  ipc.handle('save', () => (++calls === 1 ? first : second).promise);
  const firstResult = handlers.get('save')({}, 'PRIVATE_DOCUMENT_1');
  const secondResult = handlers.get('save')({}, 'PRIVATE_DOCUMENT_2');
  const secondRejected = assert.rejects(secondResult, /PRIVATE_ERROR/);
  const starts = (await records(log)).filter(item => item.event === 'operation.started');
  assert.equal(starts.length, 2);
  assert.ok(starts[0].operationId);
  assert.notEqual(starts[0].operationId, starts[1].operationId);
  assert.equal(log.pendingOperations.size, 2);
  log.incident('window.unresponsive', null, { windowId: 1 });
  const report = (await reports(log))[0].report;
  assert.deepEqual(new Set(report.pendingOperations.map(item => item.operationId)), new Set(starts.map(item => item.operationId)));
  assert.ok(report.pendingOperations.every(item => item.operation === 'save' && Number.isFinite(item.durationMs) && item.durationMs >= 0));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  first.resolve({ saved: true }); await firstResult;
  assert.equal(log.pendingOperations.size, 1);
  second.reject(new Error('PRIVATE_ERROR')); await secondRejected;
  assert.equal(log.pendingOperations.size, 0);
  const all = await records(log);
  assert.equal(all.find(item => item.event === 'operation.finished').operationId, starts[0].operationId);
  assert.equal(all.find(item => item.event === 'operation.failed').operationId, starts[1].operationId);
});

test('retention removes owned crash reports while preserving dumps and unrelated files', async t => {
  const { log, root } = await fixture(t, { now: () => new Date('2026-11-06T10:00:00Z') });
  async function aged(directory, name) {
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, name);
    await fs.writeFile(target, '{}');
    await fs.utimes(target, new Date('2020-01-01Z'), new Date('2020-01-01Z'));
    return target;
  }
  const oldReport = await aged(log.directory, `wraiter-crash-2020-01-01T00-00-00.000Z-${randomUUID()}.json`);
  const unrelated = await aged(log.directory, 'private-report.json');
  const dump = await aged(log.directory, 'native-crash.dmp');
  const nativeDump = await aged(path.join(root, 'CrashDumps'), `${randomUUID()}.dmp`);
  const nestedReport = await aged(path.join(log.directory, 'nested'), `wraiter-crash-2020-01-01T00-00-00.000Z-${randomUUID()}.json`);
  const disabled = await log.configure({ logCleanupEnabled: false, logRetentionMonths: 1 });
  assert.equal(disabled.disabled, true);
  assert.ok(await fs.stat(oldReport));
  const result = await log.configure({ logCleanupEnabled: true, logRetentionMonths: 1 });
  assert.equal(result.deleted, 1);
  await assert.rejects(fs.stat(oldReport), { code: 'ENOENT' });
  for (const target of [unrelated, dump, nativeDump, nestedReport]) assert.ok(await fs.stat(target));
});

test('interrupted sessions identify the previous log session without trusting malformed markers', async t => {
  const { log, root } = await fixture(t);
  log.start({ version: 'test' });
  const restart = new Diagnostics(root); restart.start({ version: 'test' });
  const interrupted = (await records(log)).find(item => item.event === 'app.previous-session-interrupted');
  assert.equal(interrupted.previousSession, log.session);
  assert.equal(interrupted.session, restart.session);
  restart.stop();
  await fs.writeFile(path.join(log.directory, 'session.json'), JSON.stringify({ clean: false, session: 'PRIVATE_UNTRUSTED_SESSION' }));
  const malformed = new Diagnostics(root); malformed.start({ version: 'test' }); malformed.stop();
  const all = await records(log);
  assert.ok(all.some(item => item.event === 'app.previous-session-interrupted' && item.session === malformed.session && !Object.hasOwn(item, 'previousSession')));
  assert.doesNotMatch(JSON.stringify(all), /PRIVATE_/);
});

test('malformed exception objects cannot break the logging caller', async t => {
  const { log } = await fixture(t);
  const error = { get name() { throw new Error('PRIVATE_GETTER'); } };
  assert.doesNotThrow(() => log.error('renderer.window.error', error));
  assert.doesNotThrow(() => log.incident('renderer.window.error', error));
  assert.ok((await records(log)).some(item => item.event === 'renderer.window.error'));
  assert.doesNotMatch(JSON.stringify(await records(log)), /PRIVATE_/);
});

test('native crash capture requires saved opt-in and never enables upload', async t => {
  const { root, log } = await fixture(t);
  const starts = [], paths = [];
  const options = { log, app: { getVersion: () => 'test', setPath: (...args) => paths.push(args) }, crashReporter: { start: options => starts.push(options) } };
  startNativeCrashReporter(options);
  assert.equal(starts.length, 0, 'new profiles do not create native memory dumps');
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ logNativeCrashDumps: false }));
  startNativeCrashReporter(options);
  assert.equal(starts.length, 0);
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ logNativeCrashDumps: true, apiKey: 'PRIVATE_API_KEY', model: 'PRIVATE_MODEL' }));
  startNativeCrashReporter(options);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].uploadToServer, false);
  assert.equal(starts[0].submitURL, undefined);
  assert.equal(starts[0].globalExtra.wraiter_session, log.session);
  assert.deepEqual(paths, [['crashDumps', path.join(root, 'CrashDumps')]]);
  assert.equal(log.status().nativeCrashDumps.enabled, true);
  assert.doesNotMatch(JSON.stringify(starts), /PRIVATE_/);
});

test('native reporter failures expose a safe error status while capture stays disabled', async t => {
  for (const [code, expected] of [['EACCES', 'EACCES'], ['PRIVATE_UNKNOWN_CODE', 'UNAVAILABLE']]) {
    const { root, log } = await fixture(t);
    await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ logNativeCrashDumps: true }));
    startNativeCrashReporter({
      log,
      app: { getVersion: () => 'test', setPath: () => {} },
      crashReporter: { start: () => { throw Object.assign(new Error('PRIVATE_REPORTER_FAILURE'), { code }); } },
    });
    const status = log.status();
    assert.equal(status.nativeCrashDumps.enabled, false);
    assert.equal(status.nativeCrashDumps.error, expected);
    const all = await records(log);
    assert.ok(all.some(item => item.event === 'crash.native-reporter-failed'));
    assert.doesNotMatch(JSON.stringify({ status, all }), /PRIVATE_/);
  }
});

test('unhandled renderer/main failures and hangs create reports while clean process exits do not', async t => {
  const { log } = await fixture(t);
  const app = new EventEmitter(), ipc = new EventEmitter(), proc = new EventEmitter();
  ipc.handle = () => {};
  const warnings = [];
  proc.emitWarning = (...args) => warnings.push(args);
  installDiagnostics({ app, ipcMain: ipc, processObject: proc, log, dialog: {}, shell: {} });
  proc.emit('unhandledRejection', new Error('PRIVATE_REJECTION'));
  proc.emit('uncaughtExceptionMonitor', new TypeError('PRIVATE_FATAL'), 'uncaughtException');
  ipc.emit('diagnostics:error', {}, 'react.boundary', { name: 'RangeError', category: 'validation', componentStack: '\n    at /src/App.jsx:1:1' });
  app.emit('render-process-gone', {}, { id: 7 }, { reason: 'clean-exit', exitCode: 0 });
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'clean-exit', exitCode: 0 });
  const window = new EventEmitter(); window.id = 1; window.webContents = new EventEmitter(); window.webContents.id = 7;
  app.emit('browser-window-created', {}, window);
  window.emit('unresponsive');
  const found = await reports(log);
  assert.deepEqual(new Set(found.map(item => item.report.event)), new Set(['process.unhandled-rejection', 'process.uncaught-exception', 'renderer.react.boundary', 'window.unresponsive']));
  assert.equal(proc.listenerCount('uncaughtException'), 0, 'fatal exceptions retain Electron handling');
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(JSON.stringify({ found, warnings }), /PRIVATE_/);
});
