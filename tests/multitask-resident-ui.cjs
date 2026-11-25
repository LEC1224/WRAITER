const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const waitFor = async (check, message = 'Resident document state did not settle') => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(message);
};
(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'multitask-resident-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, localGrammar: false, theme: 'dark' }));
  const wraiter = path.join(profile, 'Orchard.wraiter'), native = path.join(profile, 'Harbour.txt');
  await fs.writeFile(wraiter, JSON.stringify({ format: 'wraiter', version: 1, id: 'resident-Orchard', title: 'Orchard', chapters: [{ id: 'orchard-opening', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Orchard keeps its own project, history and binding.' }] }] } }] }));
  await fs.writeFile(native, 'Harbour keeps its native text file.');
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, ids;
  const errors = [], checks = [];
  const start = async files => {
    app = await _electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: files } : { args: [root, ...files] }), env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.locator('.manuscript').first().waitFor({ timeout: 30000 });
    if (files.length) {
      await waitFor(async () => await page.getByRole('tab', { name: 'Orchard', exact: true }).getAttribute('aria-selected') === 'true' && !await page.locator('.workspace').evaluate(el => el.inert));
      await app.evaluate(({ dialog, BrowserWindow }, target) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
        BrowserWindow.getAllWindows()[0].webContents.send('command', 'open');
      }, native);
    }
    await waitFor(async () => { const state = await page.evaluate(() => window.wraiter.boot()); return ['Orchard', 'Harbour'].every(name => state.workspace.tabs.some(tab => tab.title === name)); });
    ids = Object.fromEntries((await page.evaluate(() => window.wraiter.boot())).workspace.tabs.map(tab => [tab.title, tab.id]));
  };
  const editor = name => page.locator(`[data-pane-id="${ids[name]}"] .manuscript`);
  const ready = name => waitFor(async () => await editor(name).count() > 0 && await editor(name).getAttribute('contenteditable') === 'true' && !await page.locator('.workspace').evaluate(el => el.inert));
  const click = async name => {
    const p = await editor(name).evaluate(el => { const r = el.editor.view.coordsAtPos(1); return { x: r.left, y: (r.top + r.bottom) / 2 }; });
    await page.mouse.click(p.x, p.y); await ready(name);
    assert.equal(await page.locator('.file-format-label').innerText(), name === 'Harbour' ? 'TXT' : 'WRAITER');
  };
  const wraiterText = async () => JSON.parse(await fs.readFile(wraiter, 'utf8')).chapters[0].content.content.map(node => (node.content || []).map(item => item.text || '').join('')).join('\n');
  try {
    await start([wraiter]);
    await app.evaluate(({ Menu }) => { Menu.prototype.popup = function() { global.residentMenu = this; }; });
    await page.locator(`[data-project-tab="${ids.Orchard}"] [role=tab]`).click(); await ready('Orchard');
    await page.locator(`[data-project-tab="${ids.Harbour}"] [role=tab]`).click({ button: 'right' });
    await waitFor(() => app.evaluate(() => !!global.residentMenu));
    await app.evaluate(({ BrowserWindow }) => global.residentMenu.getMenuItemById('tab-multitask-right').click(undefined, BrowserWindow.getAllWindows()[0], {})); await ready('Harbour');
    await app.evaluate(({ ipcMain }) => {
      global.residentHold = true; global.residentSaves = []; global.residentRelease = [];
      const save = ipcMain._invokeHandlers.get('autosave'); ipcMain.removeHandler('autosave');
      ipcMain.handle('autosave', async (...args) => {
        global.residentSaves.push({ projectId: args[1]?.id, format: args[2]?.format || 'wraiter', tabId: args[4] });
        if (global.residentHold) await new Promise(resolve => global.residentRelease.push(resolve));
        return save(...args);
      });
    });
    await click('Harbour'); await page.keyboard.insertText('NATIVE-EDIT ');
    await click('Orchard'); await page.keyboard.insertText('PROJECT-EDIT ');
    await waitFor(() => app.evaluate(() => global.residentRelease.length > 0));
    await click('Harbour'); await click('Orchard');
    await app.evaluate(() => { global.residentHold = false; global.residentRelease.splice(0).forEach(resolve => resolve()); });
    await waitFor(async () => (await fs.readFile(native, 'utf8')).startsWith('NATIVE-EDIT ') && (await wraiterText()).startsWith('PROJECT-EDIT '));
    assert.equal(await page.locator('.file-format-label').innerText(), 'WRAITER', 'A late native save changed the selected document binding');
    const saves = await app.evaluate(() => global.residentSaves);
    assert.ok(saves.some(save => save.tabId === ids.Harbour && save.format === 'txt'));
    assert.ok(saves.some(save => save.tabId === ids.Orchard && save.format === 'wraiter'));
    checks.push('Delayed native and WRAITER saves retain their own encoders, file paths and editor status');

    const closed = app.waitForEvent('close', { timeout: 30000 }); await page.evaluate(() => window.wraiter.window('close')); await closed;
    await start([]); await waitFor(async () => await page.locator('[data-pane-id]').count() === 2);
    await app.evaluate(({ ipcMain }) => {
      global.residentLoads = 0;
      const activate = ipcMain._invokeHandlers.get('workspace:activate'); ipcMain.removeHandler('workspace:activate');
      ipcMain.handle('workspace:activate', (...args) => { global.residentLoads++; return activate(...args); });
    });
    await click('Harbour'); assert.match(await editor('Harbour').innerText(), /^NATIVE-EDIT /);
    await page.keyboard.press('Control+z'); await waitFor(async () => !(await editor('Harbour').innerText()).startsWith('NATIVE-EDIT '));
    await click('Orchard'); assert.match(await editor('Orchard').innerText(), /^PROJECT-EDIT /);
    await click('Harbour'); await page.keyboard.press('Control+y'); await waitFor(async () => (await editor('Harbour').innerText()).startsWith('NATIVE-EDIT '));
    assert.equal(await app.evaluate(() => global.residentLoads), 0, 'Restored resident focus reloaded a journal');
    checks.push('Restart hydrates both resident journals before focus; native undo/redo stays separate without reloading');
    assert.deepEqual(errors, []);
    const result = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, profile, checks };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'multitask-resident-packaged-results.json' : 'multitask-resident-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'multitask-resident-failure.png') }).catch(() => {}); throw error; }
  finally {
    await app?.evaluate(() => { global.residentHold = false; (global.residentRelease || []).splice(0).forEach(resolve => resolve()); }).catch(() => {});
    await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
