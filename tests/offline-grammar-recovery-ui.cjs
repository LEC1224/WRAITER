// A failed local grammar process must recover without another user action.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await pause(100); }
  throw new Error(label);
}

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'offline-grammar-recovery-'));
  const file = path.join(profile, 'Synthetic retry.wraiter');
  const project = { format: 'wraiter', version: 1, id: 'grammar-retry', title: 'Grammar retry', language: 'en-US', chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'She walk home.' }] }] } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: false, spellcheck: false, startup: 'new' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env } : { args: [root, file], env });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      global.grammarRetryAttempts = 0;
      ipcMain.removeHandler('offline-grammar:check');
      ipcMain.handle('offline-grammar:check', (_event, request) => {
        global.grammarRetryAttempts++;
        if (global.grammarRetryAttempts === 1) throw new Error('Synthetic transient failure');
        return request.texts.map(text => {
          const from = text.indexOf('walk');
          return from < 0 ? [] : [{ from, to: from + 4, original: 'walk', replacement: 'walks', alternatives: ['walks'], reason: 'Agreement', rule: 'lt:synthetic' }];
        });
      });
    });
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await waitFor(async () => (await editor.innerText()).includes('She walk home.'), 'Synthetic chapter did not open');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'settings-grammar'));
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('checkbox', { name: 'Local grammar hints while typing (English and Swedish)' }).check();
    await settings.getByRole('button', { name: 'Save settings' }).click(); await settings.waitFor({ state: 'hidden' });
    await waitFor(async () => await app.evaluate(() => global.grammarRetryAttempts) === 1, 'The simulated failure did not occur');
    await waitFor(() => editor.evaluate(element => element.editor.state.plugins.find(plugin => plugin.key.startsWith('localGrammar$'))?.getState(element.editor.state).status === 'degraded'), 'The degraded state was not shown');
    await pause(1000);
    assert.equal(await app.evaluate(() => global.grammarRetryAttempts), 1, 'Failures should not retry continuously');
    await editor.locator('.local-grammar-hint').filter({ hasText: /^walk$/ }).waitFor({ timeout: 15000 });
    assert.ok(await app.evaluate(() => global.grammarRetryAttempts) >= 2, 'The checker should retry automatically');
    await waitFor(() => editor.evaluate(element => element.editor.state.plugins.find(plugin => plugin.key.startsWith('localGrammar$'))?.getState(element.editor.state).status === 'ready'), 'The recovered checker did not become ready');
    assert.deepEqual(errors, []);
    console.log('PASS transient offline-engine failure reports degraded status and recovers without continuous retries');
  } finally { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
