// Geometry regressions using real native drags and disposable manuscripts.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const waitFor = async (check, label = 'Layout did not settle') => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(label);
};

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'multitask-layout-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, localGrammar: false, pageMode: 'continuous', theme: 'dark' }));
  const names = ['Orchard', 'Harbour', 'Mountain'];
  const files = await Promise.all(names.map(async name => {
    const file = path.join(profile, `${name}.wraiter`);
    await fs.writeFile(file, JSON.stringify({ format: 'wraiter', version: 1, id: `layout-${name}`, title: name,
      chapters: [{ id: 'opening', title: `${name} opening`, content: { type: 'doc', content: Array.from({ length: 80 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `${name} paragraph ${index + 1}. A synthetic manuscript for checking panel placement and independent scrolling.` }] })) } }] }));
    return file;
  }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const errors = [], issues = [], checks = [], comparisons = [];
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
      Menu.prototype.popup = function() { global.layoutTabMenu = this; };
    });
    const boot = await page.evaluate(() => window.wraiter.boot());
    await page.evaluate(() => {
      window.layoutDragEvents = []; window.layoutDragEnded = 0;
      for (const type of ['dragstart', 'dragend', 'drop', 'dragover', 'dragleave']) document.addEventListener(type, event => {
        window.layoutDragEvents.push({ type, x: event.clientX, y: event.clientY, types: [...event.dataTransfer.types], tab: event.target.closest?.('[data-project-tab]')?.dataset.projectTab, pane: event.target.closest?.('[data-pane-id]')?.dataset.paneId });
        if (type === 'dragend') window.layoutDragEnded++;
      }, true);
    });
    const ids = Object.fromEntries(boot.workspace.tabs.map(tab => [tab.title, tab.id]));
    const tab = name => page.locator(`[data-project-tab="${ids[name]}"]`);
    const pane = name => page.locator(`[data-pane-id="${ids[name]}"]`);
    const order = () => page.locator('[data-pane-id]').evaluateAll(elements => elements.map(element => element.dataset.paneId));
    const ready = name => waitFor(async () => await pane(name).getAttribute('data-active') === 'true' && !await page.locator('.workspace').evaluate(element => element.inert) && await pane(name).locator('.manuscript').getAttribute('contenteditable') === 'true');
    const activate = async name => { await tab(name).getByRole('tab').click(); await ready(name); };
    const menu = async (name, command) => {
      await app.evaluate(() => { global.layoutTabMenu = null; });
      await tab(name).getByRole('tab').click({ button: 'right' });
      await waitFor(() => app.evaluate(() => !!global.layoutTabMenu));
      await app.evaluate(({ BrowserWindow }, command) => {
        const item = global.layoutTabMenu.getMenuItemById(command);
        if (!item?.enabled) throw new Error(`Unavailable ${command}`);
        item.click(undefined, BrowserWindow.getAllWindows()[0], {});
      }, command);
    };
    const add = async (name, side) => { await menu(name, `tab-multitask-${side}`); await ready(name); };
    const remove = async name => {
      await page.getByRole('button', { name: `Remove ${name} from multitask`, exact: true }).click();
      await waitFor(async () => await pane(name).count() === 0 && !await page.locator('.workspace').evaluate(element => element.inert));
    };
    const coverage = async label => {
      const measured = await page.locator('.multitask-workspace').evaluate(host => {
        const strip = host.querySelector('.multitask-strip').getBoundingClientRect(), panels = [...host.querySelectorAll('[data-pane-id]')].map(element => element.getBoundingClientRect());
        return { gap: strip.right - panels.at(-1).right, start: panels[0].left - strip.left, strip: strip.width, viewport: host.clientWidth, widths: panels.map(panel => panel.width) };
      });
      if (Math.abs(measured.gap) > 1 || Math.abs(measured.start) > 1 || measured.strip < measured.viewport - 1) issues.push({ label, ...measured });
    };
    const geometry = locator => locator.evaluate(element => {
      const host = document.querySelector('.multitask-workspace'), hostBounds = host.getBoundingClientRect(), box = element.getBoundingClientRect();
      return { x: box.left - hostBounds.left + host.scrollLeft, width: box.width, height: box.height };
    });
    const snapshot = () => page.locator('[data-pane-id]').evaluateAll(elements => elements.map(element => ({ id: element.dataset.paneId, width: element.getBoundingClientRect().width, scroll: element.querySelector('.writing-scroll').scrollTop })));
    const startDrag = async (name, target, side, fromHeading = false) => {
      await pane(target).scrollIntoViewIfNeeded();
      const source = fromHeading ? pane(name).locator('.multitask-pane-title') : tab(name);
      const sourceBox = await source.boundingBox(), targetBox = await pane(target).boundingBox();
      await page.evaluate(intent => { window.layoutDragIntent = intent; }, { name, target, side, sourceBox, targetBox });
      const before = await snapshot();
      await page.locator('.manuscript').evaluateAll(elements => { window.layoutEditors = elements.map(element => element.editor); });
      await page.mouse.move(sourceBox.x + 30, sourceBox.y + 14); await page.mouse.down();
      await page.mouse.move(sourceBox.x + 42, sourceBox.y + 22, { steps: 3 });
      const x = targetBox.x + (side === 'left' ? 24 : targetBox.width - 24), y = targetBox.y + 150;
      await page.mouse.move(x, y, { steps: 14 });
      // Chromium may emit only dragenter at the last interpolated point.
      await page.mouse.move(x + 1, y + 1);
      const selected = page.locator(`.multitask-drop-field.${side}.selected`); await selected.waitFor();
      assert.deepEqual(await snapshot(), before, 'Showing a preview changed live editor widths or scroll positions');
      assert.equal(await page.locator('.manuscript').evaluateAll(elements => elements.every(element => window.layoutEditors.includes(element.editor))), true, 'Showing a preview rebuilt a live editor');
      return geometry(selected);
    };
    const drop = async (name, target, side, fromHeading = false, capture = false) => {
      const before = await order(), expected = before.filter(id => id !== ids[name]);
      expected.splice(expected.indexOf(ids[target]) + (side === 'right' ? 1 : 0), 0, ids[name]);
      const ended = await page.evaluate(() => window.layoutDragEnded);
      const preview = await startDrag(name, target, side, fromHeading);
      if (capture) await page.screenshot({ path: path.join(output, 'multitask-layout-preview.png') });
      await page.mouse.up();
      await waitFor(() => page.evaluate(ended => window.layoutDragEnded > ended, ended), 'Native drag did not finish');
      await page.locator('.multitask-drop-preview').waitFor({ state: 'hidden' });
      await waitFor(async () => JSON.stringify(await order()) === JSON.stringify(expected) && !await page.locator('.workspace').evaluate(element => element.inert));
      // Allow the active-panel reveal and the browser's flex layout to settle.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const actual = await geometry(pane(name));
      const comparison = { name, target, side, preview, actual };
      comparisons.push(comparison);
      if (Math.abs(preview.x - actual.x) > 1 || Math.abs(preview.width - actual.width) > 1) issues.push({ label: 'Drag preview differs from the resulting panel', ...comparison });
      if (before.includes(ids[name])) assert.equal(await page.locator('.manuscript').evaluateAll(elements => elements.every(element => window.layoutEditors.includes(element.editor))), true, 'Moving a pane rebuilt an editor');
      await coverage(`${name} dropped on ${side} of ${target}`);
    };

    await activate('Orchard'); await add('Harbour', 'right');
    // These are the two reported sequences. Collect both failures in old builds.
    await drop('Orchard', 'Harbour', 'right', false, true);
    await drop('Orchard', 'Harbour', 'left');
    await remove('Harbour'); await ready('Orchard'); await coverage('After removing the right-hand multitask');
    await add('Harbour', 'left'); await coverage('After reopening the multitask on the left');
    assert.deepEqual(issues, [], 'Reported Multitask geometry regressions');
    if (process.env.WRAITER_LAYOUT_REPRO_ONLY) return;
    checks.push('Both reported move-preview and right/remove/left sequences fill the workspace with matching preview geometry');

    for (const side of ['right', 'left', 'right', 'left']) {
      await remove('Harbour'); await ready('Orchard'); await coverage(`Single panel before reopening on ${side}`);
      await add('Harbour', side); await coverage(`Repeated reopening on ${side}`);
    }
    await drop('Harbour', 'Orchard', 'right', true);
    await drop('Orchard', 'Harbour', 'left');
    await activate('Harbour'); await add('Mountain', 'right');
    const divider = page.getByRole('separator', { name: 'Resize document panels 1 and 2', exact: true });
    const box = await divider.boundingBox();
    await page.mouse.move(box.x + 4, box.y + 80); await page.mouse.down();
    await page.mouse.move(box.x - 76, box.y + 80, { steps: 8 }); await page.mouse.up();
    const beforeRemoval = await snapshot();
    await remove('Mountain'); await coverage('Removing a pane after unequal resizing');
    const afterRemoval = await snapshot();
    assert.ok(Math.abs(beforeRemoval[0].width / beforeRemoval[1].width - afterRemoval[0].width / afterRemoval[1].width) < .01, 'Removal changed the surviving relative widths');
    // Adding a hidden document previews a split; moving a visible one previews a reorder.
    await drop('Mountain', 'Orchard', 'left'); await ready('Mountain');
    await drop('Mountain', 'Harbour', 'right', true);
    await drop('Orchard', 'Mountain', 'right');
    await drop('Harbour', 'Orchard', 'left');
    const beforeCancel = await order();
    await startDrag('Mountain', 'Harbour', 'left');
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.locator('.multitask-drop-preview').waitFor({ state: 'hidden' });
    assert.deepEqual(await order(), beforeCancel); await coverage('Cancelled drag');
    checks.push('Repeated removal/reopening, unequal widths, three-pane moves, hidden-tab insertion, heading drags and Escape cancellation');

    await page.getByRole('button', { name: 'Toggle notes & voice', exact: true }).click();
    await coverage('Sidebar opened');
    await drop('Harbour', 'Orchard', 'right');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    await page.waitForTimeout(200);
    await coverage('Minimum window with sidebar');
    await drop('Orchard', 'Harbour', 'left');
    assert.ok((await snapshot()).every(pane => pane.width >= 239));
    await remove('Mountain'); await coverage('Narrow workspace after removal');
    await drop('Mountain', 'Harbour', 'left'); await ready('Mountain');
    await coverage('Narrow workspace after adding another pane');
    await page.getByRole('button', { name: 'Close side panel', exact: true }).click(); await coverage('Sidebar closed');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
    await page.waitForTimeout(200); await coverage('Window expanded');
    // Closing an actual tab also redistributes its space, including the last split.
    await menu('Mountain', 'tab-close'); await waitFor(async () => await pane('Mountain').count() === 0);
    await coverage('Closing a document tab');
    await menu('Harbour', 'tab-close'); await ready('Orchard'); await coverage('Closing the last split document tab');
    assert.equal(await page.locator('[data-pane-id]').count(), 1);
    checks.push('Sidebar visibility, minimum-width overflow, window resizing and actual tab closure retain all available space');
    assert.deepEqual(issues, []); assert.deepEqual(errors, []);
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, profile, checks, comparisons };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'multitask-layout-packaged-results.json' : 'multitask-layout-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(await page?.evaluate(() => ({ intent: window.layoutDragIntent, dragEvents: window.layoutDragEvents.slice(-15), inert: document.querySelector('.workspace')?.inert, preview: document.querySelector('.multitask-drop-preview')?.outerHTML.slice(0, 500) })).catch(() => null));
    await page?.screenshot({ path: path.join(output, 'multitask-layout-failure.png') }).catch(() => {}); throw error;
  }
  finally { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
