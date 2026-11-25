const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const timeout = 45000;

async function fixture(profile, name) {
  const directory = path.join(profile, name);
  await fs.mkdir(directory);
  const file = path.join(directory, name + '.wraiter');
  const paragraphs = [name, 'They is ready. We is here.', 'I is tired. She is awake.', 'My freind arrived.'];
  await fs.writeFile(file, JSON.stringify({
    format: 'wraiter', version: 1, id: name, title: name, language: 'en-US',
    chapters: [{ id: 'opening', title: 'Opening', content: { type: 'doc', content:
      paragraphs.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } }]
  }));
  return file;
}

async function expectMarks(page, title, matchingCount, differentCount = 1, spelling = true) {
  // Wait for completed checks and visible decorations, including the other
  // correction for the identical word. A disabled checker cannot pass.
  await page.waitForFunction(({ title, matchingCount, differentCount, spelling }) => {
    const editor = document.querySelector('.manuscript[contenteditable="true"]');
    if (editor?.querySelector('p')?.textContent !== title) return false;
    const state = editor.editor.state;
    const status = state.plugins.find(p => p.key.startsWith('localGrammar$')).getState(state);
    if (status.status !== 'ready') return false;
    const marks = [...editor.querySelectorAll('.local-grammar-hint')].map(span =>
      status.hints.find(hint => hint.id === span.dataset.localGrammarId));
    return marks.filter(hint => hint?.original === 'is' && hint.replacement === 'are').length === matchingCount
      && marks.filter(hint => hint?.original === 'is' && hint.replacement === 'am').length === differentCount
      && [...editor.querySelectorAll('.local-spelling-hint')].some(span => span.textContent === 'freind') === spelling;
  }, { title, matchingCount, differentCount, spelling }, { timeout });
}

async function nativeCommand(app, ...labels) {
  await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    let menu = Menu.getApplicationMenu(), item;
    for (const label of labels) {
      item = menu.items.find(item => item.label.replaceAll('&', '') === label);
      if (!item?.enabled) throw new Error('Missing native command: ' + label);
      menu = item.submenu;
    }
    item.click(undefined, BrowserWindow.getAllWindows()[0], {});
  }, labels);
}

async function personalDictionary(app, page, viaSettings) {
  const label = viaSettings ? 'Spelling and grammar settings…' : 'Personal dictionary…';
  await nativeCommand(app, 'Tools', 'Spelling and grammar', label);
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (viaSettings) await settings.getByRole('button', { name: 'Personal dictionary…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Personal dictionary', exact: true });
  await dialog.waitFor({ timeout });
  const button = (name, options = {}) => dialog.getByRole('button', { name, ...options });
  const close = async () => {
    await button('Close dialog', { exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    if (viaSettings) {
      await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
    }
  };
  return { dialog, button, close };
}

async function run() {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'grammar-exception-'));
  const first = await fixture(profile, 'First manuscript'), second = await fixture(profile, 'Second manuscript');
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true,
    spellcheck: true, startup: 'new', pageMode: 'continuous'
  }));
  const env = { ...process.env, WRAITER_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const launch = async file => {
    app = await _electron.launch({ executablePath: process.env.WRAITER_EXECUTABLE || require('electron'),
      args: process.env.WRAITER_EXECUTABLE ? [file] : [root, file], env, timeout });
    const page = await app.firstWindow();
    page.setDefaultTimeout(timeout);
    return page;
  };
  const close = async () => {
    if (!app) return;
    try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {}
    await app.close();
    app = null;
  };
  try {
    let page = await launch(first);
    await expectMarks(page, 'First manuscript', 2);
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function () { global.exceptionTestMenu = this; };
    });
    await page.locator('.manuscript p').filter({ hasText: 'They is ready.' }).locator('.local-grammar-hint').first().click({ button: 'right' });
    let menu;
    for (let retries = 0; retries < 100 && !menu; retries++) {
      menu = await app.evaluate(() => global.exceptionTestMenu?.items.map(({ id, label, enabled }) => ({ id, label, enabled })));
      if (!menu) await new Promise(resolve => setTimeout(resolve, 40));
    }
    const action = menu?.find(item => item.id === 'add-grammar-exception');
    assert.ok(action?.enabled, 'Personal grammar exception action must be available');
    assert.match(action.label, /personal dictionary/i);
    await app.evaluate(({ BrowserWindow }) => {
      global.exceptionTestMenu.getMenuItemById('add-grammar-exception').click(undefined, BrowserWindow.getAllWindows()[0], {});
    });
    await expectMarks(page, 'First manuscript', 0);
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, second);
    await nativeCommand(app, 'File', 'Open…');
    await expectMarks(page, 'Second manuscript', 0);
    await close();
    page = await launch(second);
    await expectMarks(page, 'Second manuscript', 0);

    // A change to the replacement should invalidate only the old exception.
    let manager = await personalDictionary(app, page, false);
    await manager.dialog.getByRole('tab', { name: 'Grammar exceptions', exact: true }).click();
    await manager.button(/^Edit exception for /i).click();
    await manager.dialog.getByLabel('Suggested replacement', { exact: true }).fill('am');
    await manager.button('Save entry', { exact: true }).click();
    await manager.dialog.getByRole('tab', { name: 'Words', exact: true }).click();
    await manager.button('Add word', { exact: true }).click();
    await manager.dialog.getByLabel('Word', { exact: true }).fill('freind');
    await manager.button('Save entry', { exact: true }).click();
    await manager.button(/^Edit word freind/i).waitFor();
    const search = manager.dialog.getByRole('searchbox', { name: 'Search words' });
    await search.fill('unlisted');
    await manager.dialog.getByText('No matching entries.', { exact: true }).waitFor();
    assert.equal(await manager.dialog.getByRole('listitem').count(), 0);
    await search.fill('REIN');
    await manager.button(/^Edit word freind/i).waitFor();
    await manager.close();
    await expectMarks(page, 'Second manuscript', 2, 0, false);

    // Settings opens the same live dictionary. Its outer Cancel should not
    // roll back dictionary changes that have already been saved.
    manager = await personalDictionary(app, page, true);
    await manager.dialog.getByRole('tab', { name: 'Words', exact: true }).click();
    await manager.button(/^Edit word freind/i).click();
    await manager.dialog.getByLabel('Word', { exact: true }).fill('Glimmerfold');
    await manager.button('Save entry', { exact: true }).click();
    await manager.button(/^Delete word Glimmerfold/i).click();
    await manager.button(/^Delete word Glimmerfold/i).waitFor({ state: 'hidden' });
    await manager.dialog.getByRole('tab', { name: 'Grammar exceptions', exact: true }).click();
    await manager.button(/^Delete exception for /i).click();
    await manager.button(/^Delete exception for /i).waitFor({ state: 'hidden' });
    await manager.button('Add exception', { exact: true }).click();
    await manager.dialog.getByRole('combobox', { name: 'Suggestion type', exact: true }).selectOption('review');
    await manager.dialog.getByLabel('Flagged text', { exact: true }).fill('two echoes');
    await manager.dialog.getByLabel('Checker rule', { exact: true }).fill('repeated-imagery');
    await manager.dialog.getByLabel('Suggestion message', { exact: true }).fill('Review this phrase.');
    await manager.button('Save entry', { exact: true }).click();
    const review = manager.dialog.getByRole('listitem').filter({ hasText: 'two echoes' });
    await review.getByText(/Review this phrase\./).waitFor();
    await review.getByRole('button', { name: /^Delete exception for / }).click();
    await review.waitFor({ state: 'hidden' });
    await manager.button('Add exception', { exact: true }).click();
    await manager.dialog.getByRole('combobox', { name: /^Language/ }).selectOption('en');
    await manager.dialog.getByLabel('Flagged text', { exact: true }).fill('is');
    await manager.dialog.getByLabel('Suggested replacement', { exact: true }).fill('are');
    await manager.button('Save entry', { exact: true }).click();
    await manager.button(/^Edit exception for /i).waitFor();
    await manager.close();
    await expectMarks(page, 'Second manuscript', 0);
    manager = await personalDictionary(app, page, false);
    await manager.dialog.getByRole('tab', { name: 'Grammar exceptions', exact: true }).click();
    await manager.button(/^Delete exception for /i).click();
    await manager.button(/^Delete exception for /i).waitFor({ state: 'hidden' });
    await manager.close();
    await expectMarks(page, 'Second manuscript', 2);
    await close();
    page = await launch(first);
    await expectMarks(page, 'First manuscript', 2);
    console.log('PASS personal dictionary navigation, search and editing, grammar exceptions across documents and restarts, and spelling isolation');
  } finally { await close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
