const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { LOG_NAME } = require('../electron/diagnostics.cjs');
const { defaults } = require('../electron/preferences.cjs');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'logging-ui-')), logDirectory = path.join(userData, 'Logs');
  await fs.mkdir(logDirectory);
  const expiredLog = async () => {
    const file = path.join(logDirectory, `wraiter-2020-01-01-${randomUUID()}-0001.jsonl`);
    await fs.writeFile(file, '{}\n'); await fs.utimes(file, new Date('2020-01-01Z'), new Date('2020-01-01Z')); return file;
  };
  const initialOld = await expiredLog();
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ...defaults, setupComplete: true, tutorialComplete: true, enabled: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const readLogs = async () => (await Promise.all((await fs.readdir(logDirectory)).filter(name => LOG_NAME.test(name)).map(name => fs.readFile(path.join(logDirectory, name), 'utf8')))).flatMap(text => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  const waitFor = async predicate => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 60)); } throw new Error('Timed out waiting for log evidence.'); };
  let app, page; const failures = [], checks = [];
  async function launch() {
    app = await electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] }), env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => failures.push(error.message));
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
  }
  const command = name => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('command', value), name);
  const applySettings = async () => {
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Apply')?.disabled === false);
  };
  const saveSettings = async () => {
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' });
  };
  async function close() {
    await page.evaluate(() => window.wraiter.finishClose(null)).catch(error => { if (!/has been closed/.test(error.message)) throw error; });
    await app.close(); app = null;
  }
  try {
    await launch();
    await assert.rejects(fs.stat(initialOld), { code: 'ENOENT' }); checks.push('startup cleanup');
    await command('settings-logging');
    let retention = page.getByRole('spinbutton', { name: 'Keep logs for (months)', exact: true });
    let cleanup = page.getByRole('checkbox', { name: 'Automatically delete old logs', exact: true });
    assert.equal(await retention.inputValue(), '1'); assert.equal(await cleanup.isChecked(), true);
    await retention.fill('1.5'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.match(await page.getByRole('alert').innerText(), /whole number/);
    await retention.fill('3'); await applySettings();
    assert.equal((await page.evaluate(() => window.wraiter.diagnosticsStatus())).retentionMonths, 3);
    await cleanup.uncheck(); assert.equal(await retention.isDisabled(), true);
    await applySettings();
    assert.equal((await page.evaluate(() => window.wraiter.diagnosticsStatus())).cleanupEnabled, false);
    const keptOld = await expiredLog();
    const recentlyOld = path.join(logDirectory, `wraiter-2026-01-01-${randomUUID()}-0001.jsonl`);
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86400000);
    await fs.writeFile(recentlyOld, '{}\n'); await fs.utimes(recentlyOld, fortyFiveDaysAgo, fortyFiveDaysAgo);

    await app.evaluate(({ shell }) => { shell.openPath = async target => { global.openedLogDirectory = target; return ''; }; });
    await page.getByRole('button', { name: 'Open log folder', exact: true }).click();
    assert.equal(await app.evaluate(() => global.openedLogDirectory), logDirectory);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    await page.screenshot({ path: path.join(output, 'logging-settings-minimum.png') });
    const layout = await page.getByRole('dialog', { name: 'Settings', exact: true }).evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, bottom: element.getBoundingClientRect().bottom, screen: innerHeight }));
    assert.ok(layout.scroll <= layout.width + 1); assert.ok(layout.bottom <= layout.screen);
    await saveSettings();
    await close(); await launch();
    await command('settings-logging');
    retention = page.getByRole('spinbutton', { name: 'Keep logs for (months)', exact: true });
    cleanup = page.getByRole('checkbox', { name: 'Automatically delete old logs', exact: true });
    assert.equal(await cleanup.isChecked(), false); assert.equal(await retention.inputValue(), '3');
    assert.ok(await fs.stat(keptOld)); checks.push('cleanup toggle and retention persist across restart');
    await cleanup.check(); await applySettings();
    await assert.rejects(fs.stat(keptOld), { code: 'ENOENT' }); assert.ok(await fs.stat(recentlyOld));
    await retention.fill('1'); await saveSettings();
    await assert.rejects(fs.stat(recentlyOld), { code: 'ENOENT' }); checks.push('changed retention takes effect immediately');

    await page.getByRole('button', { name: 'Toggle writing assistant', exact: true }).click();
    await page.getByRole('button', { name: 'Close side panel', exact: true }).click();
    await command('settings-appearance');
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('tab', { name: 'Logging', exact: true }).click();
    await applySettings();
    await page.screenshot({ path: path.join(output, 'logging-settings-dark.png') });
    await saveSettings();
    await waitFor(async () => (await readLogs()).some(item => item.event === 'settings.changed' && item.changes.some(change => change.key === 'theme' && change.to === 'dark')));
    await page.waitForTimeout(200);
    const beforeTyping = (await readLogs()).length;
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).pressSequentially(' PRIVATE_MANUSCRIPT_SENTINEL has a quiet afternoon.');
    await page.waitForTimeout(1800);
    const afterTyping = await readLogs();
    assert.equal(afterTyping.length, beforeTyping, 'Typing and its autosave should not generate log entries.');
    checks.push('typing and autosave stay out of activity logs');

    await page.evaluate(async () => {
      await window.wraiter.settings({ substitutions: [{ from: 'PRIVATE_TRIGGER_SENTINEL', to: 'PRIVATE_REPLACEMENT_SENTINEL' }], taskProfiles: { chat: { provider: 'compatible', baseUrl: 'https://PRIVATE_ADDRESS_SENTINEL.example', model: 'PRIVATE_MODEL_SENTINEL' } } });
      await window.wraiter.settings({ apiKeyTask: 'chat', apiKey: 'PRIVATE_API_KEY_SENTINEL' });
      try { await window.wraiter.openRecent('PRIVATE_DOCUMENT_PATH_SENTINEL'); } catch {}
      const error = new TypeError('PRIVATE_ERROR_MESSAGE_SENTINEL');
      window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: error }));
    });
    // A real native chooser path is captured through the wrapper, with its title
    // and selected filename excluded. Stub only the system picker in this test.
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await command('open');
    await waitFor(async () => (await readLogs()).some(item => item.event === 'dialog.closed'));
    const evidence = await readLogs();
    for (const event of ['ui.dialog.opened', 'ui.dialog.closed', 'ui.settings.opened', 'ui.panel.opened', 'ui.panel.closed', 'operation.failed', 'renderer.window.error', 'renderer.window.unhandled-rejection']) assert.ok(evidence.some(item => item.event === event), event);
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_.*SENTINEL/);
    checks.push('settings, panels, native dialogs and errors log without private values');

    await close();
    assert.equal(JSON.parse(await fs.readFile(path.join(logDirectory, 'session.json'), 'utf8')).clean, true);
    checks.push('normal shutdown records a clean session');
    // Crash only an isolated test renderer. Playwright keeps a crashed Page
    // marked as crashed, so inspect evidence from Node and restart the app.
    await launch();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await waitFor(async () => (await readLogs()).some(item => item.event === 'process.renderer-gone' && item.reason !== 'clean-exit'));
    await app.evaluate(() => process.exit(91)).catch(error => { if (!/closed/.test(error.message)) throw error; });
    await app.close(); app = null;
    checks.push('actual renderer crash recorded');
    await launch();
    assert.ok((await readLogs()).some(item => item.event === 'app.previous-session-interrupted'));
    checks.push('forced main-process exit detected on restart');
    await close();
    const marker = JSON.parse(await fs.readFile(path.join(logDirectory, 'session.json'), 'utf8'));
    assert.equal(marker.clean, true); assert.deepEqual(failures, []);
    const report = { passed: true, packaged: Boolean(process.env.WRAITER_EXECUTABLE), checks, userData, screenshots: ['logging-settings-minimum.png', 'logging-settings-dark.png'] };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'logging-packaged-results.json' : 'logging-ui-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
