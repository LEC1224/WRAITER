const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'offline-grammar-ui-'));
  const file = path.join(profile, 'Synthetic offline grammar.wraiter');
  const now = new Date().toISOString();
  const project = { format: 'wraiter', version: 1, id: 'offline-grammar', title: 'Offline sample', language: 'en-US', notes: '', style: '', references: [], snapshots: [],
    comments: [{ id: 'comment-1', chapterId: 'first', text: 'A comment', quote: 'freind', createdAt: now, updatedAt: now, resolved: false }],
    chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '🙂 She walk home. The dogs is tired. Their going to loose the ' }, { type: 'text', text: 'freind', marks: [{ type: 'italic' }, { type: 'commentAnchor', attrs: { id: 'comment-1' } }] }, { type: 'text', text: '.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'She had had enough. I know that that is true. What it is is a mystery.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Eldrak waited beside the river.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The dogs runs quickly. Its not safe.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The the cottage is quiet.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The the road is empty.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '🤝 I would like to ask for advise on this topic.' }] }
    ] } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true, spellcheck: true, startup: 'new' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env, timeout: 60000 } : { args: [root, file], env, timeout: 60000 });
  let app, page, editor; const errors = [];
  const close = async () => { if (!app) return; try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close(); app = null; };
  const connect = async () => {
    app = await launch(); page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow, Menu }) => {
      global.offlineRequests = [];
      BrowserWindow.getAllWindows()[0].webContents.session.webRequest.onBeforeRequest((details, callback) => {
        if (/^https?:/i.test(details.url)) { global.offlineRequests.push(details.url); callback({ cancel: true }); }
        else callback({});
      });
      global.localMenu = null; global.localMenuCount = 0;
      Menu.prototype.popup = function() { global.localMenu = this; global.localMenuCount++; };
    });
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
  };
  const command = value => app.evaluate(({ BrowserWindow }, sent) => BrowserWindow.getAllWindows()[0].webContents.send('command', sent), value);
  async function menuAt(locator) {
    const count = await app.evaluate(() => global.localMenuCount);
    await locator.click({ button: 'right' });
    for (let i = 0; i < 100; i++) {
      const items = await app.evaluate((_electron, count) => global.localMenuCount > count ? global.localMenu.items.map(({ id, label }) => ({ id, label })) : null, count);
      if (items) return items;
      await pause(40);
    }
    throw new Error('The local suggestion menu did not open.');
  }
  const choose = id => app.evaluate(({ BrowserWindow }, id) => {
    const item = global.localMenu.getMenuItemById(id); if (!item?.enabled) throw new Error('Missing native item: ' + id);
    item.click(undefined, BrowserWindow.getAllWindows()[0], {});
  }, id);
  try {
    await connect();
    const grammar = text => editor.locator('.local-grammar-hint').filter({ hasText: new RegExp(`^${text}$`) });
    const spelling = text => editor.locator('.local-spelling-hint').filter({ hasText: new RegExp(`^${text}$`) });
    await grammar('walk').waitFor({ timeout: 30000 }); await spelling('freind').waitFor({ timeout: 30000 }); await spelling('Eldrak').waitFor({ timeout: 30000 });
    await grammar('runs').waitFor({ timeout: 30000 }); await grammar('Its').waitFor({ timeout: 30000 });
    assert.equal(await grammar('is').count(), 1, 'The plural noun needs a plural verb');
    assert.equal(await grammar('Their').count(), 1); assert.equal(await grammar('loose').count(), 1);
    assert.equal(await editor.locator('.local-grammar-hint').filter({ hasText: /had had|that that|is is/ }).count(), 0);
    const menu = await menuAt(spelling('freind'));
    assert.match(menu.find(item => item.id === 'apply-local-hint-0').label, /freind → friend/);
    assert.ok(menu.some(item => item.id === 'add-local-word'));
    await choose('apply-local-hint-0');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent.includes('the friend.'));
    const corrected = await editor.evaluate(element => element.editor.getJSON().content[0].content.find(node => node.text === 'friend'));
    assert.ok(corrected.marks.some(mark => mark.type === 'italic'));
    assert.ok(corrected.marks.some(mark => mark.type === 'commentAnchor' && mark.attrs.id === 'comment-1'));
    await editor.press('Control+z'); await spelling('freind').waitFor({ timeout: 30000 });
    assert.ok((await editor.innerText()).includes('the freind.'), 'A local correction is undoable');
    await grammar('advise').waitFor({ timeout: 30000 });
    const wordChoice = await menuAt(grammar('advise'));
    assert.match(wordChoice.find(item => item.id === 'apply-local-hint-0').label, /advise → advice/);
    await choose('apply-local-hint-0');
    await editor.getByText('🤝 I would like to ask for advice on this topic.', { exact: true }).waitFor();
    await menuAt(spelling('Eldrak')); await choose('add-local-word');
    await page.waitForFunction(() => ![...document.querySelectorAll('.local-spelling-hint')].some(node => node.textContent === 'Eldrak'), null, { timeout: 30000 });
    assert.ok((await page.evaluate(() => window.wraiter.offlineDictionaryWords())).includes('Eldrak'));
    await spelling('freind').waitFor({ timeout: 30000 });
    assert.equal(await spelling('freind').count(), 1, 'Adding a name does not ignore unrelated words');
    // A dictionary change invalidates cached results. Let every engine finish
    // before checking that Ignore preserves another completed suggestion.
    await page.waitForFunction(() => {
      const state = document.querySelector('.manuscript[contenteditable="true"]')?.editor?.state;
      return state?.plugins.find(plugin => plugin.key.startsWith('localGrammar$'))?.getState(state).status === 'ready';
    }, null, { timeout: 30000 });
    await grammar('Its').waitFor({ timeout: 30000 });
    await menuAt(grammar('runs')); await choose('ignore-local-hint');
    await grammar('runs').waitFor({ state: 'hidden' }); assert.equal(await grammar('Its').count(), 1);
    assert.equal(await grammar('The the').count(), 2);
    await menuAt(grammar('The the').first()); await choose('ignore-local-matching');
    await page.waitForFunction(() => ![...document.querySelectorAll('.local-grammar-hint')].some(node => node.textContent === 'The the'));
    await command('settings-grammar');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('checkbox', { name: 'Local grammar hints while typing (English and Swedish)' }).uncheck();
    await settings.getByRole('button', { name: 'Save settings' }).click(); await settings.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('.local-grammar-hint'));
    assert.equal(await spelling('freind').count(), 1, 'Spelling and grammar settings are independent');
    await command('toggle-spellcheck'); await page.waitForFunction(() => !document.querySelector('.local-spelling-hint'));
    await command('local-grammar');
    const review = page.getByRole('dialog', { name: 'Local grammar review' }); await review.waitFor();
    await review.getByText('freind', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await editor.locator('.local-spelling-hint, .local-grammar-hint').count(), 0, 'Opening review does not turn live underlines back on');
    await page.keyboard.press('Escape'); await review.waitFor({ state: 'hidden' });
    assert.deepEqual(await app.evaluate(() => global.offlineRequests), [], 'The local checker must not request a network service');
    assert.deepEqual(errors, []);
    await close();
    // A fresh process and profile restore must retain a personally accepted name.
    await connect();
    assert.ok((await page.evaluate(() => window.wraiter.offlineDictionaryWords())).includes('Eldrak'));
    assert.deepEqual(await app.evaluate(() => global.offlineRequests), []);
    console.log('PASS bundled offline grammar and spelling, right-click fixes, formatting, undo, independent switches and persistent personal dictionary');
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
