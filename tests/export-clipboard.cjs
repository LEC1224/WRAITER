// Synthetic desktop fixture. Clipboard writes are intercepted to preserve the user's clipboard.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const userData = await fs.mkdtemp(path.join(root, 'test-output', 'export-clipboard-'));
  const initial = { format: 'wraiter', version: 1, id: 'clipboard-fixture', title: 'Clipboard fixture', notes: 'PRIVATE NOTES', chapters: [
    { id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold passage', marks: [{ type: 'bold' }] }] }] } },
    { id: 'second', title: 'Second', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Other chapter' }] }] } }
  ] };
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: initial, path: null, expectedHash: null }));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ enabled: false, continuous: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
    await app.evaluate(({ clipboard, dialog }) => {
      global.exportWrites = []; global.saveDialogs = 0;
      clipboard.writeText = text => { if (global.failCopy) throw new Error('Clipboard unavailable'); global.exportWrites.push({ text }); };
      clipboard.write = value => global.exportWrites.push(value);
      dialog.showSaveDialog = async () => { global.saveDialogs++; return { canceled: !global.exportTarget, filePath: global.exportTarget }; };
    });
    const open = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'export'));
    const select = (label, value) => page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
    const latest = () => app.evaluate(() => global.exportWrites.at(-1));
    for (const format of ['txt', 'md', 'bbcode', 'html', 'discord', 'telegram-md', 'telegram-html', 'rich-text']) {
      console.log('Checking clipboard ' + format);
      await open(); await select('Export format', format); await select('Export scope', 'chapter');
      await select('Export chapter', 'first'); await page.getByLabel('Include chapter headings').uncheck();
      await select('Export destination', 'clipboard');
      await page.getByRole('button', { name: 'Export to Clipboard', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const result = await latest();
      assert.ok(result.text.includes('Bold passage')); assert.ok(!result.text.includes('Other chapter')); assert.ok(!result.text.includes('PRIVATE NOTES'));
      if (format === 'discord') assert.equal(result.text, '**Bold passage**\n\n');
      if (format === 'telegram-md') assert.equal(result.text, '*Bold passage*\n\n');
      if (format === 'telegram-html') assert.equal(result.text, '<b>Bold passage</b>\n\n');
      if (format === 'rich-text') { assert.match(result.html, /<strong>Bold passage<\/strong>/); assert.equal(result.text, 'Bold passage'); }
      else assert.equal(result.html, undefined);
    }
    assert.equal(await app.evaluate(() => global.saveDialogs), 0);
    await open(); await select('Export format', 'discord'); await select('Export destination', 'clipboard');
    for (const format of ['docx', 'odt', 'epub', 'pdf']) {
      await select('Export format', format); assert.equal(await page.getByLabel('Export destination', { exact: true }).inputValue(), 'file');
      assert.equal(await page.getByLabel('Export destination', { exact: true }).isDisabled(), true);
    }
    await select('Export format', 'discord');
    await app.evaluate(() => { global.failCopy = true; });
    await page.getByRole('button', { name: 'Export to Clipboard', exact: true }).click();
    await page.getByText(/Clipboard unavailable/).waitFor(); assert.equal(await page.getByRole('dialog').count(), 1);
    await app.evaluate(() => { global.failCopy = false; });
    await page.screenshot({ path: path.join(userData, 'export-dialog.png') });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.evaluate(element => { element.focus(); const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
    await page.waitForTimeout(150);
    await open(); await select('Export format', 'discord'); await select('Export scope', 'selection'); await select('Export destination', 'clipboard');
    await page.getByRole('button', { name: 'Export to Clipboard', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await latest()).text, '**Bold passage**\n\n');
    for (const format of ['discord', 'telegram-md', 'telegram-html', 'rich-text']) {
      console.log('Checking file ' + format);
      const target = path.join(userData, format);
      await app.evaluate((_electron, target) => { global.exportTarget = target; }, target);
      await open(); await select('Export format', format); await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const exported = await fs.readFile(target + (format === 'rich-text' ? '.html' : '.txt'), 'utf8');
      assert.ok(exported.includes('Bold passage')); assert.ok(exported.includes('Other chapter')); assert.ok(!exported.includes('PRIVATE NOTES'));
    }
    await assert.rejects(page.evaluate(() => window.wraiter.exportClipboard({ format: 'pdf', data: 'invalid' })), /cannot be exported/);
    console.log('PASS all eight clipboard formats, rich/plain MIME payloads, chapter and selection scope, file-only switching, retry after clipboard failure, four new file formats and IPC validation. Screenshot: ' + path.join(userData, 'export-dialog.png'));
  } catch (error) { console.error(error); throw error; } finally {
    if (app) { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
