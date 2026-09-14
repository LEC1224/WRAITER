const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'onboarding-'));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const launch = async () => { app = await electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] }), env, timeout: 60000 }); return app.firstWindow(); };
  const close = async () => { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app.close().catch(() => {}); app = null; };
  try {
    let page = await launch(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('dialog', { name: 'Welcome to WRAITER' }).waitFor();
    await page.screenshot({ path: path.join(output, 'setup-welcome.png') });
    const before = await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).innerHTML();
    await app.evaluate(({ app }) => {
      // Exercise the real setup test IPC with a fake provider, without using account credits.
      const providers = process.mainModule.require(app.getAppPath() + '/electron/providers.cjs');
      providers.connect = async () => ({ connected: true, needsLogin: true, message: 'Sign in first.', models: [] });
      providers.generate = async (_settings, _key, request) => { if (request.before !== 'The morning sun' || request.references.length) throw new Error('Unexpected test content'); return 'rose over the hills.'; };
    });
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Claude Code Use your Claude Code account.' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await page.getByLabel('Helper executable', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Check my account', exact: true }).click();
    await page.getByText('Sign in first.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
    await app.evaluate(({ app }) => { process.mainModule.require(app.getAppPath() + '/electron/providers.cjs').connect = async () => ({ connected: true, needsLogin: false, models: ['sonnet'], message: 'Account checked.' }); });
    await page.getByRole('button', { name: 'Check my account', exact: true }).click();
    await page.getByText('Account checked.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Run writing test', exact: true }).click();
    await page.getByText(/Writing test passed/).waitFor();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Save and start tutorial' }).click();
    await page.locator('.walkthrough[data-step="welcome"]').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: 'End walkthrough', exact: true }).click();
    await page.locator('.walkthrough').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(async () => (await window.wraiter.boot()).prefs);
    assert.equal(saved.enabled, true); assert.equal(saved.continuous, false); assert.equal(saved.setupComplete, true); assert.equal(saved.tutorialComplete, true);
    for (const task of ['continue', 'correct', 'rewrite', 'chat']) assert.equal(saved.taskProfiles[task].provider, 'claude');

    await close(); page = await launch(); await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === '&Help').submenu.items[0].click());
    await page.getByRole('button', { name: /^Advanced/ }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByLabel('Helper executable', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'setup-advanced.png') });
    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    await page.locator('.walkthrough[data-step="welcome"]').waitFor();
    await page.getByRole('button', { name: 'End walkthrough', exact: true }).click();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === '&Help').submenu.items[1].click());
    await page.locator('.walkthrough[data-step="welcome"]').waitFor();
    assert.deepEqual(errors, []);
    console.log('Onboarding passed: first run, sign-in gate, synthetic connection test, four task assignments, tutorial practice, persistence, advanced options and Help replay. No live AI or installs.');
  } finally { if (app) await close().catch(() => app?.close()); }
})().catch(error => { console.error(error); process.exitCode = 1; });
