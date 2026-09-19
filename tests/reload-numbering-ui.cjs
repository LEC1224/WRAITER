const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (fn, label) => { const end = Date.now() + 20000; while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(label); };
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'reload-numbering-')), target = path.join(userData, 'Sample.wraiter'), errors = [];
  const initial = { format: 'wraiter', version: 1, id: 'reload-fixture', title: 'Numbering sample', chapters: [{ id: 'one', title: 'A walk beside the river', content: { type: 'doc', content: Array.from({ length: 18 }, (_, index) => ({ ...paragraph(`Paragraph ${index + 1}. ` + 'The river turned gently through the valley, and the evening light settled on the water. '.repeat(6)), ...(index === 8 ? { attrs: { pageBreakBefore: true } } : {}) })) } }] };
  await fs.writeFile(target, JSON.stringify(initial));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, recent: [target] }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, editor;
  const launchOptions = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  const launch = async () => { app = await _electron.launch(launchOptions); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor(); };
  const boot = () => page.evaluate(() => window.wraiter.boot());
  const command = value => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('command', value), value);
  const numbering = async label => app.evaluate(({ Menu }, label) => Menu.getApplicationMenu().items.find(item => item.label === '&View').submenu.items.find(item => item.label === 'Text numbering').submenu.items.find(item => item.label === label).click(), label);
  const append = async text => { await editor.evaluate(el => { el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); }); await page.keyboard.insertText(text); };
  const checkGutter = async () => {
    await waitFor(async () => await page.locator('.paragraph-numbers .text-number').count() === 18, 'Paragraph gutter');
    assert.ok(await page.locator('.row-numbers .text-number').count() > 18);
    assert.ok(await page.locator('.page-numbers .text-number').count() > 1);
    const geometry = await page.evaluate(() => {
      const gutter = document.querySelector('.text-numbering').getBoundingClientRect(), sheet = document.querySelector('.writing-sheet').getBoundingClientRect(), scroller = document.querySelector('.writing-scroll').getBoundingClientRect();
      const labels = [...document.querySelectorAll('.paragraph-numbers .text-number')];
      const offsets = [...document.querySelectorAll('.manuscript > p')].map((p, i) => {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let text;
        while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.pagination-spacer')) { text = walker.currentNode; break; }
        const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
        const rect = range.getBoundingClientRect(), label = labels[i].getBoundingClientRect();
        return Math.abs((rect.top + rect.bottom) / 2 - (label.top + label.bottom) / 2);
      });
      return { overlaps: gutter.right > sheet.left, clipped: gutter.left < scroller.left, offsets };
    });
    assert.equal(geometry.overlaps, false); assert.equal(geometry.clipped, false); assert.ok(geometry.offsets.every(value => value < 5), JSON.stringify(geometry));
  };
  try {
    await launch(); await command(`open-recent:${target}`);
    await waitFor(async () => (await boot()).path === target && !(await page.locator('.workspace').evaluate(el => el.inert)), 'Open sample');
    await waitFor(async () => (await boot()).project.historySequence > 0, 'Initial journal');
    const before = await boot();
    for (const label of ['Row numbers', 'Page numbers', 'Paragraph numbers']) await numbering(label);
    await checkGutter();
    assert.equal((await boot()).project.historySequence, before.project.historySequence, 'Numbering entered history');
    await page.screenshot({ path: path.join(output, 'numbering-continuous.png') });
    await command('page-view'); await waitFor(async () => await page.locator('.page-card').count() > 1, 'Page divisions'); await checkGutter();
    assert.equal(await page.locator('.page-numbers .text-number').count(), await page.locator('.page-card').count());
    await page.getByRole('combobox', { name: 'Document zoom', exact: true }).selectOption('150'); await page.waitForTimeout(400); await checkGutter();
    await page.getByRole('combobox', { name: 'Document zoom', exact: true }).selectOption('100');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650)); await page.waitForTimeout(400); await checkGutter();
    await page.locator('.writing-scroll').evaluate(el => el.scrollTop = 600); await checkGutter();
    await page.screenshot({ path: path.join(output, 'numbering-minimum.png') });
    await numbering('Row numbers'); await waitFor(async () => await page.locator('.row-numbers .text-number').count() === 0, 'Row toggle');
    assert.equal(await page.locator('.paragraph-numbers .text-number').count(), 18);
    await app.close(); await launch();
    assert.equal((await boot()).prefs.showRowNumbers, false); assert.equal((await boot()).prefs.showParagraphNumbers, true);
    const checks = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '&View').submenu.items.find(item => item.label === 'Text numbering').submenu.items.map(item => item.checked));
    assert.deepEqual(checks, [false, true, true]);

    // Keep local unsaved edits and external content distinct, including history.
    const disk = JSON.parse(await fs.readFile(target, 'utf8'));
    disk.chapters[0].content.content = [paragraph('Changed by the external editor.')];
    await fs.writeFile(target, JSON.stringify(disk)); await append(' LOCAL DRAFT TO PRESERVE'); await command('save');
    const reload = page.getByRole('button', { name: 'Load modified version', exact: true }); await reload.waitFor();
    await page.screenshot({ path: path.join(output, 'reload-conflict.png') });
    const old = await boot(); await reload.click();
    await waitFor(async () => (await editor.innerText()).trim() === 'Changed by the external editor.' && !(await page.locator('.workspace').evaluate(el => el.inert)), 'Reload external WRAITER');
    assert.equal(await page.locator('.inline-warning').count(), 0); assert.equal((await boot()).workspace.tabs.length, old.workspace.tabs.length);
    assert.notEqual((await boot()).project.id, old.project.id);
    const preserved = (await page.evaluate(() => window.wraiter.getRecents())).find(value => value.includes('before reload'));
    assert.ok(preserved); assert.match(await fs.readFile(preserved, 'utf8'), /LOCAL DRAFT TO PRESERVE/);
    await command('undo'); await page.waitForTimeout(250); assert.equal((await editor.innerText()).trim(), 'Changed by the external editor.');
    await append(' Saved after reload.'); await command('save');
    await waitFor(async () => (await fs.readFile(target, 'utf8')).includes('Saved after reload.'), 'Save after reload');
    await page.getByText('Document saved.', { exact: true }).waitFor();

    // Native formats take the import-and-bind branch when the source changed.
    const native = path.join(userData, 'Native.txt');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); dialog.showMessageBox = async () => ({ response: 0 }); }, native);
    await command('save-copy'); await waitFor(async () => (await boot()).path === native, 'Save native');
    await fs.writeFile(native, 'Native external edit.'); await append(' Local native draft.'); await command('save'); await reload.waitFor(); await reload.click();
    await waitFor(async () => (await editor.innerText()).trim() === 'Native external edit.' && !(await page.locator('.workspace').evaluate(el => el.inert)), 'Reload native');
    assert.equal((await boot()).binding.format, 'txt'); assert.equal(await page.locator('.inline-warning').count(), 0);
    await append(' More writing.'); await command('save'); await waitFor(async () => (await fs.readFile(native, 'utf8')).includes('More writing.'), 'Save native after reload');
    assert.deepEqual(errors, []);
    console.log('PASS: independent persistent native checkboxes, wrapped-row/paragraph/page alignment at zoom and minimum size, numbering excluded from history, WRAITER and native reload, draft preservation, fresh undo, and subsequent saves.');
  } catch (error) { await page?.screenshot({ path: path.join(output, 'reload-numbering-failure.png') }).catch(() => {}); throw error; }
  finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
