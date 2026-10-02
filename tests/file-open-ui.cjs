const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const project = (id, title, text) => ({ format: 'wraiter', version: 1, id, title, language: 'en-US', chapters: [{ id: id + '-chapter', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }] });
const waitFor = async (fn, label) => { const until = Date.now() + 30000; while (Date.now() < until) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(label); };

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'file-open-')), errors = [], checks = [];
  const documents = path.join(userData, 'Stories & drafts'); await fs.mkdir(documents);
  const files = [path.join(documents, 'Älpha story.WRAITER'), path.join(documents, 'Beta with spaces.wraiter'), path.join(documents, 'Gamma.wraiter'), path.join(documents, 'Delta.wraiter')];
  const titles = ['Alpha shell project', 'Beta shell project', 'Gamma shell project', 'Delta shell project'];
  for (let index = 0; index < files.length; index++) await fs.writeFile(files[index], JSON.stringify(project('shell-' + index, titles[index], titles[index] + ' text.')));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore' }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: project('restored-draft', 'Restored draft', 'Keep this recovered draft.'), path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.WRAITER_EXECUTABLE || require('electron');
  const prefix = process.env.WRAITER_EXECUTABLE ? [] : [root];
  let application, page;
  const launch = async target => {
    application = await _electron.launch({ executablePath: executable, args: [...prefix, target], env, timeout: 60000 });
    page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
  };
  const shellOpen = targets => new Promise((resolve, reject) => {
    const child = spawn(executable, [...prefix, ...targets], { cwd: documents, env, windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('The second instance did not exit.')); }, 30000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Second instance exited with ' + code)); });
  });
  const boot = () => page.evaluate(() => window.wraiter.boot());
  const editor = () => page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
  const active = target => waitFor(async () => (await boot()).path === target && !await page.locator('.workspace').evaluate(element => element.inert), 'Did not open ' + target);
  const command = value => application.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('command', value), value);
  const close = async () => { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await application?.close().catch(() => {}); application = null; };
  try {
    await launch(files[0]); await active(files[0]); assert.equal(await editor().innerText(), titles[0] + ' text.');
    assert.deepEqual((await boot()).workspace.tabs.map(tab => tab.title), ['Restored draft', titles[0]]);
    checks.push('A cold shell launch opens a Unicode filename with spaces and preserves recovered projects.');

    await editor().focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' Immediate unsaved edit.');
    await shellOpen([path.basename(files[1])]); await active(files[1]);
    assert.equal(await editor().innerText(), titles[1] + ' text.');
    assert.match(await fs.readFile(files[0], 'utf8'), /Immediate unsaved edit/);
    checks.push('A real second process resolves relative arguments, opens in the existing window, and saves current typing.');

    await shellOpen([files[0]]); await active(files[0]); assert.equal((await boot()).workspace.tabs.length, 3);
    assert.match(await editor().innerText(), /Immediate unsaved edit/);
    await shellOpen([files[1], files[2], files[2]]); await active(files[2]);
    assert.equal((await boot()).workspace.tabs.length, 4);
    checks.push('Already-open files reuse their tabs; multiple shell files open in order without duplicate tabs.');

    await command('settings-general'); await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await shellOpen([files[3]]);
    await waitFor(async () => await page.evaluate(() => window.wraiter.nextExternalFile()) === files[3], 'File was not queued during Settings');
    assert.equal((await boot()).path, files[2]);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await active(files[3]);
    checks.push('Shell requests restore a minimized window and wait for a dialog to close before changing the project.');

    const invalid = path.join(documents, 'Broken.wraiter'); await fs.writeFile(invalid, '{broken');
    const previous = (await boot()).workspace.activeId;
    await shellOpen([invalid]); await waitFor(async () => /JSON|parse|Unexpected/i.test(await page.locator('.toast').innerText()), 'Invalid-file error was not shown');
    assert.equal((await boot()).workspace.activeId, previous);
    await shellOpen([path.join(documents, 'Missing.wraiter'), files[1]]); await active(files[1]);
    await waitFor(async () => await page.evaluate(() => window.wraiter.nextExternalFile()) === null, 'Queue did not drain');
    assert.equal((await boot()).workspace.tabs.length, 5);
    await assert.rejects(page.evaluate(target => window.wraiter.openExternalFile(target), files[0]), /not requested/);
    checks.push('Missing and malformed files show an error without replacing the current project or blocking later requests.');

    await close();
    await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: false, tutorialComplete: true, enabled: false, startup: 'new' }));
    await launch(files[0]); await page.getByRole('dialog', { name: 'Welcome to WRAITER', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.wraiter.nextExternalFile()), files[0]);
    assert.equal((await boot()).path, null);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await active(files[0]);
    checks.push('A first-run shell request survives account setup and opens after the guide is closed, including clean-start mode.');

    assert.deepEqual(errors, []);
    const report = { passed: true, packaged: Boolean(process.env.WRAITER_EXECUTABLE), checks, userData };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'file-open-packaged-results.json' : 'file-open-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'file-open-failure.png') }).catch(() => {}); console.error('Renderer errors:', errors); throw error; }
  finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
