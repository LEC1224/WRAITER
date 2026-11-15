const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-output');
const rename = 'chapter-rename', duplicate = 'chapter-duplicate', remove = 'chapter-delete';

async function waitFor(check, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw new Error('Timed out: ' + description);
}

(async () => {
  const { addComment } = await import('../src/comments.js');
  const { addBookmark } = await import('../src/bookmarks.js');
  const paragraph = (text, marks = []) => ({ type: 'paragraph', content: [{ type: 'text', text, marks }] });
  const chapter = (id, title, text, status = 'Draft') => ({
    id, title, status, content: { type: 'doc', content: [paragraph(text, id === 'crossing' ? [{ type: 'bold' }] : [])] }
  });
  let manuscript = {
    format: 'wraiter', version: 1, id: 'chapter-actions-fixture', title: 'Chapter actions test',
    chapters: [
      chapter('opening', 'Opening', 'A quiet beginning.'),
      chapter('crossing', 'Crossing', 'The river ran deep.', 'Final'),
      chapter('arrival', 'Arrival', 'The road climbed north.')
    ]
  };
  manuscript = addComment(manuscript, { chapterId: 'crossing', from: 1, to: 10, text: 'Check the timing.' }).project;
  manuscript = addBookmark(manuscript, { chapterId: 'crossing', from: 11, to: 15 }, 'River scene').project;
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'chapter-actions-'));
  const file = path.join(userData, 'Chapter test.wraiter');
  await fs.writeFile(file, JSON.stringify(manuscript));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({
    setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, theme: 'dark'
  }));

  const executablePath = process.env.WRAITER_EXECUTABLE;
  const env = { ...process.env, WRAITER_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ ...(executablePath ? { executablePath, args: [file] } : { args: [root, file] }), env, timeout: 60000 });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const boot = () => page.evaluate(() => window.wraiter.boot());
  const saved = async () => (await boot()).project;
  const activeTitle = () => page.locator('.chapter-title').inputValue();
  const row = id => page.locator('.chapter-select[data-chapter-id="' + id + '"]');
  const label = id => row(id).locator('[data-chapter-title]');
  const field = page.locator('.outline-rename');
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const popup = async open => {
    await app.evaluate(() => { global.chapterMenu = null; });
    await open();
    await waitFor(() => app.evaluate(() => !!global.chapterMenu), 'native menu');
    return app.evaluate(() => global.chapterMenu.items.map(item => ({ id: item.id, role: item.role, enabled: item.enabled, label: item.label })));
  };
  const menuClick = id => app.evaluate(({ BrowserWindow }, id) => {
    const item = global.chapterMenu.getMenuItemById(id);
    if (!item?.enabled) throw new Error('Unavailable menu command: ' + id);
    item.click(undefined, BrowserWindow.getAllWindows()[0], {});
  }, id);
  try {
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
    await waitFor(async () => (await boot()).path === file && (await activeTitle()) === 'Opening', 'opened fixture');
    await app.evaluate(({ Menu }) => { Menu.prototype.popup = function() { global.chapterMenu = this; }; });

    const menu = await popup(() => row('crossing').locator('small').click({ button: 'right' }));
    assert.deepEqual(menu.filter(item => item.id).map(item => [item.label, item.enabled]), [['Rename', true], ['Duplicate', true], ['Delete…', true]]);
    assert.equal((await activeTitle()), 'Opening');
    await menuClick(rename);
    await field.waitFor();
    assert.deepEqual(await field.evaluate(input => [input.value, input.selectionStart, input.selectionEnd, document.activeElement === input]), ['Crossing', 0, 8, true]);
    await page.screenshot({ path: path.join(userData, 'rename.png') });
    const inputMenu = await popup(() => field.click({ button: 'right' }));
    assert.ok(inputMenu.some(item => item.role === 'paste'), 'the rename field retains the text-edit menu');
    await field.fill('Crossing at dusk');
    await field.press('Enter');
    await waitFor(async () => (await saved()).chapters[1].title === 'Crossing at dusk', 'background chapter renamed');
    assert.equal((await activeTitle()), 'Opening');
    await command('undo');
    await waitFor(async () => (await saved()).chapters[1].title === 'Crossing', 'one undo restores the title');
    assert.equal((await activeTitle()), 'Opening');
    await command('redo');
    await waitFor(async () => (await saved()).chapters[1].title === 'Crossing at dusk', 'rename redo');

    await label('arrival').dblclick();
    assert.equal(await activeTitle(), 'Arrival');
    assert.equal(await field.count(), 0, 'a fast double-click must not rename');
    await label('opening').click();
    await page.waitForTimeout(650);
    await row('opening').locator('small').click();
    assert.equal(await field.count(), 0, 'the word count is not a title click');
    await label('arrival').click();
    assert.equal(await activeTitle(), 'Arrival');
    assert.equal(await field.count(), 0, 'a first title click only selects');
    await page.waitForTimeout(650);
    await label('arrival').click();
    await field.waitFor();
    assert.equal(await field.inputValue(), 'Arrival');
    await field.fill('Cancelled title');
    await field.press('Escape');
    await field.waitFor({ state: 'hidden' });
    assert.equal(await label('arrival').innerText(), 'Arrival');
    assert.equal(await row('arrival').evaluate(button => document.activeElement === button), true);
    await row('arrival').press('F2');
    await field.fill('Final arrival');
    await field.press('Enter');
    await waitFor(async () => (await saved()).chapters[2].title === 'Final arrival', 'F2 rename');
    const touch = await page.context().newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const bounds = await label('opening').boundingBox();
    async function tapTitle() {
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await tapTitle();
    assert.equal(await activeTitle(), 'Opening');
    await page.waitForTimeout(650);
    await tapTitle();
    await field.waitFor();
    assert.equal(await field.inputValue(), 'Opening');
    await field.press('Escape');
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await touch.detach();
    await row('arrival').click();

    const keyboardMenu = await popup(() => row('opening').press('Shift+F10'));
    assert.ok(keyboardMenu.some(item => item.id === duplicate && item.enabled));

    const beforeCopy = await saved();
    await popup(() => label('crossing').click({ button: 'right' }));
    await menuClick(duplicate);
    await waitFor(async () => (await saved()).chapters.length === 4, 'duplicate saved');
    const afterCopy = await saved(), copy = afterCopy.chapters[2];
    assert.deepEqual(afterCopy.chapters.map(item => item.title), ['Opening', 'Crossing at dusk', 'Crossing at dusk (copy)', 'Final arrival']);
    assert.notEqual(copy.id, 'crossing');
    assert.equal(copy.status, 'Final');
    assert.equal(copy.content.content[0].content.map(node => node.text).join(''), 'The river ran deep.');
    assert.ok(copy.content.content[0].content.every(node => node.marks.some(mark => mark.type === 'bold')));
    assert.doesNotMatch(JSON.stringify(copy.content), /commentAnchor/);
    assert.deepEqual(afterCopy.chapters[1], beforeCopy.chapters[1]);
    assert.deepEqual(afterCopy.comments, beforeCopy.comments);
    assert.deepEqual(afterCopy.bookmarks, beforeCopy.bookmarks);
    assert.equal(await activeTitle(), 'Final arrival');
    await page.reload();
    await row(copy.id).waitFor();
    await command('undo');
    await waitFor(async () => (await saved()).chapters.length === 3, 'undo duplicate after reopening');
    assert.equal(await activeTitle(), 'Final arrival');
    await command('redo');
    await waitFor(async () => (await saved()).chapters[2].id === copy.id, 'redo restores the same duplicate');

    const dialog = page.getByRole('dialog');
    async function deleteFromRow(id, title, confirm) {
      await popup(() => row(id).click({ button: 'right' }));
      await menuClick(remove);
      await dialog.getByRole('heading', { name: 'Delete “' + title + '”?' }).waitFor();
      await dialog.getByRole('button', { name: confirm ? 'Delete chapter' : 'Keep chapter', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
    await deleteFromRow(copy.id, 'Crossing at dusk (copy)', false);
    assert.equal(await row(copy.id).count(), 1);
    await deleteFromRow(copy.id, 'Crossing at dusk (copy)', true);
    await waitFor(async () => (await saved()).chapters.length === 3, 'inactive chapter deleted');
    assert.equal(await activeTitle(), 'Final arrival');
    assert.ok((await saved()).snapshots[0].chapters.some(chapter => chapter.id === copy.id));
    await command('undo');
    await waitFor(async () => (await saved()).chapters.some(chapter => chapter.id === copy.id), 'deleted chapter restored');
    assert.equal(await activeTitle(), 'Final arrival');
    await command('redo');
    await waitFor(async () => (await saved()).chapters.length === 3, 'redo delete');

    await deleteFromRow('arrival', 'Final arrival', true);
    await waitFor(async () => (await activeTitle()) === 'Crossing at dusk', 'deletion selects the adjacent chapter');
    await page.getByRole('button', { name: 'Delete chapter', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Delete “Crossing at dusk”?' }).waitFor();
    await dialog.getByRole('button', { name: 'Delete chapter', exact: true }).click();
    await waitFor(async () => (await saved()).chapters.length === 1, 'toolbar deletes active chapter');
    const last = await popup(() => row('opening').click({ button: 'right' }));
    assert.equal(last.find(item => item.id === remove).enabled, false);
    assert.equal(last.find(item => item.id === duplicate).enabled, true);

    // A stale native menu cannot apply to a document opened after it.
    const sourceTab = (await boot()).workspace.activeId;
    await page.getByRole('button', { name: 'New project tab', exact: true }).click();
    await waitFor(async () => (await boot()).workspace.activeId !== sourceTab && !(await page.locator('.workspace').evaluate(element => element.inert)), 'switched tab');
    await menuClick(duplicate);
    await page.getByText('The chapter is no longer available.', { exact: true }).waitFor();
    assert.equal(await page.locator('.chapter-select').count(), 1);
    assert.equal((await saved()).chapters.length, 1);
    assert.deepEqual(errors, []);
    console.log('Chapter menu, slow rename, keyboard access, duplicate, deletion, durable undo/redo, and stale targets passed (' + (executablePath ? 'packaged' : 'source') + ').');
  } catch (error) {
    await page.screenshot({ path: path.join(userData, 'failure.png') }).catch(() => {});
    console.error('Isolated profile:', userData, '\nRenderer errors:', errors);
    throw error;
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
