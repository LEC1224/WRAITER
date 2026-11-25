// Synthetic desktop fixture. Clipboard writes are intercepted to preserve the user's clipboard.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..');
(async () => {
  const userData = await fs.mkdtemp(path.join(root, 'test-output', 'export-clipboard-'));
  const initial = { format: 'wraiter', version: 1, id: 'clipboard-fixture', title: 'Clipboard fixture', notes: 'PRIVATE NOTES', chapters: [
    { id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold passage', marks: [{ type: 'bold' }] }] }] } },
    { id: 'second', title: 'Second', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Other chapter' }] }] } }
  ] };
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: initial, path: null, expectedHash: null }));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, continuous: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
    await app.evaluate(({ clipboard, ClipboardItem, dialog }) => {
      global.exportWrites = []; global.saveDialogs = 0;
      clipboard.writeText = async text => { if (global.failCopy) throw new Error('Clipboard unavailable'); global.exportWrites.push({ text }); };
      clipboard.write = async items => {
        if (!Array.isArray(items) || items.length !== 1 || !(items[0] instanceof ClipboardItem)) throw new TypeError('Expected one Electron ClipboardItem');
        const plain = await items[0].getType('text/plain'), formatted = await items[0].getType('text/html');
        global.exportWrites.push({ text: await plain.text(), html: await formatted.text() });
      };
      dialog.showSaveDialog = async () => { global.saveDialogs++; return { canceled: !global.exportTarget, filePath: global.exportTarget }; };
    });
    const open = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'export'));
    const select = (label, value) => page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
    const latest = () => app.evaluate(() => global.exportWrites.at(-1));
    for (const format of ['txt', 'md', 'bbcode', 'html', 'discord', 'telegram-md', 'telegram-html', 'rich-text', 'deviantart']) {
      console.log('Checking clipboard ' + format);
      await open(); await select('Export format', format); await select('Export scope', 'chapter');
      await select('Export chapter', 'first'); await page.getByLabel('Include chapter headings').uncheck();
      if (['txt', 'md', 'bbcode', 'html'].includes(format)) await select('Export destination', 'clipboard');
      else assert.equal(await page.getByLabel('Export destination', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const result = await latest();
      assert.ok(result.text.includes('Bold passage')); assert.ok(!result.text.includes('Other chapter')); assert.ok(!result.text.includes('PRIVATE NOTES'));
      if (format === 'discord') assert.equal(result.text, '**Bold passage**\n\n');
      if (format === 'telegram-md') assert.equal(result.text, '*Bold passage*\n\n');
      if (format === 'telegram-html') assert.equal(result.text, '<b>Bold passage</b>\n\n');
      if (format === 'rich-text') { assert.match(result.html, /<strong>Bold passage<\/strong>/); assert.equal(result.text, 'Bold passage'); }
      else if (format === 'deviantart') { assert.equal(result.html, '<p><strong>Bold passage</strong></p>'); assert.equal(result.text, 'Bold passage'); }
      else assert.equal(result.html, undefined);
    }
    assert.equal(await app.evaluate(() => global.saveDialogs), 0);
    for (const [format, label] of [['docx', 'DOCX'], ['odt', 'ODT'], ['epub', 'EPUB']]) {
      console.log('Checking automatic file ' + format);
      const target = path.join(userData, format);
      await app.evaluate((_electron, target) => { global.exportTarget = target; }, target);
      await open(); await select('Export format', format);
      assert.equal(await page.getByLabel('Export destination', { exact: true }).count(), 0);
      if (format === 'odt') {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
        await page.screenshot({ path: path.join(userData, 'export-odt.png') });
      }
      await page.getByRole('button', { name: `Save ${label} file…`, exact: true }).click();
      await page.getByRole('dialog', { name: 'Export document', exact: true }).waitFor({ state: 'hidden' });
      const archive = await JSZip.loadAsync(await fs.readFile(target + '.' + format), { checkCRC32: true });
      if (format === 'epub') assert.equal(await archive.file('mimetype').async('string'), 'application/epub+zip');
      else {
        const xml = await archive.file(format === 'docx' ? 'word/document.xml' : 'content.xml').async('string');
        assert.ok(xml.replace(/<text:s\b[^>]*\/>/g, ' ').replace(/<[^>]*>/g, '').includes('Bold passage'));
      }
    }
    assert.equal(await app.evaluate(() => global.exportWrites.length), 9, 'File formats must not write to the clipboard');
    await open(); await select('Export format', 'pdf');
    assert.deepEqual(await page.getByLabel('Export destination', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['file', 'preview']);
    assert.equal(await page.getByLabel('Export destination', { exact: true }).inputValue(), 'file');
    await select('Export destination', 'preview');
    assert.ok(await page.getByRole('button', { name: 'Preview / print', exact: true }).isVisible());
    await select('Export destination', 'file');
    assert.ok(await page.getByRole('button', { name: 'Save PDF file…', exact: true }).isVisible());
    await select('Export format', 'discord');
    await app.evaluate(() => { global.failCopy = true; });
    await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click();
    await page.getByText(/Clipboard unavailable/).waitFor(); assert.equal(await page.getByRole('dialog').count(), 1);
    await app.evaluate(() => { global.failCopy = false; });
    await page.screenshot({ path: path.join(userData, 'export-dialog.png') });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.evaluate(element => { element.focus(); const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
    await page.waitForTimeout(150);
    await open(); await select('Export format', 'discord'); await select('Export scope', 'selection');
    await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await latest()).text, '**Bold passage**\n\n');
    assert.equal(await app.evaluate(() => global.saveDialogs), 3, 'Chat formats must not open a save dialog');
    for (const [format, label, extension] of [['txt', 'text', 'txt'], ['md', 'Markdown', 'md'], ['bbcode', 'BBCode', 'txt'], ['html', 'HTML', 'html']]) {
      console.log('Checking file ' + format);
      const target = path.join(userData, format);
      await app.evaluate((_electron, target) => { global.exportTarget = target; }, target);
      await open(); await select('Export format', format); await select('Export scope', 'manuscript'); await select('Export destination', 'file'); await page.getByRole('button', { name: `Save ${label} file…`, exact: true }).click(); await page.getByRole('dialog', { name: 'Export document', exact: true }).waitFor({ state: 'hidden' });
      const details = page.getByRole('dialog', { name: 'Export details', exact: true });
      if (await details.count()) await details.getByRole('button', { name: /^(Close(?: dialog)?|OK|Got it|Continue writing)$/ }).first().click();
      const exported = await fs.readFile(target + '.' + extension, 'utf8');
      assert.ok(exported.includes('Bold passage')); assert.ok(exported.includes('Other chapter')); assert.ok(!exported.includes('PRIVATE NOTES'));
    }
    await open(); await select('Export format', 'discord');
    assert.equal(await page.getByLabel('Export destination', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await app.evaluate(() => global.saveDialogs), 7, 'A remembered file destination must not change the chat action');
    await assert.rejects(page.evaluate(() => window.wraiter.exportClipboard({ format: 'pdf', data: 'invalid' })), /cannot be exported/);
    await assert.rejects(page.evaluate(() => window.wraiter.exportClipboard({ format: 'deviantart', data: 'invalid' })), /Invalid formatted clipboard/);
    await editor.evaluate(element => element.editor.commands.setContent('<p><strong>First paragraph.</strong></p><p></p><p><em>Second paragraph.</em><br>Same paragraph.</p>'));
    await open(); await select('Export format', 'deviantart'); await select('Export scope', 'chapter'); await select('Export chapter', 'first');
    await page.getByLabel('Include chapter headings').uncheck();
    await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await latest(), { html: '<p><strong>First paragraph.</strong></p><p><br></p><p><em>Second paragraph.</em><br>Same paragraph.</p>', text: 'First paragraph.\n\nSecond paragraph.\nSame paragraph.' });
    assert.equal(await app.evaluate(() => global.saveDialogs), 7, 'Literature copying must not open a save dialog');
    console.log('PASS nine clipboard formats, automatic Office/EPUB files and chat copying, meaningful text/PDF choices, scoped exports, clipboard failure retry, saved-destination switching and IPC validation. Screenshots: ' + userData);
  } catch (error) { console.error(error); throw error; } finally {
    if (app) { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
