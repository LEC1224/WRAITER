// Synthetic desktop regression; native clipboard writes never reach the user's clipboard.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const storageKey = 'wraiter.export-settings.v1';

(async () => {
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  const userData = await fs.mkdtemp(path.join(root, 'test-output', 'export-settings-'));
  const content = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const project = { format: 'wraiter', version: 1, id: 'export-settings-test', title: 'Export preferences', language: 'en-US', printLayout: { size: 'A5', orientation: 'landscape', top: 18, right: 19, bottom: 20, left: 21, header: 'Manuscript header', footer: '' }, chapters: [
    { id: 'first', title: 'First', content: content('First chapter passage.') },
    { id: 'second', title: 'Second', content: content('Second chapter passage.') }
  ] };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', theme: 'dark', spellcheck: false }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, dialog;
  const errors = [];
  const launch = async () => {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 });
    page = await app.firstWindow(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
    await app.evaluate(({ clipboard }) => { global.exportWrites = []; clipboard.writeText = text => global.exportWrites.push(text); });
    dialog = page.getByRole('dialog', { name: 'Export document', exact: true });
  };
  const open = async (command = 'export') => {
    await app.evaluate(({ BrowserWindow }, command) => BrowserWindow.getAllWindows()[0].webContents.send('command', command), command);
    await dialog.waitFor();
  };
  const select = (name, value) => dialog.getByRole('combobox', { name, exact: true }).selectOption(value);
  const value = name => dialog.getByRole('combobox', { name, exact: true }).inputValue();
  const check = (name, checked) => dialog.getByLabel(name, { exact: true }).setChecked(checked);
  const close = () => dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const reset = () => dialog.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
  const assertDefaults = async () => {
    assert.equal(await value('Export format'), 'pdf'); assert.equal(await value('Export scope'), 'manuscript');
    assert.equal(await value('Export destination'), 'file'); assert.equal(await value('PDF colour'), 'light');
    for (const name of ['Include manuscript title', 'Include chapter headings']) assert.equal(await dialog.getByLabel(name, { exact: true }).isChecked(), true);
    for (const name of ['Custom page setup', 'Add generated contents list']) assert.equal(await dialog.getByLabel(name, { exact: true }).isChecked(), false);
  };
  try {
    await launch(); await open(); await assertDefaults();
    await check('Include manuscript title', false); await check('Include chapter headings', false);
    await check('Add generated contents list', true); await select('Export format', 'docx');
    await check('Include passage comments in Office file', true); await check('Include tracked text changes for review', true);
    await select('Export format', 'pdf-mobile'); await select('PDF colour', 'dark'); await check('Custom page setup', true);
    await select('Paper size', 'Letter'); await select('Orientation', 'portrait');
    await dialog.getByLabel('Top margin (mm)', { exact: true }).fill('14');
    await dialog.getByLabel('Header', { exact: true }).fill('Export header {page}');
    await dialog.getByLabel('Footer', { exact: true }).fill('Export footer {pages}');
    await select('Export destination', 'preview'); await close(); await open();
    assert.equal(await value('Export format'), 'pdf-mobile'); assert.equal(await value('Export destination'), 'preview');
    assert.equal(await dialog.getByLabel('Header', { exact: true }).inputValue(), 'Export header {page}');
    await select('Export format', 'discord'); await select('Export scope', 'chapter'); await select('Export chapter', 'second');
    await select('Export destination', 'clipboard');
    await dialog.getByRole('button', { name: 'Export to Clipboard', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await app.evaluate(() => global.exportWrites.at(-1)), 'Second chapter passage.\n\n');
    await app.close(); app = null; await launch(); await open();
    assert.equal(await value('Export format'), 'discord'); assert.equal(await value('Export destination'), 'clipboard');
    assert.equal(await value('Export scope'), 'chapter'); assert.equal(await value('Export chapter'), 'second');
    await select('Export format', 'pdf-mobile'); assert.equal(await value('PDF colour'), 'dark');
    assert.equal(await value('Paper size'), 'Letter'); assert.equal(await value('Orientation'), 'portrait');
    assert.equal(await dialog.getByLabel('Top margin (mm)', { exact: true }).inputValue(), '14');
    assert.equal(await dialog.getByLabel('Header', { exact: true }).inputValue(), 'Export header {page}');
    assert.equal(await dialog.getByLabel('Footer', { exact: true }).inputValue(), 'Export footer {pages}');
    assert.equal(await dialog.getByLabel('Add generated contents list', { exact: true }).isChecked(), true);
    await select('Export scope', 'manuscript'); assert.equal(await dialog.getByLabel('Include manuscript title', { exact: true }).isChecked(), false);
    assert.equal(await dialog.getByLabel('Include chapter headings', { exact: true }).isChecked(), false);
    await select('Export format', 'odt'); assert.equal(await value('Export destination'), 'file');
    assert.equal(await dialog.getByLabel('Include passage comments in Office file', { exact: true }).isChecked(), true);
    assert.equal(await dialog.getByLabel('Include tracked text changes for review', { exact: true }).isChecked(), true);
    await select('Export format', 'discord'); assert.equal(await value('Export destination'), 'clipboard'); await close();
    await open('print'); assert.equal(await value('Export format'), 'pdf'); assert.equal(await value('Export destination'), 'preview');
    await close(); await open(); assert.equal(await value('Export format'), 'discord'); assert.equal(await value('Export destination'), 'clipboard'); await close();

    const editor = () => page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor().evaluate(element => element.editor.commands.setTextSelection({ from: 1, to: 6 }));
    await open(); await select('Export scope', 'selection'); await close(); await open();
    assert.equal(await value('Export scope'), 'selection');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    for (const name of ['Reset to defaults', 'Cancel', 'Export to Clipboard']) {
      const box = await dialog.getByRole('button', { name, exact: true }).boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, name + ' must fit at the minimum window size');
    }
    await page.screenshot({ path: path.join(userData, 'export-settings-minimum.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
    await page.screenshot({ path: path.join(userData, 'export-settings-large.png') });
    await close(); await editor().evaluate(element => element.editor.commands.setTextSelection(1)); await open();
    assert.equal(await value('Export scope'), 'manuscript');
    await reset(); await assertDefaults();
    await select('Export format', 'docx');
    assert.equal(await dialog.getByLabel('Include passage comments in Office file', { exact: true }).isChecked(), false);
    assert.equal(await dialog.getByLabel('Include tracked text changes for review', { exact: true }).isChecked(), false);
    await select('Export format', 'pdf'); await check('Custom page setup', true);
    assert.equal(await value('Paper size'), 'A5'); assert.equal(await value('Orientation'), 'landscape');
    assert.equal(await dialog.getByLabel('Header', { exact: true }).inputValue(), 'Manuscript header');
    await reset(); await close(); await app.close(); app = null; await launch(); await open(); await assertDefaults();
    await select('Export format', 'discord'); await select('Export destination', 'clipboard');
    await select('Export scope', 'chapter'); await select('Export chapter', 'second'); await close();
    await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); saved.chapterId = 'removed'; localStorage.setItem(key, JSON.stringify(saved)); }, storageKey);
    await open(); assert.equal(await value('Export chapter'), 'first'); await select('Export chapter', 'second'); await close();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'new'));
    await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.state.doc.textContent === '');
    await open(); assert.equal(await value('Export format'), 'discord'); assert.equal(await value('Export destination'), 'clipboard');
    const newChapter = await value('Export chapter');
    assert.ok(newChapter && !['first', 'second'].includes(newChapter));
    await reset(); await close();

    for (const damaged of ['{', 'null', '[]', JSON.stringify({ format: 'missing', destination: 'missing', scope: false, includeTitle: 'false' })]) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [storageKey, damaged]);
      await open(); await assertDefaults(); await close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS export options survive closing, clipboard export and restart; PDF/Office options, Print, selection fallback, reset persistence and minimum-size layout. Screenshots: ' + userData);
  } finally {
    if (app) { try { await page.evaluate(() => window.wraiter.finishClose()); } catch {} await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
