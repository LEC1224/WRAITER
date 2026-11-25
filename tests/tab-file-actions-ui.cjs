const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const waitFor = async check => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error('Timed out waiting for tab file action.');
};
(async () => {
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  const userData = await fs.mkdtemp(path.join(root, 'test-output', 'tab-files-'));
  const file = path.join(userData, 'Story å & notes.wraiter');
  const project = { format: 'wraiter', version: 1, id: 'tab-files-fixture', title: 'Tab file actions', chapters: [{ id: 'one', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A fictional manuscript for testing.' }] }] } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  const errors = [];
  try {
    app = await _electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file] } : { args: [root, file] }), env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).path === file);
    await app.evaluate(({ Menu, shell, clipboard }) => {
      global.tabFileMenu = null; global.tabFileReveals = []; global.tabFileCopies = [];
      Menu.prototype.popup = function() { global.tabFileMenu = this; };
      shell.showItemInFolder = target => global.tabFileReveals.push(target);
      clipboard.writeText = text => global.tabFileCopies.push(text);
    });
    const boot = await page.evaluate(() => window.wraiter.boot()), savedId = boot.workspace.activeId;
    const popup = async id => {
      await app.evaluate(() => { global.tabFileMenu = null; });
      await page.locator(`[data-project-tab="${id}"] [role="tab"]`).click({ button: 'right' });
      await waitFor(() => app.evaluate(() => !!global.tabFileMenu));
      return app.evaluate(() => global.tabFileMenu.items.map(item => ({ id: item.id, enabled: item.enabled })));
    };
    const click = id => app.evaluate(({ BrowserWindow }, id) => {
      const item = global.tabFileMenu.getMenuItemById(id); assertEnabled(item);
      function assertEnabled(item) { if (!item?.enabled) throw new Error('Unavailable menu action'); }
      item.click(undefined, BrowserWindow.getAllWindows()[0], {});
    }, id);
    for (const background of [false, true]) {
      if (background) {
        await page.getByRole('button', { name: 'New project tab', exact: true }).click();
        await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).workspace.activeId !== savedId);
      }
      const activeId = (await page.evaluate(() => window.wraiter.boot())).workspace.activeId;
      for (const action of ['tab-reveal', 'tab-copy-path', 'tab-copy-name']) {
        const menu = await popup(savedId); assert.ok(menu.find(item => item.id === action)?.enabled);
        await click(action);
      }
      await waitFor(() => app.evaluate((_, count) => global.tabFileCopies.length === count, background ? 4 : 2));
      assert.equal((await page.evaluate(() => window.wraiter.boot())).workspace.activeId, activeId);
    }
    assert.deepEqual(await app.evaluate(() => global.tabFileCopies), [file, path.basename(file), file, path.basename(file)]);
    assert.deepEqual(await app.evaluate(() => global.tabFileReveals), [file, file]);
    const draftId = (await page.evaluate(() => window.wraiter.boot())).workspace.activeId;
    const draftMenu = await popup(draftId);
    for (const id of ['tab-reveal', 'tab-copy-path', 'tab-copy-name']) assert.equal(draftMenu.find(item => item.id === id).enabled, false);
    for (const id of ['tab-save', 'tab-save-as', 'tab-export', 'tab-print', 'tab-history']) assert.equal(draftMenu.find(item => item.id === id).enabled, true);
    for (const [id, action, expected] of [[draftId, 'copy-path', /Save this document/], ['missing', 'reveal', /no longer open/], [savedId, 'delete', /Unknown tab file action/]]) {
      const error = await page.evaluate(async ([id, action]) => { try { await window.wraiter.tabFileAction(id, action); return ''; } catch (error) { return error.message; } }, [id, action]);
      assert.match(error, expected);
    }
    const activate = async id => {
      await page.locator(`[data-project-tab="${id}"] [role="tab"]`).click();
      await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).workspace.activeId === id && !await page.locator('.workspace').evaluate(element => element.inert));
    };
    await app.evaluate(({ dialog }) => {
      global.tabSaveDialogs = []; global.tabSaveTarget = null;
      dialog.showSaveDialog = async (_window, options) => {
        global.tabSaveDialogs.push(options);
        return global.tabSaveTarget ? { canceled: false, filePath: global.tabSaveTarget } : { canceled: true };
      };
    });
    // Draft Save opens a picker and cancellation must keep it unnamed.
    await popup(draftId); await click('tab-save');
    await waitFor(() => app.evaluate(() => global.tabSaveDialogs.length === 1));
    assert.equal((await page.evaluate(() => window.wraiter.boot())).path, null);
    await popup(savedId); await click('tab-save');
    await page.locator('.toast').filter({ hasText: 'Document saved.' }).waitFor();
    assert.equal((await page.evaluate(() => window.wraiter.boot())).workspace.activeId, savedId);
    assert.equal(await app.evaluate(() => global.tabSaveDialogs.length), 1, 'Named Save must not use the previous draft path.');
    const beforeCopy = await fs.readFile(file);
    await activate(draftId);
    await popup(savedId); await click('tab-save-as');
    await waitFor(() => app.evaluate(() => global.tabSaveDialogs.length === 2));
    assert.equal((await page.evaluate(() => window.wraiter.boot())).path, file);
    assert.deepEqual(await fs.readFile(file), beforeCopy);
    const copy = path.join(userData, 'Saved copy å.wraiter');
    await app.evaluate((_, target) => { global.tabSaveTarget = target; }, copy);
    await activate(draftId);
    await popup(savedId); await click('tab-save-as');
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).path === copy);
    assert.equal(JSON.parse(await fs.readFile(copy, 'utf8')).chapters[0].content.content[0].content[0].text, 'A fictional manuscript for testing.');
    assert.deepEqual(await fs.readFile(file), beforeCopy, 'Save As preserves the original file.');
    // Location actions must resolve the new binding, even on a background tab.
    await activate(draftId); await popup(savedId); await click('tab-copy-path');
    await waitFor(() => app.evaluate((_, target) => global.tabFileCopies.at(-1) === target, copy));
    await popup(savedId); await click('tab-export');
    const exportDialog = page.getByRole('dialog', { name: 'Export document', exact: true });
    await exportDialog.waitFor();
    assert.equal((await page.evaluate(() => window.wraiter.boot())).workspace.activeId, savedId);
    await exportDialog.getByRole('combobox', { name: 'Export format' }).selectOption('txt');
    await exportDialog.getByRole('combobox', { name: 'Export destination' }).selectOption('clipboard');
    await exportDialog.getByRole('button', { name: 'Copy to clipboard', exact: true }).click();
    await waitFor(() => app.evaluate(() => global.tabFileCopies.at(-1).includes('A fictional manuscript for testing.')));
    await exportDialog.waitFor({ state: 'hidden' });
    await activate(draftId); await popup(savedId); await click('tab-print');
    await exportDialog.waitFor();
    assert.equal((await page.evaluate(() => window.wraiter.boot())).workspace.activeId, savedId);
    assert.equal(await exportDialog.getByRole('combobox', { name: 'Export destination' }).inputValue(), 'preview');
    await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await activate(draftId); await popup(savedId); await click('tab-history');
    await page.locator('.history-panel').waitFor();
    assert.equal((await page.evaluate(() => window.wraiter.boot())).workspace.activeId, savedId);
    await activate(draftId); await popup(savedId); await click('tab-close');
    await waitFor(async () => !(await page.evaluate(() => window.wraiter.boot())).workspace.tabs.some(tab => tab.id === savedId));
    const stale = await page.evaluate(async id => { try { await window.wraiter.tabFileAction(id, 'copy-path'); return ''; } catch (error) { return error.message; } }, savedId);
    assert.match(stale, /no longer open/);
    assert.deepEqual(errors, []);
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, userData, checks: ['Location actions use the clicked file without switching tabs, including Unicode names.', 'Unsaved location actions are disabled; invalid and closed targets are rejected.', 'Save on a draft opens a picker; named Save from a background tab uses its existing path.', 'Save As supports cancellation, saves the clicked document, preserves the original and updates subsequent path actions.', 'Export copies the clicked manuscript content; Print Preview opens preview settings; Revision History opens for the clicked tab.'] };
    await fs.writeFile(path.join(root, 'test-output', process.env.WRAITER_EXECUTABLE ? 'tab-file-actions-packaged-results.json' : 'tab-file-actions-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {});
    await app?.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
