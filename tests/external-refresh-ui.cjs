const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (check, label) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error(`Timed out: ${label}`);
};
const textOf = node => node.text || (node.content || []).map(textOf).join('');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const reports = [];
  for (const format of ['wraiter', 'odt']) {
    const userData = await fs.mkdtemp(path.join(output, `external-refresh-${format}-`));
    const folder = path.join(userData, 'Original folder'), renamed = path.join(userData, 'Renamed å folder');
    await fs.mkdir(folder);
    const initial = 'Original external refresh text.';
    const project = { format: 'wraiter', version: 1, id: 'refresh-ui', title: 'Refresh UI', notes: 'Private notes survive refresh.', style: '', references: [], snapshots: [], chapters: [{ id: 'chapter', title: 'Chapter', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: initial }] }] } }] };
    const source = path.join(folder, 'Book.wraiter'), target = path.join(folder, `Book.${format}`);
    await fs.writeFile(source, JSON.stringify(project));
    await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, localGrammar: false, pageMode: 'continuous' }));
    const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
    let app, page, editor;
    const errors = [];
    const boot = () => page.evaluate(() => window.wraiter.boot());
    const currentText = () => editor.evaluate(element => element.editor?.state.doc.textContent || '');
    const command = value => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('command', value), value);
    const insert = text => editor.evaluate((element, text) => { const editor = element.editor; editor.commands.focus('end'); editor.view.dispatch(editor.state.tr.insertText(text)); }, text);
    const settled = () => waitFor(async () => !(await page.locator('.workspace').evaluate(element => element.inert)), 'operation finished');
    const dismissCompatibility = async () => {
      const notice = page.getByRole('dialog', { name: 'Document compatibility', exact: true });
      if (await notice.count()) await notice.getByRole('button', { name: 'Continue writing', exact: true }).click();
    };
    const launch = async (args = [source]) => {
      app = await _electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args } : { args: [root, ...args] }), env, timeout: 60000 });
      page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
      editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
      await editor.waitFor({ timeout: 30000 });
    };
    try {
      await launch();
      await waitFor(async () => (await boot()).path === source, 'source opened');
      await waitFor(async () => await currentText() === initial, 'source displayed');
      await settled();
      await app.evaluate(({ dialog }, target) => {
        global.refreshPick = null; global.refreshPickers = [];
        dialog.showOpenDialog = async (_win, options) => {
          global.refreshPickers.push(options);
          return global.refreshPick ? { canceled: false, filePaths: [global.refreshPick] } : { canceled: true, filePaths: [] };
        };
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
        const messageBox = dialog.showMessageBox;
        dialog.showMessageBox = async (...args) => args[1]?.message === 'Review format compatibility before saving' ? { response: 0 } : messageBox(...args);
      }, target);
      if (format === 'odt') { await command('save-copy'); await waitFor(async () => (await boot()).path === target, 'ODT saved'); }
      await settled();
      await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
      const originalBytes = await fs.readFile(target), tabCount = (await boot()).workspace.tabs.length;
      const externalBytes = async text => {
        if (format === 'wraiter') return Buffer.from(JSON.stringify({ ...project, chapters: [{ ...project.chapters[0], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }] }));
        const zip = await JSZip.loadAsync(originalBytes);
        const xml = (await zip.file('content.xml').async('string')).replace(/<text:s text:c="1"\/>/g, ' ');
        assert.ok(xml.includes(initial));
        zip.file('content.xml', xml.split(initial).join(text));
        return zip.generateAsync({ type: 'nodebuffer' });
      };
      const firstExternal = await externalBytes('External edit one.');
      await fs.writeFile(target, firstExternal);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.locator('.file-warning').filter({ hasText: 'changed outside WRAITER' }).waitFor();
      assert.equal(await currentText(), initial, 'External text is not silently substituted.');
      assert.deepEqual(await fs.readFile(target), firstExternal);
      await insert(' LOCAL_DRAFT.');
      await page.getByRole('button', { name: 'Save needs attention', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Refresh from disk', exact: true }).click();
      await waitFor(async () => await currentText() === 'External edit one.', 'external refresh');
      await settled();
      await dismissCompatibility();
      const preserved = (await page.evaluate(() => window.wraiter.getRecents())).find(item => item.includes('before reload'));
      assert.ok(preserved);
      assert.match(await fs.readFile(preserved, 'utf8'), /LOCAL_DRAFT/);
      assert.equal((await boot()).project.notes, project.notes);
      assert.equal((await boot()).workspace.tabs.length, tabCount);
      await command('undo');
      assert.equal(await currentText(), 'External edit one.');
      await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();

      await fs.rename(folder, renamed);
      const moved = path.join(renamed, `Renamed book.${format}`);
      await fs.rename(path.join(renamed, path.basename(target)), moved);
      await fs.writeFile(moved, await externalBytes('External renamed edit.'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.locator('.file-warning').filter({ hasText: 'moved, renamed or deleted' }).waitFor();
      await insert(' KEEP_AFTER_MOVE.');
      await page.getByRole('button', { name: 'Save needs attention', exact: true }).waitFor();
      const draftText = await currentText();
      await page.getByRole('button', { name: 'Refresh from disk', exact: true }).click();
      await waitFor(() => app.evaluate(() => global.refreshPickers.length === 1), 'missing path opens picker');
      await settled();
      assert.equal((await boot()).path, target);
      assert.equal(await currentText(), draftText);
      assert.match(JSON.stringify((await boot()).project), /KEEP_AFTER_MOVE/);
      const picker = await app.evaluate(() => global.refreshPickers[0]);
      assert.equal(path.dirname(picker.defaultPath), userData, 'Picker starts at an existing ancestor.');
      await assert.rejects(fs.stat(folder), { code: 'ENOENT' });

      const invalid = path.join(userData, `Invalid.${format}`);
      await fs.writeFile(invalid, 'Invalid document');
      await app.evaluate((_, target) => { global.refreshPick = target; }, invalid);
      await page.getByRole('button', { name: 'Locate file…', exact: true }).click();
      await waitFor(() => app.evaluate(() => global.refreshPickers.length === 2), 'invalid selection');
      await settled();
      assert.equal((await boot()).path, target);
      assert.equal(await currentText(), draftText);

      await app.evaluate((_, target) => { global.refreshPick = target; }, moved);
      await command('locate-file');
      await waitFor(async () => (await boot()).path === moved && await currentText() === 'External renamed edit.', 'new path attached');
      await settled();
      await dismissCompatibility();
      assert.equal((await boot()).workspace.tabs.length, tabCount);
      const recovered = (await page.evaluate(() => window.wraiter.getRecents())).find(item => item.includes('before reload'));
      assert.match(await fs.readFile(recovered, 'utf8'), /KEEP_AFTER_MOVE/);
      await insert(' Saved at the new path.');
      await command('save');
      await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
      const savedText = 'External renamed edit. Saved at the new path.';
      if (format === 'wraiter') assert.equal(textOf(JSON.parse(await fs.readFile(moved, 'utf8')).chapters[0].content), savedText);
      else assert.match((await (await JSZip.loadAsync(await fs.readFile(moved))).file('content.xml').async('string')).replace(/<text:s text:c="1"\/>/g, ' '), /Saved at the new path/);
      await assert.rejects(fs.stat(folder), { code: 'ENOENT' });
      await page.screenshot({ path: path.join(userData, 'refreshed.png') });
      await app.close(); app = null;
      await launch([]);
      await waitFor(async () => (await boot()).path === moved && await currentText() === savedText, 'new path restored after restart');
      assert.equal((await boot()).project.notes, project.notes);
      assert.deepEqual(errors, []);
      reports.push({ format, userData, passed: true, checks: ['External change detected without saving', 'Refresh loads disk and preserves draft', 'Renamed parent and file open a locator', 'Cancellation and invalid input retain draft', 'Relocation replaces tab and resumes saves', 'Restart retains new binding and private notes'] });
    } catch (error) { await page?.screenshot({ path: path.join(userData, 'failure.png') }).catch(() => {}); console.error({ format, userData, errors }); throw error; }
    finally { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); }
  }
  const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, reports };
  await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'external-refresh-packaged-results.json' : 'external-refresh-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
