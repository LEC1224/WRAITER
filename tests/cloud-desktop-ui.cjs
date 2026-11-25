// Packaged application smoke test. Isolated profile, no credentials or AI calls.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const executable = process.env.WRAITER_EXECUTABLE || path.join(root, `release/unsigned-preview/${require('../package.json').version}-cloud/win-unpacked/WRAITER.exe`);
const textOf = node => node?.text || (node?.content || []).map(textOf).join('');
const waitFor = async (check, label) => { const until = Date.now() + 20000; while (Date.now() < until) { try { if (await check()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 80)); } throw new Error(`Timed out: ${label}`); };

(async () => {
  await fs.access(executable); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'cloud-desktop-profile-'));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, continuous: false, localGrammar: false, aiGrammar: false, spellcheck: false, startup: 'restore' }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app; const errors = [], checks = [], requests = [];
  try {
    app = await _electron.launch({ executablePath: executable, args: [], env, timeout: 60000 });
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    checks.push('Launched packaged WRAITER with an isolated profile and AI disabled.');
    const status = await page.evaluate(() => window.wraiter.cloudStatus());
    assert.deepEqual(status, { connected: false, origin: 'https://wraiter.lecani.se' });
    assert.equal(Object.keys(status).some(key => /password|token|encrypted|credential/i.test(key)), false);
    assert.equal(await page.evaluate(() => Object.keys(window.wraiter).some(key => /token|credential|secret/i.test(key))), false);
    checks.push('Cloud status reports signed out and exposes no credential/token fields.');
    await page.getByRole('button', { name: 'Cloud library', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'WRAITER cloud library', exact: true }); await dialog.waitFor();
    await dialog.getByLabel('Email', { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Email', { exact: true }).inputValue(), '');
    assert.equal(await dialog.getByLabel('Password', { exact: true }).getAttribute('type'), 'password');
    assert.equal(await dialog.getByLabel('Password', { exact: true }).inputValue(), '');
    assert.equal(await dialog.getByRole('button', { name: 'Sign in', exact: true }).isVisible(), true);
    assert.equal(await dialog.getByRole('button', { name: 'wraiter.lecani.se', exact: true }).isVisible(), true);
    await page.screenshot({ path: path.join(userData, 'cloud-library-signed-out.png') });
    await assert.rejects(fs.access(path.join(userData, 'cloud-account.json')));
    checks.push('Cloud library shows blank email/password sign-in and registration link without creating saved credentials.');
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await editor.click(); await page.keyboard.press('Control+End');
    const marker = 'Synthetic packaged cloud smoke test preserves local writing.'; await page.keyboard.insertText(marker);
    const recover = async () => JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
    await waitFor(async () => textOf((await recover()).chapters[0].content).includes(marker), 'manuscript recovery autosave');
    await page.keyboard.press('Control+s');
    // A native Save dialog is not needed to verify the recovery boundary. Cancel
    // that dialog if present so closing remains an entirely synthetic operation.
    await page.keyboard.press('Escape');
    assert.match(await editor.innerText(), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const saved = await recover(); assert.ok(Number.isSafeInteger(saved.historySequence));
    const journal = await page.evaluate(id => window.wraiter.loadEditHistory(id), saved.id); assert.ok(journal.totalEvents >= 2);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    checks.push('Closing cloud sign-in leaves the manuscript editable; typed text autosaves to recovery with persistent editing history.');
    checks.push('No browser network requests, real credentials, or AI calls were made.');
    const report = { executable, userData, version: await app.evaluate(({ app }) => app.getVersion()), checks, errors };
    await fs.writeFile(path.join(output, 'cloud-desktop-ui-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
