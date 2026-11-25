// Exercise the actual Electron crash paths in disposable profiles. These tests
// deliberately crash only processes launched here; no installed user session
// or real manuscript is touched. Set WRAITER_EXECUTABLE to test a packaged app.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LOG_NAME } = require('../electron/diagnostics.cjs');
const { defaults } = require('../electron/preferences.cjs');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(80);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function dumpFiles(directory) {
  const result = [];
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return result; throw error; }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await dumpFiles(target));
    else if (entry.isFile() && /\.dmp$/i.test(entry.name) && (await fs.stat(target)).size > 0) result.push(target);
  }
  return result;
}

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'crash-diagnostics-'));
  const logDirectory = path.join(userData, 'Logs'), dumpDirectory = path.join(userData, 'CrashDumps');
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ...defaults, setupComplete: true, tutorialComplete: true, enabled: false, spellcheck: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = { ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] }), env, timeout: 60000 };
  const checks = [], rendererErrors = [];
  let app, page, expectedRendererError = false, expectedRendererErrorCount = 0;
  const readLogs = async () => (await Promise.all((await fs.readdir(logDirectory)).filter(name => LOG_NAME.test(name)).map(name => fs.readFile(path.join(logDirectory, name), 'utf8')))).flatMap(text => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  const readReports = async () => Promise.all((await fs.readdir(logDirectory)).filter(name => /^wraiter-crash-.*\.json$/.test(name)).map(async name => JSON.parse(await fs.readFile(path.join(logDirectory, name), 'utf8'))));
  const currentSession = async () => JSON.parse(await fs.readFile(path.join(logDirectory, 'session.json'), 'utf8')).session;
  const command = name => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('command', value), name);

  async function launch() {
    app = await electron.launch(options); page = await app.firstWindow();
    page.on('pageerror', error => {
      if (expectedRendererError && error.message.includes('Permission denied: PRIVATE_RENDERER_SENTINEL')) expectedRendererErrorCount++;
      else rendererErrors.push(error.message);
    });
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
  }
  async function close() {
    await page.evaluate(() => window.wraiter.finishClose(null)).catch(error => { if (!/closed/.test(error.message)) throw error; });
    await app.close(); app = null;
  }
  async function exitIsolatedApp() {
    const child = app.process();
    await app.evaluate(({ app }) => app.exit(91)).catch(error => { if (!/closed/.test(error.message)) throw error; });
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'isolated application exit');
    await app.close().catch(() => {}); app = null;
  }

  try {
    await launch();
    assert.equal((await page.evaluate(() => window.wraiter.diagnosticsStatus())).nativeCrashDumps.enabled, false);
    assert.deepEqual(await dumpFiles(dumpDirectory), []);
    await command('settings-logging');
    await page.getByRole('checkbox', { name: 'Save native crash dumps', exact: true }).check();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.wraiter.diagnosticsStatus())).nativeCrashDumps.enabled, false, 'changing dump preference takes effect on restart');
    assert.equal(JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8')).logNativeCrashDumps, true);
    await close(); await launch();
    const status = await page.evaluate(() => window.wraiter.diagnosticsStatus());
    assert.equal(status.nativeCrashDumps.enabled, true);
    assert.equal(status.nativeCrashDumps.directory, dumpDirectory);
    const crashReporter = await app.evaluate(({ app, crashReporter }) => ({ directory: app.getPath('crashDumps'), uploads: crashReporter.getUploadToServer() }));
    assert.equal(crashReporter.directory, dumpDirectory); assert.equal(crashReporter.uploads, false);
    checks.push('native dumps are opt-in, persist after restart and never upload');

    // Queue two real IPC requests while the first synthetic system chooser is
    // held open. The logger must distinguish the overlapping operations.
    await app.evaluate(({ dialog }) => {
      global.crashTestPickers = [];
      dialog.showOpenDialog = () => new Promise(resolve => global.crashTestPickers.push(resolve));
    });
    await page.evaluate(() => { window.crashTestOpens = Promise.all([window.wraiter.open(), window.wraiter.open()]); });
    const session = await currentSession();
    await waitFor(async () => (await readLogs()).filter(item => item.session === session && item.event === 'operation.started' && item.operation === 'open').length === 2, 'overlapping operation starts');
    const starts = (await readLogs()).filter(item => item.session === session && item.event === 'operation.started' && item.operation === 'open');
    assert.ok(starts.every(item => item.operationId));
    assert.equal(new Set(starts.map(item => item.operationId)).size, 2);
    await waitFor(() => app.evaluate(() => global.crashTestPickers.length === 1), 'first chooser');
    await app.evaluate(() => global.crashTestPickers.shift()({ canceled: true, filePaths: [] }));
    await waitFor(() => app.evaluate(() => global.crashTestPickers.length === 1), 'second chooser');
    await app.evaluate(() => global.crashTestPickers.shift()({ canceled: true, filePaths: [] }));
    await page.evaluate(() => window.crashTestOpens);
    const finishes = (await readLogs()).filter(item => item.session === session && item.event === 'operation.finished' && item.operation === 'open');
    assert.deepEqual(new Set(finishes.map(item => item.operationId)), new Set(starts.map(item => item.operationId)));
    checks.push('overlapping IPC starts and completions have matching distinct operation IDs');

    // A real, uncaught renderer exception must retain its category while its
    // private free-text message never enters the local diagnostic artifacts.
    expectedRendererError = true;
    await page.evaluate(() => { setTimeout(() => { throw new TypeError('Permission denied: PRIVATE_RENDERER_SENTINEL'); }, 10); });
    await waitFor(async () => (await readLogs()).some(item => item.session === session && item.event === 'renderer.window.error' && item.error?.category === 'permission'), 'renderer exception category');
    await waitFor(() => expectedRendererErrorCount === 1, 'intentional renderer exception delivered to Playwright');
    expectedRendererError = false;
    checks.push('actual renderer JavaScript exception keeps safe category');

    // Leave an operation pending so the crash report has useful causal context.
    await page.evaluate(() => { void window.wraiter.open(); });
    await waitFor(() => app.evaluate(() => global.crashTestPickers.length === 1), 'pending operation at crash');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await waitFor(async () => (await readReports()).some(item => item.session === session && item.event === 'process.renderer-gone'), 'renderer crash report');
    const report = (await readReports()).find(item => item.session === session && item.event === 'process.renderer-gone');
    assert.ok(report.runtime && typeof report.runtime === 'object');
    assert.ok(Array.isArray(report.breadcrumbs) && report.breadcrumbs.some(item => item.event === 'operation.started' && item.operation === 'open'));
    assert.ok(Array.isArray(report.pendingOperations) && report.pendingOperations.some(item => item.operation === 'open' && item.operationId));
    await waitFor(async () => (await dumpFiles(dumpDirectory)).length > 0, 'renderer native dump');
    checks.push('actual renderer crash saves a native dump and structured report with pending operation and breadcrumbs');
    await exitIsolatedApp(); await launch();
    assert.ok((await readLogs()).some(item => item.event === 'app.previous-session-interrupted' && item.previousSession === session));

    const mainSession = await currentSession();
    await app.evaluate(() => { setTimeout(() => { Promise.reject(new TypeError('Network failed: PRIVATE_REJECTION_SENTINEL')); }, 10); });
    await waitFor(async () => (await readReports()).some(item => item.session === mainSession && item.event === 'process.unhandled-rejection'), 'main unhandled rejection report');
    const rejection = (await readReports()).find(item => item.session === mainSession && item.event === 'process.unhandled-rejection');
    assert.equal(rejection.error.name, 'TypeError'); assert.equal(rejection.error.category, 'connection');
    checks.push('actual unhandled main-process promise rejection saves a structured report');

    const priorDumps = new Set(await dumpFiles(dumpDirectory)), child = app.process();
    await app.evaluate(() => { setTimeout(() => process.crash(), 100); });
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'native main-process crash');
    await app.close().catch(() => {}); app = null;
    await waitFor(async () => (await dumpFiles(dumpDirectory)).some(file => !priorDumps.has(file)), 'main-process native dump');
    await launch();
    assert.ok((await readLogs()).some(item => item.event === 'app.previous-session-interrupted' && item.previousSession === mainSession));
    checks.push('actual native main-process crash leaves a dump and restart identifies its session');

    assert.doesNotMatch(JSON.stringify({ logs: await readLogs(), reports: await readReports() }), /PRIVATE_(?:RENDERER|REJECTION)_SENTINEL/);
    assert.deepEqual(rendererErrors, []);
    await close();
    assert.equal(JSON.parse(await fs.readFile(path.join(logDirectory, 'session.json'), 'utf8')).clean, true);
    const result = { passed: true, packaged: Boolean(process.env.WRAITER_EXECUTABLE), checks, userData, nativeDumps: (await dumpFiles(dumpDirectory)).length, structuredReports: (await readReports()).length };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'crash-diagnostics-packaged-results.json' : 'crash-diagnostics-ui-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
