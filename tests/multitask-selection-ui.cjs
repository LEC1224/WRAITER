// Real first-click / first-drag gestures, with synthetic documents and an isolated profile.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const waitFor = async (check, message = 'Selection did not settle') => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(message);
};

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'multitask-selection-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', theme: 'dark', spellcheck: false, localGrammar: false, pageMode: 'continuous' }));
  const names = ['Orchard', 'Harbour', 'Mountain'], files = [], errors = [], checks = [];
  for (const name of names) {
    const file = path.join(profile, `${name}.wraiter`);
    await fs.writeFile(file, JSON.stringify({ format: 'wraiter', version: 1, id: `selection-${name}`, title: name, notes: `${name} notes`, chapters: [{ id: 'opening', title: name, content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha ' }, { type: 'text', text: 'bravo', marks: [{ type: 'bold' }] }, { type: 'text', text: ' charlie delta echo foxtrot golf hotel india juliet kilo lima.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: `${name} keeps its own cursor and history.` }] },
      ...Array.from({ length: 100 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `${name} paragraph ${index}: Plenty of text for independent scrolling and selection across several lines.` }] }))
    ] } }] })); files.push(file);
  }
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  try {
    app = await _electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: files } : { args: [root, ...files] }), env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.locator('.manuscript').waitFor({ timeout: 30000 });
    await waitFor(async () => { const state = await page.evaluate(() => window.wraiter.boot()); return names.every(name => state.workspace.tabs.some(tab => tab.title === name)); });
    await app.evaluate(async ({ BrowserWindow, Menu, clipboard, ClipboardItem, ipcMain }) => {
      BrowserWindow.getAllWindows()[0].setSize(1800, 1000);
      Menu.prototype.popup = function() { global.selectionMenu = this; };
      global.selectionClipboard = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
      // Visible-pane focus must never use the loading/activation path.
      const activate = ipcMain._invokeHandlers.get('workspace:activate');
      ipcMain.removeHandler('workspace:activate');
      ipcMain.handle('workspace:activate', async (...args) => {
        global.selectionActivations = (global.selectionActivations || 0) + 1;
        return activate(...args);
      });
      const autosave = ipcMain._invokeHandlers.get('autosave');
      ipcMain.removeHandler('autosave');
      ipcMain.handle('autosave', async (...args) => {
        if (global.selectionDelay) await new Promise(resolve => setTimeout(resolve, global.selectionDelay));
        return autosave(...args);
      });
    });
    const boot = await page.evaluate(() => window.wraiter.boot());
    const ids = Object.fromEntries(boot.workspace.tabs.map(tab => [tab.title, tab.id]));
    const pane = name => page.locator(`[data-pane-id="${ids[name]}"]`);
    const editor = name => pane(name).locator('.manuscript');
    const ready = name => waitFor(async () => await pane(name).getAttribute('data-active') === 'true' && await editor(name).getAttribute('contenteditable') === 'true' && !await page.locator('.workspace').evaluate(element => element.inert));
    const focus = name => waitFor(() => editor(name).evaluate(element => document.activeElement === element));
    const chooseTab = async name => { await page.locator(`[data-project-tab="${ids[name]}"] [role=tab]`).click(); await ready(name); };
    const menu = async (name, command) => {
      await app.evaluate(() => { global.selectionMenu = null; });
      await page.locator(`[data-project-tab="${ids[name]}"] [role=tab]`).click({ button: 'right' });
      await waitFor(() => app.evaluate(() => !!global.selectionMenu));
      await app.evaluate(({ BrowserWindow }, command) => global.selectionMenu.getMenuItemById(command).click(undefined, BrowserWindow.getAllWindows()[0], {}), command);
    };
    const point = (name, position) => editor(name).evaluate((element, position) => {
      const rect = element.editor.view.coordsAtPos(position);
      return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
    }, position);
    const selection = name => editor(name).evaluate(element => {
      const { anchor, head, from, to } = element.editor.state.selection;
      return { anchor, head, text: element.editor.state.doc.textBetween(from, to, '\n'), dom: window.getSelection().toString() };
    });
    const clickAt = async (name, position) => { const p = await point(name, position); await page.mouse.click(p.x, p.y); };
    const drag = async (name, anchor, head, hold = false) => {
      const a = await point(name, anchor), b = await point(name, head);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      if (hold) { await ready(name); await focus(name); }
      await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
      await ready(name); await focus(name);
      await waitFor(async () => { const s = await selection(name); return s.anchor === anchor && s.head === head; }, `${name}: expected selection ${anchor} → ${head}, got ${JSON.stringify(await selection(name))}`);
      const s = await selection(name); assert.equal(s.dom, s.text);
      return s.text;
    };
    await chooseTab('Orchard');
    await menu('Harbour', 'tab-multitask-right'); await ready('Harbour');
    await menu('Mountain', 'tab-multitask-right'); await ready('Mountain');
    await page.getByRole('button', { name: 'Toggle notes & voice', exact: true }).click();
    await page.locator('.manuscript').evaluateAll(elements => { window.selectionEditors = elements.map(element => element.editor); });
    const activationCount = await app.evaluate(() => global.selectionActivations);
    await page.evaluate(() => {
      window.selectionInputBlocks = 0;
      const workspace = document.querySelector('.workspace');
      window.selectionBlockObserver = new MutationObserver(records => { window.selectionInputBlocks += records.filter(record => record.attributeName === 'inert').length; });
      window.selectionBlockObserver.observe(workspace, { attributes: true, attributeFilter: ['inert'] });
    });

    const word = await point('Orchard', 9);
    await page.mouse.dblclick(word.x, word.y);
    assert.match((await selection('Orchard')).text, /^bravo ?$/);
    await clickAt('Harbour', 13); await clickAt('Orchard', 25);
    assert.deepEqual(await editor('Orchard').evaluate(element => ({ from: element.editor.state.selection.from, to: element.editor.state.selection.to })), { from: 25, to: 25 });
    checks.push('Native double-click selects a word; rapid returns to another pane place a single cursor');
    await clickAt('Mountain', 25);
    const copied = await drag('Orchard', 7, 20);
    assert.equal(copied, 'bravo charlie');
    checks.push('First drag selects text while activating an inactive pane');
    await page.keyboard.press('Control+c');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), copied);
    const original = await editor('Harbour').evaluate(element => element.editor.state.doc.textContent);
    await clickAt('Harbour', 13); await page.keyboard.press('Control+v');
    await ready('Harbour'); await focus('Harbour');
    await waitFor(async () => await editor('Harbour').evaluate(element => element.editor.state.doc.textContent) === original.slice(0, 12) + copied + original.slice(12), 'First click did not place the paste at the chosen position');
    assert.equal(await editor('Harbour').evaluate(element => element.editor.state.doc.rangeHasMark(13, 18, element.editor.schema.marks.bold)), true, 'Paste lost the copied formatting');
    assert.equal(await page.getByRole('textbox', { name: 'Private manuscript notes', exact: true }).inputValue(), 'Harbour notes');
    checks.push('Native Ctrl+C, first-click cursor placement and immediate Ctrl+V across panes');
    assert.equal(await page.locator('.manuscript').evaluateAll(elements => elements.every(element => window.selectionEditors.includes(element.editor))), true, 'Switching replaced a retained editor');
    await page.keyboard.press('Control+z');
    await waitFor(async () => await editor('Harbour').evaluate(element => element.editor.state.doc.textContent) === original);
    // Undo deliberately restores a fresh history view; subsequent focus changes
    // must keep that new instance, along with the other two untouched editors.
    await editor('Harbour').evaluate(element => window.selectionEditors.push(element.editor));

    await drag('Mountain', 20, 7, true);
    checks.push('Backward selection continues after activation while the mouse is held');
    await clickAt('Orchard', 7); await ready('Orchard'); await focus('Orchard');
    await page.keyboard.down('Shift'); await clickAt('Mountain', 30); await page.keyboard.up('Shift');
    await ready('Mountain'); await focus('Mountain');
    assert.deepEqual(await editor('Mountain').evaluate(element => ({ anchor: element.editor.state.selection.anchor, head: element.editor.state.selection.head })), { anchor: 20, head: 30 });
    checks.push('Shift-click extends the inactive document’s existing selection');
    await app.evaluate(() => { global.selectionDelay = 500; });
    await drag('Orchard', 7, 57);
    checks.push('Native wrapped-line selection while background saves are delayed');
    await clickAt('Harbour', 25); await page.keyboard.press('Control+v');
    await ready('Harbour'); await focus('Harbour');
    await waitFor(async () => await editor('Harbour').evaluate(element => element.editor.state.doc.textContent) === original.slice(0, 24) + copied + original.slice(24), 'Paste was lost during delayed activation');
    await app.evaluate(() => { global.selectionDelay = 0; });
    checks.push('Clipboard paste does not wait for background saves');

    await app.evaluate(() => { global.selectionDelay = 500; });
    const a = await point('Mountain', 7), b = await point('Mountain', 20);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
    await page.keyboard.press('Control+c');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), copied);
    await ready('Mountain'); await focus('Mountain');
    assert.equal((await selection('Mountain')).text, copied);
    await app.evaluate(() => { global.selectionDelay = 0; });
    checks.push('Native copy immediately after mouseup while saves are delayed');

    // There is no delayed focus handoff to overwrite later input.
    await app.evaluate(() => { global.selectionDelay = 500; });
    await clickAt('Orchard', 25); await page.keyboard.press('Escape'); await ready('Orchard');
    assert.equal(await editor('Orchard').evaluate(element => element === document.activeElement), true);
    assert.equal((await selection('Orchard')).head, 25);
    await app.evaluate(() => { global.selectionDelay = 0; });
    await clickAt('Harbour', 7); await ready('Harbour'); await focus('Harbour');
    assert.equal((await selection('Harbour')).head, 7);
    checks.push('Escape does not undo an already committed first-click cursor');

    const mountainText = await editor('Mountain').evaluate(element => element.editor.state.doc.textContent);
    await app.evaluate(() => { global.selectionDelay = 500; });
    const cutStart = await point('Mountain', 7), cutEnd = await point('Mountain', 20);
    await page.mouse.move(cutStart.x, cutStart.y); await page.mouse.down(); await page.mouse.move(cutEnd.x, cutEnd.y, { steps: 6 }); await page.mouse.up();
    await page.keyboard.press('Control+x'); await ready('Mountain'); await focus('Mountain');
    await waitFor(async () => await editor('Mountain').evaluate(element => element.editor.state.doc.textContent) === mountainText.slice(0, 6) + mountainText.slice(19));
    await page.keyboard.press('Control+z');
    await waitFor(async () => await editor('Mountain').evaluate(element => element.editor.state.doc.textContent) === mountainText);
    await editor('Mountain').evaluate(element => window.selectionEditors.push(element.editor));
    checks.push('Delayed cut and undo affect only the selected document');

    await app.evaluate(() => { global.selectionDelay = 0; });
    await clickAt('Orchard', 7); await ready('Orchard'); await focus('Orchard');
    assert.equal((await selection('Orchard')).head, 7);

    const scrolls = () => page.locator('.writing-scroll').evaluateAll(elements => elements.map(el => el.scrollTop));
    const beforeScroll = await scrolls(), edgeStart = await point('Harbour', 7), scrollBounds = await pane('Harbour').locator('.writing-scroll').boundingBox();
    await page.mouse.move(edgeStart.x, edgeStart.y); await page.mouse.down(); await ready('Harbour'); await focus('Harbour');
    await page.mouse.move(edgeStart.x, scrollBounds.y + scrollBounds.height + 8, { steps: 8 });
    await waitFor(async () => await pane('Harbour').locator('.writing-scroll').evaluate(el => el.scrollTop) > 80);
    await page.mouse.up();
    const afterScroll = await scrolls();
    assert.equal(afterScroll[0], beforeScroll[0]); assert.equal(afterScroll[2], beforeScroll[2]);
    assert.ok((await selection('Harbour')).head > 7);
    await page.waitForTimeout(100);
    assert.deepEqual(await scrolls(), afterScroll, 'Selection autoscroll continued after mouseup');
    checks.push('Selection autoscroll stays in the dragged pane and stops on release');

    assert.equal(await app.evaluate(() => global.selectionActivations), activationCount, 'A visible-pane click loaded a document');
    assert.equal(await page.evaluate(() => window.selectionInputBlocks), 0, 'A visible-pane click blocked workspace input');
    checks.push('No document reload or inert workspace at any point while switching resident panes');

    assert.equal(await page.locator('.manuscript').evaluateAll(elements => elements.every(element => window.selectionEditors.includes(element.editor))), true, 'Switching replaced a retained editor');
    assert.deepEqual(errors, []);
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, profile, checks };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'multitask-selection-packaged-results.json' : 'multitask-selection-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'multitask-selection-failure.png') }).catch(() => {}); throw error; }
  finally {
    await app?.evaluate(async ({ clipboard }) => { if (global.selectionClipboard) await clipboard.write(global.selectionClipboard); }).catch(() => {});
    await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
