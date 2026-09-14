// Opt-in: sends two short, real requests through the user's saved Codex account.
// Uses a separate WRAITER profile and a synthetic tutorial manuscript only.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { defaults } = require('../electron/preferences.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'tutorial-live-'));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ...defaults, setupComplete: true, tutorialComplete: true, enabled: true, provider: 'codex', model: '', predictionWords: 25 }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] }), env, timeout: 60000 });
    const page = await app.firstWindow(), editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message)); await editor.waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'tutorial'));
    await page.locator('.walkthrough[data-step="welcome"]').waitFor(); await page.getByRole('button', { name: 'Let’s begin', exact: true }).click();
    await page.getByRole('button', { name: 'New chapter', exact: true }).click(); await page.locator('.walkthrough[data-step="complete"]').waitFor();
    await editor.press('Tab'); await page.locator('.ghost-text').waitFor({ timeout: 180000 });
    const completion = await page.locator('.ghost-text').innerText(); assert.ok(completion.trim().length > 5);
    console.log('Live Codex continuation received:', completion.trim());
    await page.screenshot({ path: path.join(output, 'walkthrough-live-completion.png') });
    await editor.press('Control+ArrowRight'); await editor.press('Tab'); await page.locator('.walkthrough[data-step="practice"]').waitFor();
    await page.getByRole('button', { name: 'Try changing a word', exact: true }).click();
    await page.waitForFunction(() => window.getSelection()?.toString() === 'software');
    await editor.press('Tab'); await page.getByRole('listbox', { name: 'Rephrasing alternatives' }).waitFor({ timeout: 180000 });
    const options = await page.getByRole('listbox', { name: 'Rephrasing alternatives' }).getByRole('option').allTextContents(); assert.ok(options.length > 0); console.log('Live Codex rephrasing received:', options.join(' | '));
    await page.screenshot({ path: path.join(output, 'walkthrough-live-rephrase.png') });
    const before = await editor.innerText(); await editor.press('Enter'); assert.notEqual(await editor.innerText(), before);
    await page.getByRole('button', { name: 'Explore undo', exact: true }).click(); await editor.press('Control+z');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent.includes('a software called Wraiter'));
    assert.deepEqual(errors, []);
    console.log('PASS: live Codex completion, partial/full acceptance, selected-word alternatives and undo in the actual tutorial manuscript.');
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'close-request')).catch(() => {}); await app.waitForEvent('close', { timeout: 15000 }).catch(() => {}); await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
