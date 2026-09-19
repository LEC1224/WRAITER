const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (fn, label) => { const until = Date.now() + 20000; while (Date.now() < until) { try { if (await fn()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(label); };
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
(async () => {
  await fs.mkdir(output, { recursive: true }); const userData = await fs.mkdtemp(path.join(output, 'v06-tabs-')), errors = [], checks = [];
  const initial = { format: 'wraiter', version: 1, id: 'v06-alpha', title: 'Alpha project', language: 'en-US', chapters: [{ id: 'alpha-one', title: 'Opening', content: { type: 'doc', content: [paragraph('Alpha text.')] } }, { id: 'alpha-two', title: 'Second chapter', content: { type: 'doc', content: [paragraph('Alpha second chapter.')] } }] };
  const missing = path.join(userData, 'Missing.wraiter');
  let completions = 0, cancelled = 0, agentDelay = 0;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') return response.end('{"models":[{"name":"tab-test"}]}');
    let data = ''; for await (const chunk of request) data += chunk; const prompt = JSON.parse(data).prompt || '';
    if (prompt.includes('CURRENT TOOL RESULTS:')) {
      const serialized = prompt.match(/CURRENT TOOL RESULTS:\n(.*?)\n\nRemaining document tools:/s)?.[1] || '[]', records = JSON.parse(serialized);
      const answer = prompt.includes('Remove double spaces throughout this manuscript.') ? records.length ? { message: 'Removed repeated spaces from the Beta project.', done: true, tools: [] } : { message: 'Normalizing spaces.', done: false, tools: [{ name: 'normalize_spaces', arguments: { scope: 'all' } }] } : { message: 'A private answer for the Beta project.', done: true, tools: [] };
      return setTimeout(() => response.end(JSON.stringify({ response: JSON.stringify(answer) })), agentDelay);
    }
    completions++; const timer = setTimeout(() => response.end(JSON.stringify({ response: 'FOREIGN_COMPLETION_DO_NOT_INSERT' })), 5000);
    response.on('close', () => { clearTimeout(timer); if (!response.writableEnded) cancelled++; });
  }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: true, continuous: false, provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'tab-test', ollamaMode: 'raw', recent: [missing] }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: initial, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app, page, editor;
  const launch = async () => { app = await _electron.launch(options); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 }); };
  const boot = () => page.evaluate(() => window.wraiter.boot());
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const nativeKey = (keyCode, modifiers) => app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => { const window = BrowserWindow.getAllWindows()[0]; window.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); }, { keyCode, modifiers });
  const menu = (group, label) => app.evaluate(({ Menu }, [group, label]) => { const item = Menu.getApplicationMenu().items.find(item => item.label.replaceAll('&', '') === group)?.submenu.items.find(item => item.label.replaceAll('&', '') === label); if (!item) throw new Error('Missing menu ' + label); item.click(); }, [group, label]);
  const recent = target => app.evaluate(({ Menu }, target) => { const recent = Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'Open &recent'); const entry = recent.submenu.items.find(item => item.label.replaceAll('&&', '&') === target); if (!entry) throw new Error('Missing recent ' + target); entry.click(); }, target);
  const tabs = () => page.getByRole('tablist', { name: 'Open projects', exact: true });
  const activeTitle = title => waitFor(async () => await tabs().getByRole('tab', { name: title, exact: true }).getAttribute('aria-selected') === 'true' && !await page.locator('.workspace').evaluate(el => el.inert), 'Active tab ' + title);
  const choose = async title => { await tabs().getByRole('tab', { name: title, exact: true }).click(); await activeTitle(title); };
  const append = async text => { await editor.evaluate(element => { element.focus(); const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); }); await page.waitForTimeout(100); await page.keyboard.insertText(text); await waitFor(async () => JSON.stringify((await boot()).project).includes(text), 'Saved text ' + text); };
  const rename = async title => { await page.locator('.document-name').click(); await page.getByRole('textbox', { name: 'Manuscript title', exact: true }).fill(title); await page.getByRole('button', { name: 'Done', exact: true }).click(); await activeTitle(title); };
  const saveAs = async target => { await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target); await menu('File', 'Save as…'); await waitFor(async () => (await boot()).path === target, 'Saved as ' + target); };
  try {
    await launch(); assert.equal(await tabs().getByRole('tab').count(), 1); assert.equal((await boot()).prefs.startup, 'restore'); await append(' A1');
    await menu('File', 'New manuscript'); await activeTitle('Untitled manuscript'); await rename('Beta project'); await append('Beta text. B1');
    assert.equal(await tabs().getByRole('tab').count(), 2); await choose('Alpha project'); assert.equal(await editor.innerText(), 'Alpha text. A1'); await command('undo'); await waitFor(async () => await editor.innerText() === 'Alpha text.', 'Alpha undo');
    await choose('Beta project'); assert.equal(await editor.innerText(), 'Beta text. B1'); await command('undo'); await waitFor(async () => (await editor.innerText()).trim() === '', 'Beta undo'); await command('redo'); await waitFor(async () => await editor.innerText() === 'Beta text. B1', 'Beta redo');
    checks.push('New creates a second tab; typing, undo and redo stay in the correct project.');

    const betaFile = path.join(userData, 'Beta project.odt'), alphaFile = path.join(userData, 'Alpha & first.wraiter');
    await saveAs(betaFile); await choose('Alpha project'); await saveAs(alphaFile); await recent(betaFile); await activeTitle('Beta project'); assert.equal(await tabs().getByRole('tab').count(), 2); assert.equal((await boot()).binding.format, 'odt');
    await nativeKey('Tab', ['control']); await activeTitle('Alpha project'); await nativeKey('Tab', ['control', 'shift']); await activeTitle('Beta project');
    await page.getByRole('button', { name: 'Close project Alpha project', exact: true }).click(); await waitFor(async () => await tabs().getByRole('tab').count() === 1, 'Inactive close'); assert.equal((await boot()).path, betaFile);
    await recent(alphaFile); await activeTitle('Alpha project'); assert.equal(await tabs().getByRole('tab').count(), 2); assert.equal(await editor.innerText(), 'Alpha text.');
    checks.push('Open Recent is a native File submenu, reuses open tabs, and preserves separate ODT/WRAITER save bindings.');

    const nativeCopy = path.join(userData, 'Native copy.odt'); await fs.copyFile(betaFile, nativeCopy);
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, nativeCopy); await menu('File', 'Open…');
    await waitFor(async () => (await boot()).path === nativeCopy && await tabs().getByRole('tab').count() === 3 && !await page.locator('.workspace').evaluate(el => el.inert), 'Native ODT opened in a new tab'); await rename('Native copy'); assert.equal(await editor.innerText(), 'Beta text. B1'); assert.equal((await boot()).binding.format, 'odt');
    await nativeKey('W', ['control']); await activeTitle('Alpha project'); assert.equal(await tabs().getByRole('tab').count(), 2);
    checks.push('Native Open imports an ODT into its own tab; Ctrl+Tab, Ctrl+Shift+Tab and Ctrl+W work through the Windows accelerators.');

    await page.getByRole('button', { name: 'New project tab', exact: true }).click(); await activeTitle('Untitled manuscript'); await rename('Gamma draft'); await append('An unnamed draft worth keeping.');
    await menu('File', 'Close project tab'); await activeTitle('Alpha project'); const gammaFile = (await page.evaluate(() => window.wraiter.getRecents())).find(target => target.includes('Gamma draft'));
    assert.ok(gammaFile); assert.match(await fs.readFile(gammaFile, 'utf8'), /An unnamed draft worth keeping/); await recent(gammaFile); await activeTitle('Gamma draft'); assert.equal(await editor.innerText(), 'An unnamed draft worth keeping.');
    checks.push('Closing an unnamed draft preserves it in Open Recent and reopening restores its text.');

    await choose('Alpha project'); await page.locator('.chapter-select').filter({ hasText: 'Second chapter' }).click(); await choose('Beta project'); await append(' B2'); await page.screenshot({ path: path.join(output, 'v06-project-tabs.png') });
    await app.close(); await launch(); await activeTitle('Beta project'); assert.equal(await tabs().getByRole('tab').count(), 3); assert.equal((await boot()).binding.format, 'odt'); assert.equal(await editor.innerText(), 'Beta text. B1 B2'); await command('undo'); await waitFor(async () => await editor.innerText() === 'Beta text. B1', 'Cross-session beta undo');
    await choose('Alpha project'); assert.equal(await editor.innerText(), 'Alpha second chapter.'); await choose('Gamma draft'); assert.equal(await editor.innerText(), 'An unnamed draft worth keeping.');
    checks.push('Restart restores tab order, the active project, chapter position, native binding and independent undo history.');

    agentDelay = 350; await choose('Beta project'); await append('  Background'); assert.equal(await editor.innerText(), 'Beta text. B1  Background'); await command('toggle-assistant'); await page.getByRole('textbox', { name: 'Ask the writing assistant', exact: true }).fill('Remove double spaces throughout this manuscript.'); await page.getByRole('button', { name: 'Send writing question', exact: true }).click();
    await choose('Gamma draft'); assert.equal(await page.getByText('Removed repeated spaces from the Beta project.', { exact: true }).count(), 0); const betaTab = tabs().getByRole('tab', { name: 'Beta project', exact: true }); await waitFor(async () => await betaTab.locator('.tab-assistant-status.unread').count() === 1, 'Background assistant reply indicator');
    const betaTabId = (await boot()).workspace.tabs.find(tab => tab.title === 'Beta project').id;
    await waitFor(async () => JSON.stringify(JSON.parse(await fs.readFile(path.join(userData, 'Open projects', betaTabId, 'recovery.json'), 'utf8')).project.chats).includes('Removed repeated spaces from the Beta project.'), 'Background chat persisted before returning');
    await choose('Beta project'); await page.getByText('Removed repeated spaces from the Beta project.', { exact: true }).waitFor(); await waitFor(async () => await editor.innerText() === 'Beta text. B1 Background', 'Background assistant edit applied to Beta'); agentDelay = 0;
    await editor.evaluate(element => { element.focus(); const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); }); await page.waitForTimeout(100); await page.keyboard.press('Tab'); await waitFor(() => completions === 1, 'Completion request started');
    await choose('Alpha project'); await waitFor(() => cancelled === 1, 'Pending completion cancelled on tab switch'); assert.equal(await page.locator('.ghost-text').count(), 0); assert.ok(!JSON.stringify((await boot()).project).includes('FOREIGN_COMPLETION')); await choose('Beta project'); assert.equal(await editor.innerText(), 'Beta text. B1 Background');
    checks.push('Assistant chat finishes and saves its reply in the originating project while another tab is active; inline completion still cancels on tab switch before it can affect another document.');

    await page.getByRole('button', { name: 'New project tab', exact: true }).click(); await activeTitle('Untitled manuscript'); await rename('Delta draft'); await append('Preserve this on clean startup.');
    await menu('Settings', 'General and startup…'); await page.getByRole('combobox', { name: 'When WRAITER starts', exact: true }).selectOption('new'); await page.screenshot({ path: path.join(output, 'v06-startup-settings.png') }); await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' });
    await app.close(); await launch(); await activeTitle('Untitled manuscript'); assert.equal(await tabs().getByRole('tab').count(), 1); assert.equal((await editor.innerText()).trim(), ''); assert.equal((await boot()).path, null);
    const deltaFile = (await page.evaluate(() => window.wraiter.getRecents())).find(target => target.includes('Delta draft')); assert.ok(deltaFile); assert.match(await fs.readFile(deltaFile, 'utf8'), /Preserve this on clean startup/);
    await menu('Settings', 'General and startup…'); await page.getByRole('combobox', { name: 'When WRAITER starts', exact: true }).selectOption('restore'); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.equal((await boot()).prefs.startup, 'new');
    checks.push('Clean startup opens one blank project while preserving drafts in recents; cancelling settings leaves the saved startup choice unchanged.');

    const before = (await boot()).workspace.activeId; await recent(missing); await waitFor(async () => /ENOENT|no such file/i.test(await page.locator('.toast').innerText()), 'Missing recent warning'); assert.equal((await boot()).workspace.activeId, before); assert.equal(await tabs().getByRole('tab').count(), 1);
    await command('clear-recents'); await waitFor(async () => (await page.evaluate(() => window.wraiter.getRecents())).length === 0, 'Clear recents'); assert.ok((await fs.stat(alphaFile)).size > 0); assert.ok((await fs.stat(betaFile)).size > 0);
    checks.push('A missing recent file leaves the current tab intact; clearing recents does not delete documents.');
    assert.deepEqual(errors, []); const report = { passed: true, checks, userData }; await fs.writeFile(path.join(output, 'v06-app-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'v06-failure.png') }).catch(() => {}); console.error('Renderer errors:', errors); throw error; }
  finally { await app?.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
