// Genuine ODT encoding failure, recovery, restart and undo in a private profile.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (fn, label) => { const until = Date.now() + 20000; while (Date.now() < until) { try { if (await fn()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 75)); } throw new Error(label); };
const textOf = node => node?.text || (node?.content || []).map(textOf).join('');
(async () => {
  await fs.mkdir(output, { recursive: true }); const userData = await fs.mkdtemp(path.join(output, 'native-save-errors-')), target = path.join(userData, 'Synthetic native.odt');
  const project = { format: 'wraiter', version: 1, id: 'native-save-errors', title: 'Synthetic native save', language: 'en-US', chapters: [{ id: 'one', title: 'Chapter', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An intact synthetic paragraph.' }] }] } }], notes: 'Private note stays protected.', references: [], style: '', snapshots: [] };
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, pageMode: 'continuous' }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  const errors = [], checks = []; let app, page, editor;
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const recovery = async () => JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
  const launch = async () => { app = await _electron.launch(options); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor(); };
  const insert = text => editor.evaluate((element, text) => { const current = element.editor; current.commands.focus('end'); current.view.dispatch(current.state.tr.insertText(text)); }, text);
  try {
    await launch(); await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
    await command('save-copy'); await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).binding?.format === 'odt', 'native ODT binding');
    const original = await fs.readFile(target), before = await recovery(), text = textOf(before.chapters[0].content);
    const invalid = ' A staged invalid character\u0000retains both sides.';
    await insert(invalid);
    await page.getByRole('button', { name: 'Save needs attention', exact: true }).waitFor();
    await waitFor(async () => textOf((await recovery()).chapters[0].content) === text + invalid, 'failed native encoding still flushes complete recovery');
    assert.deepEqual(await fs.readFile(target), original, 'encoding failure cannot replace the last valid office file'); assert.equal((await recovery()).notes, project.notes);
    assert.match(await page.locator('.inline-warning').innerText(), /cannot be represented in an ODT file/);
    await command('save'); await waitFor(async () => await page.locator('.toast').filter({ hasText: 'cannot be represented in an ODT file' }).count() > 0, 'manual save reports the same encoding failure');
    assert.deepEqual(await fs.readFile(target), original); checks.push('Automatic and explicit encoding failures preserve complete recovery, private notes and the last valid ODT.');
    await app.close(); app = null; await launch();
    assert.equal(await editor.evaluate(element => element.editor.state.doc.textContent), text + invalid); assert.equal((await recovery()).notes, project.notes);
    await command('undo'); await waitFor(async () => textOf((await recovery()).chapters[0].content) === text, 'restart undo removes the staged invalid edit');
    await command('redo'); await waitFor(async () => textOf((await recovery()).chapters[0].content) === text + invalid, 'redo stages the complete invalid edit again');
    assert.deepEqual(await fs.readFile(target), original);
    await command('undo'); await waitFor(async () => textOf((await recovery()).chapters[0].content) === text, 'second undo restores representable prose');
    checks.push('Restart loads the complete staged draft; persistent undo and redo work without damaging the valid source.');
    const valid = ' A valid later edit.'; await insert(valid);
    await waitFor(async () => {
      const xml = await (await JSZip.loadAsync(await fs.readFile(target))).file('content.xml').async('string');
      return xml.replace(/<text:s\b[^>]*\/>/g, ' ').includes(valid) && textOf((await recovery()).chapters[0].content) === text + valid;
    }, 'editing again saves valid ODT and recovery');
    await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
    await app.close(); app = null; await launch(); assert.equal(await editor.evaluate(element => element.editor.state.doc.textContent), text + valid);
    assert.equal((await page.evaluate(() => window.wraiter.boot())).binding.format, 'odt'); checks.push('Removing the invalid edit resumes genuine ODT saveback and preserves the native binding across restart.');
    const validOffice = await fs.readFile(target), invalidTitle = project.title + '\u0000staged title';
    await page.locator('.document-name').click();
    const titleDialog = page.getByRole('dialog', { name: 'Document title', exact: true });
    await titleDialog.getByRole('textbox', { name: 'Manuscript title', exact: true }).fill(invalidTitle);
    await titleDialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Save needs attention', exact: true }).waitFor();
    await waitFor(async () => (await recovery()).title === invalidTitle, 'invalid title still reaches durable recovery');
    assert.deepEqual(await fs.readFile(target), validOffice, 'invalid XML metadata cannot replace valid office bytes');
    await app.close(); app = null; await launch();
    assert.equal((await recovery()).title, invalidTitle); assert.equal(await editor.evaluate(element => element.editor.state.doc.textContent), text + valid);
    await command('undo'); await waitFor(async () => (await recovery()).title === project.title, 'undo restores the representable title');
    await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
    const restoredOffice = await JSZip.loadAsync(await fs.readFile(target));
    for (const name of ['content.xml', 'styles.xml', 'meta.xml']) {
      const xml = await restoredOffice.file(name).async('string');
      assert.ok(await page.evaluate(xml => !new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length, xml), 'Saveback after title undo produced invalid XML: ' + name);
    }
    checks.push('Invalid title metadata preserves the complete draft and original ODT through close/restart; undo restores ordinary saveback.');
    assert.deepEqual(errors, []); await page.screenshot({ path: path.join(userData, 'final.png') });
    const result = { passed: true, checks, errors, userData }; await fs.writeFile(path.join(output, 'native-save-errors-ui-results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(userData, 'failure.png') }).catch(() => {}); console.error(JSON.stringify({ userData, checks, errors })); throw error; }
  finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
