const { _electron } = require('playwright');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

async function until(check, failure) {
  for (const end = Date.now() + 15000; Date.now() < end;) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(failure);
}

(async () => {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'workspace-layout-'));
  const settings = path.join(profile, 'settings.json');
  await fs.writeFile(settings, JSON.stringify({ setupComplete: true, tutorialComplete: true, startup: 'restore', enabled: false, spellcheck: false, localGrammar: false }));
  const titles = ['Orchard', 'Harbour', 'Mountain', 'River'];
  const files = await Promise.all(titles.map(async title => {
    const filename = path.join(profile, title + '.wraiter');
    const chapters = ['opening', 'ending'].map(id => ({
      id, title: title + ' ' + id,
      content: { type: 'doc', content: Array.from({ length: 60 }, (_, index) => ({
        type: 'paragraph', content: [{ type: 'text', text: title + ' ' + id + ' paragraph ' + (index + 1) }],
      })) },
    }));
    await fs.writeFile(filename, JSON.stringify({ format: 'wraiter', version: 1, id: title, title, chapters }));
    return filename;
  }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.WRAITER_EXECUTABLE, previous = process.env.WRAITER_UPDATE_FROM;
  const errors = [];
  let app, page, ids;

  const boot = () => page.evaluate(() => window.wraiter.boot());
  const workspaceReady = () => page.locator('.workspace').evaluate(el => !el.inert);
  async function launch(binary = executable, args = []) {
    app = await _electron.launch({ ...(binary ? { executablePath: binary, args } : { args: [root, ...args] }), env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.locator('.manuscript').first().waitFor({ timeout: 30000 });
    await until(workspaceReady, 'Workspace did not become interactive');
    return app.evaluate(({ app }) => app.getVersion());
  }
  async function waitForFiles() {
    await until(async () => {
      const { workspace } = await boot();
      return titles.every(title => workspace.tabs.some(tab => tab.title === title)) && await workspaceReady();
    }, 'Documents did not open');
  }
  async function close() {
    const exited = once(app.process(), 'exit', { signal: AbortSignal.timeout(25000) });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {});
    const [code, signal] = await exited;
    assert.equal(signal, null); assert.equal(code, 0);
    app = null;
  }
  const pane = title => page.locator(`[data-pane-id="${ids[title]}"]`);
  const tab = title => page.locator(`[data-project-tab="${ids[title]}"]`).getByRole('tab');
  const button = name => page.getByRole('button', { name, exact: true });
  async function ready(title) {
    await pane(title).locator('.manuscript[contenteditable="true"]').waitFor();
    await until(workspaceReady, title + ' did not become interactive');
    assert.equal(await pane(title).getAttribute('data-active'), 'true');
  }
  async function place(title, side) {
    await app.evaluate(() => { global.layoutMenu = null; });
    await tab(title).click({ button: 'right' });
    await until(() => app.evaluate(() => Boolean(global.layoutMenu)), 'Tab menu did not open');
    await app.evaluate(({ BrowserWindow }, side) => {
      const item = global.layoutMenu.getMenuItemById('tab-multitask-' + side);
      if (!item?.enabled) throw new Error('Split command is not available');
      item.click(undefined, BrowserWindow.getAllWindows()[0], {});
    }, side);
    await ready(title);
  }
  const paneLayout = () => page.locator('[data-pane-id]').evaluateAll(elements => elements.map(element => ({
    id: element.dataset.paneId, size: Number(element.style.flexGrow), active: element.dataset.active,
  })));
  async function expectLayout(expected) {
    const actual = await paneLayout();
    assert.deepEqual(actual.map(({ id, active }) => ({ id, active })), expected.map(({ id, active }) => ({ id, active })));
    assert.ok(actual.every(({ size }, index) => Math.abs(size - expected[index].size) < 1e-6));
  }
  const currentWindow = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
  });

  try {
    const fromVersion = await launch(previous || executable, files);
    await waitForFiles();
    const initial = (await boot()).workspace;
    ids = Object.fromEntries(initial.tabs.map(tab => [tab.title, tab.id]));
    if (previous) {
      await close();
      assert.notEqual(await launch(), fromVersion, 'Update fixture must use a different version');
      assert.deepEqual((await boot()).workspace.tabs.map(tab => tab.id), initial.tabs.map(tab => tab.id));
      assert.equal((await boot()).workspace.activeId, initial.activeId);
    }
    const normal = await app.evaluate(({ BrowserWindow, Menu, screen }) => {
      const win = BrowserWindow.getAllWindows()[0], area = screen.getPrimaryDisplay().workArea;
      win.setBounds({ x: area.x + 12, y: area.y + 12, width: Math.min(1280, area.width - 12), height: Math.min(780, area.height - 12) });
      Menu.prototype.popup = function() { global.layoutMenu = this; };
      return win.getNormalBounds();
    });
    await tab('Orchard').click(); await ready('Orchard');
    await place('Harbour', 'right');
    await page.getByRole('combobox', { name: 'Chapter in Harbour' }).selectOption('ending');
    await pane('Harbour').locator('.manuscript').getByText('Harbour ending paragraph 1', { exact: true }).waitFor();
    await place('Mountain', 'left');
    await button('Toggle manuscript sidebar').click();
    await button('Toggle revision history').click();
    await page.getByRole('tab', { name: /^Checkpoints/ }).click();
    assert.deepEqual((await paneLayout()).map(pane => pane.id), [ids.Orchard, ids.Mountain, ids.Harbour]);
    const beforeResize = await paneLayout();
    const divider = page.getByRole('separator', { name: 'Resize document panels 1 and 2', exact: true });
    await divider.press('Enter');
    const sized = await paneLayout();
    assert.notEqual(sized[0].size, beforeResize[0].size, 'Divider change was not applied');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await until(async () => (await currentWindow()).maximized, 'Window did not maximize');
    const passive = () => pane('Harbour').locator('.writing-scroll');
    await passive().evaluate(el => { el.querySelector('.manuscript').editor.commands.setTextSelection({ from: 27, to: 34 }); el.scrollTop = 380; });
    assert.equal(await passive().evaluate(el => el.scrollTop), 380);
    await close();

    // Replacing a build must leave the layout file intact even if that build
    // only knows how to read and write the older open-project manifest.
    if (previous) {
      await launch(previous); await waitForFiles(); await close();
    }
    await launch(); await ready('Mountain');
    await expectLayout(sized);
    const restored = await currentWindow();
    assert.equal(restored.maximized, true); assert.deepEqual(restored.bounds, normal);
    assert.equal(await page.locator('.sidebar').count(), 0);
    assert.equal(await page.locator('.inspector-title').innerText(), 'Revision history');
    assert.equal(await page.getByRole('tab', { name: /^Checkpoints/ }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('combobox', { name: 'Chapter in Harbour' }).inputValue(), 'ending');
    await until(() => passive().evaluate(el => el.scrollTop === 380), 'Passive scroll did not restore');
    assert.deepEqual(await pane('Harbour').locator('.manuscript').evaluate(el => {
      const { from, to } = el.editor.state.selection; return [from, to];
    }), [27, 34]);
    assert.ok((await boot()).workspace.tabs.some(tab => tab.id === ids.River));
    assert.equal(await pane('River').count(), 0);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
    await until(async () => !(await currentWindow()).maximized, 'Window did not unmaximize');
    await button('Close side panel').click();
    await button('Toggle manuscript sidebar').click();
    await button('Remove Harbour from multitask').click();
    await button('Focus view').click();
    const reduced = await paneLayout();
    assert.equal(reduced.length, 2);
    await close();

    await launch(); await ready('Mountain');
    await expectLayout(reduced);
    assert.deepEqual(await currentWindow(), { bounds: normal, maximized: false });
    assert.ok(await page.locator('.app.focus-mode').count());
    await button('Focus view').click();
    assert.equal(await page.locator('.sidebar').count(), 1);
    assert.equal(await page.locator('.inspector').count(), 0);
    assert.ok((await boot()).workspace.tabs.some(tab => tab.id === ids.Harbour));
    await button('Toggle notes & voice').click();
    await page.evaluate(() => window.wraiter.settings({ startup: 'new' }));
    await close();

    await launch();
    assert.equal((await boot()).workspace.tabs.length, 1);
    assert.equal((await paneLayout()).length, 1);
    assert.equal(await page.locator('.inspector-title').innerText(), 'Notes & voice');
    assert.deepEqual(await currentWindow(), { bounds: normal, maximized: false });
    await close();
    assert.deepEqual(errors, []);
    console.log(`Workspace layout passed: ${previous ? fromVersion + ' profile upgrade, ' : ''}close and relaunch, resized Multitask panes and reading positions, sidebar choices, window bounds, and clean startup.`);
  } catch (error) {
    await page?.screenshot({ path: path.join(profile, 'failure.png'), timeout: 2000 }).catch(() => {});
    console.error('Test profile:', profile);
    throw error;
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
