// Verify packaged non-English dictionaries using native spelling context data.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 30000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) { try { if (await check()) return; } catch (error) { last = error; } await delay(250); }
  throw new Error(`${label}${last ? ': ' + last.message : ''}`);
}

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'offline-dictionaries-ui-'));
  const file = path.join(profile, 'Synthetic multilingual.wraiter');
  const project = { format: 'wraiter', version: 1, id: 'multilingual-dictionaries', title: 'Synthetic multilingual', language: 'pl-PL', chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'błendne błędne' }] }] } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: false, spellcheck: true, startup: 'new' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env } : { args: [root, file], env });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getAllWindows()[0]; global.dictionaryContext = null; global.dictionaryRequests = [];
      Menu.prototype.popup = function() {};
      window.webContents.on('context-menu', (_event, params) => { global.dictionaryContext = { word: params.misspelledWord, suggestions: params.dictionarySuggestions }; });
      window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        if (/^https?:/i.test(details.url)) { global.dictionaryRequests.push(details.url); callback({ cancel: true }); } else callback({});
      });
    });
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await waitFor(async () => await editor.getAttribute('lang') === 'pl-PL' && (await editor.innerText()).includes('błendne'), 'Polish manuscript did not open');
    const bundled = process.env.WRAITER_EXECUTABLE ? path.join(path.dirname(process.env.WRAITER_EXECUTABLE), 'resources', 'offline-grammar', 'dictionaries') : path.join(root, 'build', 'offline-grammar', 'payload', 'dictionaries');
    for (const name of ['pl-PL-3-0.bdic', 'sv-SE-3-0.bdic']) {
      const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
      assert.equal(digest(await fs.readFile(path.join(profile, 'Dictionaries', name))), digest(await fs.readFile(path.join(bundled, name))), `${name} is seeded exactly`);
    }
    async function context(word) {
      await app.evaluate(() => { global.dictionaryContext = null; });
      const point = await editor.evaluate((element, word) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let text;
        while ((text = walker.nextNode())) {
          const index = text.data.indexOf(word);
          if (index < 0) continue;
          const range = document.createRange(); range.setStart(text, index + 1); range.setEnd(text, index + 2);
          const rect = range.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        throw new Error('Word not found: ' + word);
      }, word);
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await waitFor(() => app.evaluate(() => global.dictionaryContext !== null), 'Native spelling context did not arrive', 5000);
      return app.evaluate(() => global.dictionaryContext);
    }
    await editor.click(); await page.keyboard.press('End'); await page.keyboard.type(' '); await page.keyboard.press('Backspace');
    await waitFor(async () => (await context('błendne')).word === 'błendne', 'Bundled Polish dictionary did not flag a misspelling');
    const polish = await context('błendne');
    assert.ok(polish.suggestions.some(word => word.toLowerCase() === 'błędne'), 'Polish correction should be offered');
    assert.equal((await context('błędne')).word, '', 'A correct Polish word should not be flagged');
    await page.getByRole('combobox', { name: 'Content language' }).selectOption('sv-SE');
    await waitFor(async () => await editor.getAttribute('lang') === 'sv-SE', 'Swedish document language did not activate');
    await editor.evaluate(element => { const current = element.editor, first = current.state.doc.firstChild; current.view.dispatch(current.state.tr.insertText('fjaeril fjäril', 1, first.nodeSize - 1)); });
    await editor.click(); await page.keyboard.press('End'); await page.keyboard.type(' '); await page.keyboard.press('Backspace');
    await waitFor(async () => (await context('fjaeril')).word === 'fjaeril', 'Bundled Swedish dictionary did not flag a misspelling');
    assert.ok((await context('fjaeril')).suggestions.some(word => word.toLowerCase() === 'fjäril'), 'Swedish correction should be offered');
    assert.equal((await context('fjäril')).word, '', 'A correct Swedish word should not be flagged');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'settings-grammar'));
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('checkbox', { name: 'Local grammar hints while typing (English and Swedish)' }).check();
    await settings.getByRole('button', { name: 'Save settings' }).click(); await settings.waitFor({ state: 'hidden' });
    await editor.evaluate(element => { const current = element.editor, first = current.state.doc.firstChild; current.view.dispatch(current.state.tr.insertText('🙂 Det var ett mörk kväll.', 1, first.nodeSize - 1)); });
    await editor.locator('.local-grammar-hint').filter({ hasText: 'ett mörk kväll' }).waitFor({ timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'local-grammar'));
    const review = page.getByRole('dialog', { name: 'Local grammar review' }); await review.waitFor();
    await review.getByText('ett mörk kväll', { exact: true }).waitFor();
    await review.getByRole('button', { name: 'Apply suggestion', exact: true }).first().click();
    await waitFor(async () => (await editor.innerText()).includes('🙂 Det var en mörk kväll.'), 'Swedish correction did not preserve the accented text and emoji');
    await page.keyboard.press('Escape'); await review.waitFor({ state: 'hidden' });
    await editor.press('Control+z');
    await waitFor(async () => (await editor.innerText()).includes('🙂 Det var ett mörk kväll.'), 'Swedish correction was not undoable');
    await page.getByRole('combobox', { name: 'Content language' }).selectOption('en-US');
    await waitFor(async () => await editor.getAttribute('lang') === 'en-US', 'English document language did not activate');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.isSpellCheckerEnabled()), true, 'Native English spelling remains available in other text fields');
    await editor.evaluate(element => { const current = element.editor, first = current.state.doc.firstChild; current.view.dispatch(current.state.tr.insertText('The dogs runs quickly.', 1, first.nodeSize - 1)); });
    await editor.locator('.local-grammar-hint').filter({ hasText: /^runs$/ }).waitFor({ timeout: 30000 });
    await page.getByRole('combobox', { name: 'Content language' }).selectOption('sv-SE');
    await waitFor(async () => await editor.getAttribute('lang') === 'sv-SE', 'Swedish document language did not reactivate');
    await editor.evaluate(element => { const current = element.editor, first = current.state.doc.firstChild; current.view.dispatch(current.state.tr.insertText('Det var ett mörk kväll.', 1, first.nodeSize - 1)); });
    await editor.locator('.local-grammar-hint').filter({ hasText: 'ett mörk kväll' }).waitFor({ timeout: 30000 });
    assert.equal(await editor.locator('.local-grammar-hint').filter({ hasText: /^runs$/ }).count(), 0, 'Hints from another language must not survive switching');
    assert.deepEqual(await app.evaluate(() => global.dictionaryRequests), []);
    assert.deepEqual(errors, []);
    console.log('PASS offline Polish and Swedish dictionaries, Swedish grammar, exact Unicode correction and undo');
  } finally { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
