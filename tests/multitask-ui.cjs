const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const waitFor = async (check, message = 'Multitask state did not settle') => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(message);
};

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'multitask-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, localGrammar: false, pageMode: 'continuous' }));
  const names = ['Orchard', 'Harbour', 'Mountain'];
  const line = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
  const files = await Promise.all(names.map(async (name, index) => {
    const file = path.join(profile, `${name}.wraiter`);
    const project = { format: 'wraiter', version: 1, id: `multitask-${index}`, title: name,
      documentStyle: { fontFamily: index === 1 ? 'Arial' : 'Cambria', fontSize: 12, lineHeight: 1.5 },
      chapters: [{ id: 'opening', title: `${name} opening`, content: { type: 'doc', content: Array.from({ length: 1500 }, (_, p) => ({ type: 'paragraph', content: [{ type: 'text', text: `${name} ${p + 1}: ${line}` }] })) } },
        { id: 'ending', title: `${name} ending`, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `The ${name} ending stays separate.` }] }] } }] };
    await fs.writeFile(file, JSON.stringify(project)); return file;
  }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const errors = [], timings = {};
  let app, page;
  try {
    app = await _electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: files } : { args: [root, ...files] }), env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.locator('.manuscript').waitFor({ timeout: 30000 });
    await waitFor(async () => {
      const tabs = (await page.evaluate(() => window.wraiter.boot())).workspace.tabs;
      return names.every(name => tabs.some(tab => tab.title === name)) && !await page.locator('.workspace').evaluate(element => element.inert);
    });
    await app.evaluate(({ BrowserWindow, Menu }) => {
      BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
      Menu.prototype.popup = function() { global.multitaskMenu = this; };
    });
    const boot = await page.evaluate(() => window.wraiter.boot());
    const ids = Object.fromEntries(boot.workspace.tabs.map(tab => [tab.title, tab.id])), tabCount = boot.workspace.tabs.length;
    const pane = name => page.locator(`[data-pane-id="${ids[name]}"]`);
    const editor = name => pane(name).locator('.manuscript');
    const ready = async name => waitFor(async () => await pane(name).getAttribute('data-active') === 'true' && !await page.locator('.workspace').evaluate(element => element.inert) && await editor(name).getAttribute('contenteditable') === 'true');
    const activate = async name => { await page.locator(`[data-project-tab="${ids[name]}"] [role=tab]`).click(); await ready(name); };
    const menu = async (name, command) => {
      await app.evaluate(() => { global.multitaskMenu = null; });
      await page.locator(`[data-project-tab="${ids[name]}"] [role=tab]`).click({ button: 'right' });
      await waitFor(() => app.evaluate(() => !!global.multitaskMenu));
      await app.evaluate(({ BrowserWindow }, command) => {
        const item = global.multitaskMenu.getMenuItemById(command);
        if (!item?.enabled) throw new Error(`Unavailable ${command}`);
        item.click(undefined, BrowserWindow.getAllWindows()[0], {});
      }, command);
    };
    await activate('Orchard');
    await menu('Harbour', 'tab-multitask-right'); await ready('Harbour');
    assert.deepEqual(await page.locator('[data-pane-id]').evaluateAll(elements => elements.map(element => element.dataset.paneId)), [ids.Orchard, ids.Harbour]);
    await editor('Orchard').evaluate(element => { window.orchardEditor = element.editor; });
    await editor('Harbour').evaluate(element => { window.harbourEditor = element.editor; });
    // Native wheel targeting is independent of the editor with keyboard focus.
    const scroll = name => pane(name).locator('.writing-scroll');
    const wheel = async (name, delta) => {
      const box = await scroll(name).boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, delta);
      await page.waitForTimeout(250);
    };
    const before = await scroll('Harbour').evaluate(element => element.scrollTop);
    await wheel('Orchard', 800);
    assert.ok(await scroll('Orchard').evaluate(element => element.scrollTop) > 300);
    assert.equal(await scroll('Harbour').evaluate(element => element.scrollTop), before);
    assert.equal(await pane('Harbour').getAttribute('data-active'), 'true', 'Hover scroll must not steal keyboard focus');
    // First click into an inactive editor activates it at the clicked passage.
    await editor('Orchard').locator('p').nth(8).click(); await ready('Orchard');
    assert.equal(await editor('Orchard').evaluate(element => element.editor === window.orchardEditor), true, 'Switching focus rebuilt Orchard');
    const started = Date.now(); await page.keyboard.type('MULTITASKEDIT'); timings.typingMs = Date.now() - started;
    assert.ok(timings.typingMs < 2500, `Typing took ${timings.typingMs} ms`);
    assert.match(await editor('Orchard').innerText(), /MULTITASKEDIT/);
    assert.doesNotMatch(await editor('Harbour').innerText(), /MULTITASKEDIT/);
    // Add a third panel to the left and retain both existing editor instances.
    await menu('Mountain', 'tab-multitask-left'); await ready('Mountain');
    assert.deepEqual(await page.locator('[data-pane-id]').evaluateAll(elements => elements.map(element => element.dataset.paneId)), [ids.Mountain, ids.Orchard, ids.Harbour]);
    assert.equal(await editor('Harbour').evaluate(element => element.editor === window.harbourEditor), true);
    const threeStart = Date.now(); await editor('Mountain').locator('p').first().click(); await page.keyboard.type('THREEPANELS'); timings.threePanelTypingMs = Date.now() - threeStart;
    assert.ok(timings.threePanelTypingMs < 2500);
    await page.keyboard.press('Control+z');
    await waitFor(async () => !(await editor('Mountain').innerText()).includes('THREEPANELS'));
    timings.frameP95Ms = await page.evaluate(async () => {
      const frames = []; let last = performance.now();
      for (let i = 0; i < 30; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); frames.push(now - last); last = now; }
      return frames.sort((a, b) => a - b)[28];
    });
    assert.ok(timings.frameP95Ms < 150, `Three-panel frame p95: ${timings.frameP95Ms} ms`);
    // Divider pointer, keyboard, minimum-width and balanced-pair behaviours.
    const divider = page.getByRole('separator', { name: 'Resize document panels 1 and 2', exact: true });
    const widths = () => page.locator('[data-pane-id]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
    const original = await widths(), box = await divider.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 70); await page.mouse.down();
    await page.mouse.move(box.x + 86, box.y + 70, { steps: 12 }); await page.mouse.up();
    let resized = await widths(); assert.ok(resized[0] > original[0] + 45); assert.ok(Math.abs(resized[2] - original[2]) < 3);
    await divider.focus(); await page.keyboard.press('Home'); resized = await widths(); assert.ok(Math.abs(resized[0] - 240) < 3);
    await page.keyboard.press('Enter'); resized = await widths(); assert.ok(Math.abs(resized[0] - resized[1]) < 3);
    // The preview shows the resulting layout; Escape makes no change.
    const source = page.locator(`[data-project-tab="${ids.Harbour}"]`);
    const sourceBox = await source.boundingBox(), dest = await pane('Mountain').boundingBox();
    await page.mouse.move(sourceBox.x + 35, sourceBox.y + 15); await page.mouse.down();
    await page.mouse.move(sourceBox.x + 45, sourceBox.y + 22, { steps: 3 });
    await page.mouse.move(dest.x + 25, dest.y + 170, { steps: 15 });
    await page.locator('.multitask-drop-field.left.selected').waitFor();
    assert.equal(await page.locator('.multitask-drop-field.selected').count(), 1);
    assert.equal(await page.locator('[data-preview-pane]').count(), 3);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.locator('.multitask-drop-preview').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-pane-id]').count(), 3);
    // A real tab drag moves its live panel without duplicating or destroying it.
    await source.dragTo(pane('Mountain'), { targetPosition: { x: 25, y: 160 } });
    await waitFor(async () => (await page.locator('[data-pane-id]').first().getAttribute('data-pane-id')) === ids.Harbour);
    assert.equal(await editor('Harbour').evaluate(element => element.editor === window.harbourEditor), true);
    // Dragging an inactive panel title must not activate/inert the workspace
    // before the native drag starts. It relocates the same mounted editor.
    const orchardBounds = await pane('Orchard').boundingBox();
    await pane('Harbour').locator('.multitask-pane-title').dragTo(pane('Orchard'), { targetPosition: { x: orchardBounds.width - 25, y: 160 } });
    await waitFor(async () => await page.locator('[data-pane-id]').last().getAttribute('data-pane-id') === ids.Harbour);
    assert.equal(await editor('Harbour').evaluate(element => element.editor === window.harbourEditor), true);
    await activate('Orchard');
    await waitFor(async () => JSON.parse(await fs.readFile(files[0], 'utf8')).chapters[0].content.content.some(p => JSON.stringify(p).includes('MULTITASKEDIT')));
    // Shared undo belongs to the active document only.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'undo'));
    await waitFor(async () => !(await editor('Orchard').innerText()).includes('MULTITASKEDIT'));
    assert.equal(await editor('Harbour').evaluate(element => element.editor === window.harbourEditor), true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'redo'));
    await waitFor(async () => (await editor('Orchard').innerText()).includes('MULTITASKEDIT'));
    // Narrow windows retain readable panels and expose horizontal overflow.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    await page.waitForTimeout(300);
    assert.ok((await widths()).every(width => width >= 239));
    await page.getByRole('button', { name: 'Toggle notes & voice', exact: true }).click();
    assert.equal(await page.locator('.multitask-workspace').evaluate(element => element.scrollWidth > element.clientWidth), true);
    await page.screenshot({ path: path.join(output, 'multitask-minimum.png') });
    await page.getByRole('button', { name: 'Close side panel', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(output, 'multitask-workspace.png') });
    await menu('Harbour', 'tab-multitask-remove'); await waitFor(async () => await pane('Harbour').count() === 0);
    assert.equal((await page.evaluate(() => window.wraiter.boot())).workspace.tabs.length, tabCount);
    // Selecting a hidden tab replaces only the active panel.
    await activate('Harbour'); assert.equal(await pane('Mountain').count(), 1); assert.equal(await pane('Orchard').count(), 0);
    await page.getByRole('button', { name: 'Remove Harbour from multitask', exact: true }).click(); await ready('Mountain');
    assert.equal(await page.locator('[data-pane-id]').count(), 1);
    await activate('Orchard'); assert.match(await editor('Orchard').innerText(), /MULTITASKEDIT/);
    // Each panel's chapter chooser addresses that document, including when it
    // is inactive; divided-page layout stays local while a divider moves.
    await menu('Mountain', 'tab-multitask-right'); await ready('Mountain');
    await page.getByRole('combobox', { name: 'Chapter in Orchard', exact: true }).selectOption('ending'); await ready('Orchard');
    await waitFor(async () => (await editor('Orchard').innerText()).includes('The Orchard ending stays separate.'));
    await page.getByRole('combobox', { name: 'Chapter in Mountain', exact: true }).selectOption('ending'); await ready('Mountain');
    await waitFor(async () => (await editor('Mountain').innerText()).includes('The Mountain ending stays separate.'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'page-view'));
    await waitFor(async () => await page.locator('.writing-sheet[data-page-count]').count() === 2);
    const pagedDivider = page.getByRole('separator', { name: 'Resize document panels 1 and 2', exact: true });
    const pagedBox = await pagedDivider.boundingBox(); await page.mouse.move(pagedBox.x + 4, pagedBox.y + 50); await page.mouse.down();
    await page.mouse.move(pagedBox.x + 60, pagedBox.y + 50, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300);
    assert.match(await editor('Orchard').innerText(), /The Orchard ending stays separate/);
    assert.match(await editor('Mountain').innerText(), /The Mountain ending stays separate/);
    assert.deepEqual(errors, []);
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, profile, documents: 3, paragraphsPerDocument: 1500, timings,
      checks: ['Native Multitask menu left/right/removal', 'Three retained editors with independent writing, undo and save', 'Hovered-panel wheel scrolling', 'Divider dragging, keyboard and minimum widths', 'Mouse drop previews, cancellation and tab/panel-title moves', '960 × 650 and 1600 × 1000 layouts', 'Hidden-tab replacement and collapse back to one panel', 'Inactive-panel chapter selection and divided-page resizing'] };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'multitask-packaged-results.json' : 'multitask-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'multitask-failure.png') }).catch(() => {}); throw error; }
  finally { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
