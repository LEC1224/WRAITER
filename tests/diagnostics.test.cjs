const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { Diagnostics, installDiagnostics, observedIPC, errorDetails, settingChanges, retentionCutoff, LOG_NAME } = require('../electron/diagnostics.cjs');
const { defaults, mergeSettings, validateSettings } = require('../electron/preferences.cjs');

async function fixture(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'wraiter-logs-'));
  const log = new Diagnostics(root, options);
  t.after(async () => {
    clearInterval(log.timer); await log.cleanupPending;
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-logs-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { log, root };
}
async function records(log) {
  const files = (await fs.readdir(log.directory)).filter(name => LOG_NAME.test(name)).sort();
  return (await Promise.all(files.map(name => fs.readFile(path.join(log.directory, name), 'utf8')))).flatMap(text => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
}
async function aged(directory, time) {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `wraiter-${time.slice(0, 10)}-${randomUUID()}-0001.jsonl`);
  await fs.writeFile(file, '{}\n'); await fs.utimes(file, new Date(time), new Date(time)); return file;
}

test('records survive reopening; rotation bounds files and timestamps identify sessions', async t => {
  let now = new Date('2026-11-02T10:00:00Z');
  const { log } = await fixture(t, { now: () => now, maxBytes: 450 });
  log.start({ version: '0.18.0' });
  for (let i = 0; i < 8; i++) log.surface('dialog', 'settings', i % 2 === 0);
  const firstDay = (await fs.readdir(log.directory)).filter(name => LOG_NAME.test(name));
  assert.ok(firstDay.length > 1);
  for (const file of firstDay) assert.ok((await fs.stat(path.join(log.directory, file))).size <= 450);
  now = new Date('2026-11-03T10:00:00Z'); log.surface('panel', 'assist', true);
  assert.ok(path.basename(log.currentFile).startsWith('wraiter-2026-11-03-'));
  log.stop();
  const all = await records(log);
  assert.equal(all.length, 11); assert.equal(all.at(-1).event, 'app.exited');
  assert.ok(all.every(record => record.session === log.session && !Number.isNaN(Date.parse(record.time))));
  assert.equal(JSON.parse(await fs.readFile(path.join(log.directory, 'session.json'), 'utf8')).clean, true);
});

test('settings diffs retain safe values and omit secret/text values and typing-related tutorial progress', () => {
  const previous = mergeSettings(defaults, {});
  const next = mergeSettings(previous, { theme: 'dark', logCleanupEnabled: false, logRetentionMonths: 3, model: 'PRIVATE_MODEL', baseUrl: 'https://PRIVATE_HOST/SECRET', substitutions: [{ from: 'SECRET_TRIGGER', to: 'PRIVATE_PROSE' }], taskProfiles: { chat: { provider: 'openai', model: 'PRIVATE_TASK_MODEL' } }, hotkeys: { save: 'SECRET_SHORTCUT' } });
  next.keys = { PRIVATE_ENDPOINT: 'PRIVATE_KEY' }; next.tutorialSession = { SECRET: 'PRIVATE_TOUR' };
  const changes = settingChanges(previous, next), serialized = JSON.stringify(changes);
  assert.doesNotMatch(serialized, /PRIVATE_|SECRET/);
  assert.ok(changes.some(item => item.key === 'theme' && item.from === 'paper' && item.to === 'dark'));
  assert.ok(changes.some(item => item.key === 'logRetentionMonths' && item.to === 3));
  assert.ok(changes.some(item => item.key === 'credentials'));
  assert.deepEqual(settingChanges(previous, { ...previous, tutorialSession: { step: 4 } }), []);
  assert.equal(defaults.logCleanupEnabled, true); assert.equal(defaults.logRetentionMonths, 1);
  for (const update of [{ logCleanupEnabled: 'no' }, { logRetentionMonths: 0 }, { logRetentionMonths: 25 }, { logRetentionMonths: 1.5 }, { logRetentionMonths: NaN }]) assert.throws(() => validateSettings(update));
});

test('errors keep useful code locations without messages, credentials, filenames or absolute paths', () => {
  const error = { name: 'TypeError', code: 'ENOSPC', message: 'PRIVATE_PROSE PRIVATE_KEY', stack: 'TypeError: PRIVATE_PROSE\n    at save (D:\\PrivateUser\\WRAITER\\electron\\main.cjs:349:8)\n    at D:\\Personal\\PRIVATE_FILE.txt:9:1\n    at file:///D:/PrivateUser/WRAITER/dist/assets/index-abc.js:20:7\n    at node:fs:19:1' };
  const safe = errorDetails(error);
  assert.equal(safe.name, 'TypeError'); assert.equal(safe.code, 'ENOSPC');
  assert.deepEqual(safe.locations, ['electron/main.cjs:349:8', 'dist/assets/index-abc.js:20:7', 'node:fs:19:1']);
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_|PrivateUser|Personal|D:/);
  assert.deepEqual(errorDetails('PRIVATE_PROSE'), { name: 'Error', category: 'other', locations: [] });
});

test('only explicit operations and accepted surfaces are logged; payloads and polling stay out', async t => {
  const { log } = await fixture(t); const handlers = new Map();
  const ipc = observedIPC({ handle: (name, callback) => handlers.set(name, callback) }, log);
  ipc.handle('autosave', () => ({ text: 'PRIVATE_PROSE' }));
  ipc.handle('history:append', () => true);
  ipc.handle('workspace:view', () => true);
  ipc.handle('save', () => ({ path: 'PRIVATE_PATH', text: 'PRIVATE_PROSE' }));
  ipc.handle('open', () => null);
  ipc.handle('export', () => { throw new TypeError('PRIVATE_KEY'); });
  for (const name of ['autosave', 'history:append', 'workspace:view', 'save', 'open']) await handlers.get(name)({}, 'PRIVATE_PROSE');
  await assert.rejects(handlers.get('export')({}, 'PRIVATE_PAYLOAD'), /PRIVATE_KEY/);
  assert.equal(log.surface('panel', 'assist', true), true);
  assert.equal(log.surface('panel', 'PRIVATE_TITLE', true), false);
  assert.equal(log.surface('typing', 'a', true), false);
  const all = await records(log), serialized = JSON.stringify(all);
  assert.doesNotMatch(serialized, /PRIVATE_|autosave|history:append|workspace:view/);
  assert.ok(all.some(item => item.operation === 'save' && item.outcome === 'completed' && item.durationMs >= 0));
  assert.ok(all.some(item => item.operation === 'open' && item.outcome === 'cancelled'));
  assert.ok(all.some(item => item.operation === 'export' && item.event === 'operation.failed'));
});

test('cleanup uses calendar months, modification age, and only owned log files', async t => {
  const now = new Date('2026-03-31T12:30:00Z'), cutoff = retentionCutoff(now, 1);
  assert.equal(new Date(cutoff).toISOString(), '2026-02-28T12:30:00.000Z');
  assert.equal(new Date(retentionCutoff(new Date('2024-03-31T12:30:00Z'), 1)).toISOString(), '2024-02-29T12:30:00.000Z');
  const { log, root } = await fixture(t, { now: () => now });
  const expired = await aged(log.directory, '2026-02-28T12:29:59Z');
  const boundary = await aged(log.directory, '2026-02-28T12:30:00Z');
  const kept = await aged(log.directory, '2026-03-30T00:00:00Z');
  const recentlyWritten = await aged(log.directory, '2026-01-01T00:00:00Z');
  await fs.utimes(recentlyWritten, now, now);
  const unrelated = path.join(log.directory, 'my-notes.txt'); await fs.writeFile(unrelated, 'private'); await fs.utimes(unrelated, new Date(0), new Date(0));
  const nested = path.join(log.directory, 'nested'); const nestedFile = await aged(nested, '2020-01-01T00:00:00Z');
  const outside = await aged(root, '2020-01-01T00:00:00Z');
  const result = await log.configure({ logCleanupEnabled: true, logRetentionMonths: 1 });
  assert.equal(result.deleted, 1); await assert.rejects(fs.stat(expired), { code: 'ENOENT' });
  for (const file of [boundary, kept, recentlyWritten, unrelated, nestedFile, outside]) assert.ok(await fs.stat(file));
});

test('cleanup toggle and changed retention apply immediately and survive the saved settings format', async t => {
  const { log } = await fixture(t, { now: () => new Date('2026-11-02T10:00:00Z') });
  const old = await aged(log.directory, '2026-08-15T00:00:00Z');
  const disabled = JSON.parse(JSON.stringify(mergeSettings(defaults, { logCleanupEnabled: false, logRetentionMonths: 1 })));
  await log.configure(disabled); assert.equal((await log.cleanup()).disabled, true); assert.ok(await fs.stat(old));
  await log.configure({ logCleanupEnabled: true, logRetentionMonths: 3 }); assert.ok(await fs.stat(old));
  await log.configure({ logCleanupEnabled: true, logRetentionMonths: 1 }); await assert.rejects(fs.stat(old), { code: 'ENOENT' });
});

test('hourly cleanup expires logs during a long-running session', async t => {
  let now = new Date('2026-11-02T10:00:00Z');
  const { log } = await fixture(t, { now: () => now });
  const old = await aged(log.directory, '2026-10-02T10:30:00Z');
  t.mock.timers.enable({ apis: ['setInterval'] });
  await log.configure(defaults); assert.ok(await fs.stat(old));
  now = new Date('2026-11-02T11:00:00Z'); t.mock.timers.tick(3600000); await log.cleanupPending;
  await assert.rejects(fs.stat(old), { code: 'ENOENT' });
});

test('cleanup does not follow a linked Logs directory; write failures never break the caller', async t => {
  const { log, root } = await fixture(t);
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  const sentinel = await aged(outside, '2020-01-01T00:00:00Z');
  await fs.symlink(outside, log.directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(log.write('app.started'), false);
  await log.configure(defaults);
  assert.ok(await fs.stat(sentinel)); assert.ok(log.status().failures >= 2);
});

test('an interrupted session is reported on restart and a clean exit clears the marker', async t => {
  const { log, root } = await fixture(t);
  log.start({ version: 'test' });
  const restart = new Diagnostics(root); restart.start({ version: 'test' }); restart.stop();
  const clean = new Diagnostics(root); clean.start({ version: 'test' }); clean.stop();
  const all = await records(log);
  assert.equal(all.filter(item => item.event === 'app.previous-session-interrupted').length, 1);
  const failed = new Diagnostics(root); failed.start({ version: 'test' }); failed.stop(91);
  const afterFailure = new Diagnostics(root); afterFailure.start({ version: 'test' }); afterFailure.stop();
  assert.equal((await records(log)).filter(item => item.event === 'app.previous-session-interrupted').length, 2);
});

test('repeated errors are bounded and fatal/process events preserve normal exception handling', async t => {
  const { log } = await fixture(t);
  for (let i = 0; i < 200; i++) log.error('operation.failed', new Error('SECRET'));
  assert.equal((await records(log)).length, 5);
  const app = new EventEmitter(), ipc = new EventEmitter(), proc = new EventEmitter(); ipc.handle = () => {};
  installDiagnostics({ app, ipcMain: ipc, processObject: proc, log, dialog: {}, shell: {} });
  assert.equal(proc.listenerCount('uncaughtException'), 0); assert.equal(proc.listenerCount('unhandledRejection'), 0);
  proc.emit('uncaughtExceptionMonitor', new TypeError('PRIVATE_FATAL'), 'unhandledRejection');
  app.emit('render-process-gone', {}, { id: 7 }, { reason: 'crashed', exitCode: -1 });
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'oom', exitCode: -2, name: 'PRIVATE_PROCESS_NAME' });
  const all = await records(log);
  assert.ok(all.some(item => item.event === 'process.unhandled-rejection'));
  assert.ok(all.some(item => item.event === 'process.renderer-gone' && item.reason === 'crashed'));
  assert.doesNotMatch(JSON.stringify(all), /PRIVATE_|SECRET/);
});
