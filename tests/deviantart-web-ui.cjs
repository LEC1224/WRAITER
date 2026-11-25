// Real local backend and production browser bundle; all data and clipboard are isolated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(process.env.WRAITER_TEST_ROOT || path.join(__dirname, '..'));
const { createApplication } = require(path.join(root, 'cloud/server.cjs'));
const { hashPassword } = require(path.join(root, 'cloud/auth.cjs'));
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wraiter-literature-'));
  const origin = 'http://127.0.0.1:3047';
  const app = createApplication({ env: { WRAITER_DATA_DIR: data, WRAITER_STATIC_DIR: path.join(root, 'dist-web'), WRAITER_ORIGIN: origin, WRAITER_SECURE_COOKIES: '0' }, sendMail: async () => {} });
  const user = app.store.createUser('literature-test@example.com', await hashPassword('literaturetest2026')); app.store.verify(user.id);
  await new Promise(resolve => app.server.listen(3047, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('input[name=email]').fill('literature-test@example.com'); await page.locator('input[name=password]').fill('literaturetest2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // RC3 uses a separate passphrase; later releases may open the library directly.
    await page.locator('input[name=vault-passphrase], .web-library').first().waitFor();
    if (await page.locator('input[name=vault-passphrase]').count()) {
      await page.locator('input[name=vault-passphrase]').fill('isolated literature document key');
      await page.locator('input[name=vault-confirmation]').fill('isolated literature document key');
      await page.getByRole('button', { name: 'Set up encryption', exact: true }).click();
      await page.getByLabel('I saved my recovery key in a safe place.').check();
      await page.getByRole('button', { name: 'Open document library', exact: true }).click();
    }
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor();
    await editor.evaluate(element => element.editor.commands.setContent('<p><strong>First paragraph.</strong></p><p></p><p><em>Second paragraph.</em><br>Same paragraph.</p>'));
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async items => { window.copiedLiterature = Object.fromEntries(await Promise.all(items[0].types.map(async type => [type, await (await items[0].getType(type)).text()]))); },
      writeText: async text => { window.copiedPlainLiterature = text; }
    } }));
    const open = async () => { await page.evaluate(() => window.wraiter.emitCommand('export')); await page.getByRole('dialog', { name: 'Export document', exact: true }).waitFor(); };
    const copy = async () => { await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click(); await page.getByRole('dialog', { name: 'Export document', exact: true }).waitFor({ state: 'hidden' }); };
    await open(); await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('deviantart');
    await page.getByLabel('Include manuscript title', { exact: true }).uncheck(); await page.getByLabel('Include chapter headings', { exact: true }).uncheck();
    assert.equal(await page.getByRole('combobox', { name: 'Export destination', exact: true }).count(), 0);
    const output = path.join(__dirname, '../test-output/deviantart-production'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'export-dialog.png') });
    await copy();
    const expectedHTML = '<p><strong>First paragraph.</strong></p><p><br></p><p><em>Second paragraph.</em><br>Same paragraph.</p>';
    assert.deepEqual(await page.evaluate(() => window.copiedLiterature), { 'text/html': expectedHTML, 'text/plain': 'First paragraph.\n\nSecond paragraph.\nSame paragraph.' });
    await page.evaluate(() => { navigator.clipboard.write = undefined; }); await open(); await copy();
    assert.equal(await page.evaluate(() => window.copiedPlainLiterature), 'First paragraph.\n\nSecond paragraph.\nSame paragraph.');
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); }; });
    await open(); await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click();
    await page.getByText('Clipboard unavailable', { exact: true }).waitFor();
    assert.ok(await page.getByRole('dialog', { name: 'Export document', exact: true }).isVisible());
    assert.equal(await editor.locator('p').count(), 3, 'Export must preserve the source spacer paragraph');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'clipboard.html'), expectedHTML);
    console.log('PASS isolated production browser build: real account/vault/editor, Literature option, rich MIME clipboard, exact paragraph gaps, soft breaks, plain fallback, retryable denial and unchanged manuscript.');
  } finally { await browser?.close(); await new Promise(resolve => app.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
