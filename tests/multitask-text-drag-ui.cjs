const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const waitFor = async (check, message = 'Text drop did not settle') => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(message);
};
(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'multitask-text-drag-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, localGrammar: false, theme: 'dark', pageMode: 'continuous' }));
  const names = ['Orchard', 'Harbour'], files = [], checks = [], errors = [];
  for (const name of names) {
    const file = path.join(profile, `${name}.wraiter`);
    await fs.writeFile(file, JSON.stringify({ format: 'wraiter', version: 1, id: `drag-${name}`, title: name, chapters: [{ id: `chapter-${name}`, title: name, content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha ' }, { type: 'text', text: 'bravo charlie', marks: [{ type: 'bold' }] }, { type: 'text', text: ' delta echo foxtrot.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: `${name} has a separate destination and history.` }] },
      ...Array.from({ length: 1500 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `${name} ${i}: One two three four five six seven eight nine ten eleven twelve thirteen fourteen.` }] }))
    ] } }] })); files.push(file);
  }
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  try {
    app = await _electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: files } : { args: [root, ...files] }), env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.locator('.manuscript').waitFor({ timeout: 30000 });
    await waitFor(async () => { const boot = await page.evaluate(() => window.wraiter.boot()); return names.every(name => boot.workspace.tabs.some(tab => tab.title === name)); });
    await app.evaluate(({ BrowserWindow, Menu, ipcMain }) => {
      BrowserWindow.getAllWindows()[0].setSize(1700, 1000);
      Menu.prototype.popup = function() { global.textDragMenu = this; };
      global.waitingSaves = []; global.saveRequests = [];
      const save = ipcMain._invokeHandlers.get('autosave');
      ipcMain.removeHandler('autosave');
      ipcMain.handle('autosave', async (...args) => {
        global.saveRequests.push({ projectId: args[1]?.id, tabId: args[4] });
        if (global.holdSaves) await new Promise(resolve => global.waitingSaves.push(resolve));
        return save(...args);
      });
    });
    const ids = Object.fromEntries((await page.evaluate(() => window.wraiter.boot())).workspace.tabs.map(tab => [tab.title, tab.id]));
    const pane = name => page.locator(`[data-pane-id="${ids[name]}"]`);
    const editor = name => pane(name).locator('.manuscript');
    const ready = name => waitFor(async () => await pane(name).getAttribute('data-active') === 'true' && await editor(name).getAttribute('contenteditable') === 'true' && !await page.locator('.workspace').evaluate(el => el.inert));
    const point = (name, pos) => editor(name).evaluate((el, pos) => { const r = el.editor.view.coordsAtPos(pos); return { x: r.left, y: (r.top + r.bottom) / 2 }; }, pos);
    const click = async (name, pos = 30) => { const p = await point(name, pos); await page.mouse.click(p.x, p.y); await ready(name); };
    const text = name => editor(name).evaluate(el => el.editor.state.doc.textContent);
    const select = async (name, from, to) => {
      await click(name, 30);
      const a = await point(name, from), b = await point(name, to);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
      await waitFor(() => editor(name).evaluate((el, range) => el.editor.state.selection.from === range[0] && el.editor.state.selection.to === range[1], [from, to]));
    };
    const drag = async (source, target, from, to, cancel = false) => {
      const a = await point(source, from), b = await point(target, to);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(a.x + 12, a.y + 3, { steps: 3 });
      await page.mouse.move(b.x, b.y, { steps: 16 }); await page.mouse.move(b.x + .25, b.y);
      if (source !== target) {
        await page.locator('.multitask-copy-caret').waitFor();
        assert.equal(await pane(source).getAttribute('data-active'), 'true', 'Hovering a text drop stole focus');
      }
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up(); await page.locator('.multitask-copy-caret').waitFor({ state: 'hidden' });
    };
    await page.locator(`[data-project-tab="${ids.Orchard}"] [role=tab]`).click(); await ready('Orchard');
    await page.locator(`[data-project-tab="${ids.Harbour}"] [role=tab]`).click({ button: 'right' });
    await waitFor(() => app.evaluate(() => !!global.textDragMenu));
    await app.evaluate(({ BrowserWindow }) => global.textDragMenu.getMenuItemById('tab-multitask-right').click(undefined, BrowserWindow.getAllWindows()[0], {})); await ready('Harbour');
    const orchard = await text('Orchard'), harbour = await text('Harbour');
    await select('Orchard', 7, 20);
    await drag('Orchard', 'Harbour', 10, 25);
    await ready('Harbour');
    await waitFor(async () => await text('Harbour') === harbour.slice(0, 24) + 'bravo charlie' + harbour.slice(24), 'Cross-pane drop did not copy to its insertion caret');
    assert.equal(await text('Orchard'), orchard);
    assert.equal(await editor('Harbour').evaluate(el => el.editor.state.doc.rangeHasMark(25, 38, el.editor.schema.marks.bold)), true);
    checks.push('Native cross-pane drop copies formatted text at its preview caret without removing the source');
    await page.keyboard.press('Control+z'); await waitFor(async () => await text('Harbour') === harbour);
    assert.equal(await text('Orchard'), orchard);
    checks.push('The copied passage is a destination-only undo step');

    await select('Orchard', 7, 20);
    await drag('Orchard', 'Orchard', 10, 30);
    await waitFor(async () => await text('Orchard') === orchard.slice(0, 6) + orchard.slice(19, 29) + 'bravo charlie' + orchard.slice(29), 'Within-pane drag stopped moving text');
    await page.keyboard.press('Control+z'); await waitFor(async () => await text('Orchard') === orchard);
    checks.push('Within-document dragging still moves the passage and undoes in one step');

    await select('Harbour', 7, 20); await drag('Harbour', 'Orchard', 10, 25, true);
    assert.equal(await text('Harbour'), harbour); assert.equal(await text('Orchard'), orchard);
    assert.equal(await pane('Harbour').getAttribute('data-active'), 'true');
    checks.push('Cancelling a cross-pane drag changes neither document nor focus');

    // Freeze persistence, then continue editing both large resident documents.
    await app.evaluate(() => { global.holdSaves = true; });
    await click('Harbour', 1); await page.keyboard.insertText('HARBOUR-EDIT ');
    await click('Orchard', 1); await page.keyboard.insertText('ORCHARD-EDIT ');
    await waitFor(() => app.evaluate(() => global.waitingSaves.length > 0));
    await page.evaluate(() => {
      window.focusDurations = []; window.blockedFocus = 0;
      window.focusTiming = event => { if (event.target.closest?.('.manuscript')) window.focusStarted = performance.now(); };
      window.addEventListener('pointerdown', window.focusTiming, true);
      window.addEventListener('pointerdown', event => {
        const editor = event.target.closest?.('.manuscript'); if (!editor) return;
        window.focusDurations.push(performance.now() - window.focusStarted);
        if (document.querySelector('.workspace').inert || editor.contentEditable !== 'true' || document.activeElement !== editor) window.blockedFocus++;
      });
    });
    for (let i = 0; i < 12; i++) {
      const name = i % 2 ? 'Orchard' : 'Harbour'; await click(name, 30);
      assert.equal(await page.locator('.manuscript[contenteditable="true"]').count(), 1);
    }
    const timing = await page.evaluate(() => ({ max: Math.max(...window.focusDurations), count: window.focusDurations.length, blocked: window.blockedFocus }));
    assert.equal(timing.count, 12);
    assert.equal(timing.blocked, 0); assert.ok(timing.max < 150, `Resident focus blocked for ${timing.max} ms`);
    assert.match(await text('Harbour'), /^HARBOUR-EDIT /); assert.match(await text('Orchard'), /^ORCHARD-EDIT /);
    await app.evaluate(() => { global.holdSaves = false; for (const release of global.waitingSaves.splice(0)) release(); });
    for (const name of names) await waitFor(async () => JSON.parse(await fs.readFile(files[names.indexOf(name)], 'utf8')).chapters[0].content.content[0].content[0].text.startsWith(name.toUpperCase() + '-EDIT '), `${name} was not saved to its own file`);
    checks.push('Repeated native focus and editing do not wait for blocked saves; each file retains only its own edits');
    assert.deepEqual(errors, []);
    const result = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, profile, paragraphsPerDocument: 1502, focusMaxMs: timing.max, checks };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'multitask-text-drag-packaged-results.json' : 'multitask-text-drag-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'multitask-text-drag-failure.png') }).catch(() => {}); throw error; }
  finally {
    await app?.evaluate(() => { global.holdSaves = false; for (const release of global.waitingSaves || []) release(); }).catch(() => {});
    await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
