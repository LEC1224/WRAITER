// Real desktop interactions on synthetic text, with an isolated profile and AI off.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (run, label) => { const until = Date.now() + 20000; while (Date.now() < until) { try { if (await run()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out: ' + label); };
const para = (text, marks = [], attrs = {}) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text, marks }] });
const all = node => [node, ...(node.content || []).flatMap(all)];
const words = node => all(node).filter(node => node.type === 'text').map(node => node.text).join('');
const texts = project => project.chapters.map(chapter => words(chapter.content));
const annotations = (node, id) => all(node).filter(node => node.marks?.some(mark => mark.type === 'commentAnchor' && mark.attrs.id === id)).map(node => node.text || '').join('');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'revision-tools-')), file = path.join(userData, 'Revision tools.wraiter'), errors = [], checks = [], layouts = [];
  const fixture = { format: 'wraiter', version: 1, id: 'revision-tools-fixture', title: 'Revision tools', language: 'en-US', chapters: [
    { id: 'opening', title: 'Opening', content: { type: 'doc', content: [
      para('River river rivers RIVER.'),
      para('Copy visual formatting.', [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '18pt', color: '#945bc9' } }, { type: 'highlight', attrs: { color: '#8bc7ff' } }], { textAlign: 'right', lineHeight: '2', spaceAfter: 14 }),
      para('Paste formatting safely.', [{ type: 'link', attrs: { href: 'https://example.com/revision' } }]),
      para('Comment passage here.', [{ type: 'bold' }])
    ] } },
    { id: 'ending', title: 'Ending', content: { type: 'doc', content: [para('river in the valley. A river returns.'), para('Across chapters comment target.')] } },
    { id: 'epilogue', title: 'Epilogue', content: { type: 'doc', content: [para('Riverside river and River.'), para('An untouched final sentence.')] } }
  ], references: [], notes: '', style: '', snapshots: [], comments: [] };
  await fs.writeFile(file, JSON.stringify(fixture));
  const otherFile = path.join(userData, 'Other revision tools.wraiter');
  await fs.writeFile(otherFile, JSON.stringify({ ...fixture, id: 'other-revision-tools-fixture', title: 'Other revision tools', documentStyle: { fontFamily: 'Arial', fontSize: 20, lineHeight: 2 }, chapters: [{ id: 'other-opening', title: 'Other opening', content: { type: 'doc', content: [para('stream stream two other matches.')] } }], comments: [] }));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, continuous: false, startup: 'restore', theme: 'dark', spellcheck: false, pageMode: 'continuous' }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env } : { args: [root, file], env };
  let application, page, editor;
  const saved = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  const command = name => application.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const launch = async () => {
    application = await _electron.launch({ ...launchOptions, timeout: 60000 }); page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 });
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).path === file && await page.getByRole('tablist', { name: 'Open projects', exact: true }).getByRole('tab', { name: 'Revision tools', exact: true }).getAttribute('aria-selected') === 'true' && !await page.locator('.workspace').evaluate(element => element.inert) && (await editor.innerText()).length > 0, 'synthetic manuscript opened and ready');
  };
  const close = async () => { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await application?.close().catch(() => {}); application = null; };
  const chapter = async (title, text) => { await page.locator('.chapter-select').filter({ hasText: title }).click(); await waitFor(async () => (await editor.innerText()).includes(text), title + ' chapter selected'); };
  const select = async target => {
    await editor.evaluate((element, target) => {
      element.focus(); const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.ghost-text,.ai-loading')) nodes.push(walker.currentNode);
      const start = nodes.map(node => node.textContent).join('').indexOf(target), end = start + target.length;
      if (start < 0) throw new Error('Missing selection: ' + target);
      const range = document.createRange(); let offset = 0, began = false;
      for (const node of nodes) { const length = node.textContent.length; if (!began && start < offset + length) { range.setStart(node, start - offset); began = true; } if (began && end <= offset + length) { range.setEnd(node, end - offset); break; } offset += length; }
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
    }, target);
    await page.waitForTimeout(100); assert.equal(await page.evaluate(() => window.getSelection().toString()), target);
  };
  const search = () => page.getByRole('region', { name: 'Manuscript search and replace', exact: true });
  const count = () => search().locator('.manuscript-search-results .manuscript-search-result').count();
  const expectCount = async value => waitFor(async () => await count() === value, 'search count ' + value);
  const panel = () => page.locator('.comments-panel');
  const card = id => panel().locator(`.comment-card[data-comment-id="${id}"]`);
  const addComment = async (passage, text) => {
    await select(passage); await page.locator('.writer-toolbar').getByRole('button', { name: 'Add comment', exact: true }).click();
    await panel().getByRole('textbox', { name: 'New comment text', exact: true }).fill(text);
    await panel().getByRole('button', { name: 'Add comment', exact: true }).click();
    await waitFor(async () => (await saved()).comments.some(comment => comment.text === text), 'comment saved: ' + text);
    return (await saved()).comments.find(comment => comment.text === text).id;
  };
  const waitTexts = async expected => waitFor(async () => JSON.stringify(texts(await saved())) === JSON.stringify(expected), 'complete manuscript text persisted');
  try {
    await launch(); await chapter('Opening', 'Comment passage here.');
    await command('find'); await search().waitFor(); await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('river'); await expectCount(9);
    assert.deepEqual(await search().locator('.manuscript-search-group h3').allTextContents(), ['Opening4', 'Ending2', 'Epilogue3']);
    await search().getByRole('button').filter({ hasText: 'valley' }).first().click();
    await waitFor(async () => (await editor.innerText()).includes('river in the valley.'), 'search navigates to inactive chapter');
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'river');
    await page.getByLabel('Whole words', { exact: true }).check(); await expectCount(7);
    await page.getByLabel('Match case', { exact: true }).check(); await expectCount(4);
    await page.getByLabel('Search scope', { exact: true }).selectOption('chapter'); await expectCount(2);
    await chapter('Epilogue', 'Riverside'); await expectCount(1);
    await page.getByLabel('Match case', { exact: true }).uncheck(); await expectCount(2);
    await page.getByLabel('Search scope', { exact: true }).selectOption('manuscript'); await expectCount(7);
    checks.push('Search lists all chapters, navigates inactive chapters, and applies manuscript/chapter scope, case and whole-word filters.');

    await chapter('Opening', 'Comment passage here.'); await page.getByLabel('Replacement text', { exact: true }).fill('stream');
    const beforePreview = texts(await saved()); await search().getByRole('button', { name: 'Preview replace all', exact: true }).click();
    await page.getByRole('region', { name: 'Replace all preview', exact: true }).waitFor(); assert.deepEqual(texts(await saved()), beforePreview);
    assert.equal(await page.locator('.search-replace-preview .manuscript-search-result').count(), 7);
    await select('Comment passage here.'); await page.keyboard.press('ArrowRight'); await page.keyboard.insertText('!');
    await waitFor(async () => words((await saved()).chapters[0].content).includes('Comment passage here.!'), 'edit during replacement preview saved');
    await page.getByRole('button', { name: 'Replace all 7', exact: true }).click();
    await waitFor(async () => (await page.getByRole('region', { name: 'Replace all preview', exact: true }).getByRole('alert').innerText()).includes('changed after this preview'), 'stale preview rejected');
    assert.ok(texts(await saved()).every(text => !text.includes('stream')));
    await page.getByRole('button', { name: 'Cancel preview', exact: true }).click(); await command('undo'); await waitTexts(beforePreview);
    await search().getByRole('button', { name: 'Preview replace all', exact: true }).click(); await page.getByRole('button', { name: 'Replace all 7', exact: true }).click();
    const replaced = texts(fixture).map(text => text.replace(/\briver\b/gi, 'stream')); await waitTexts(replaced);
    await command('undo'); await waitTexts(texts(fixture)); await command('redo'); await waitTexts(replaced);
    await page.getByLabel('Find text', { exact: true }).fill('stream'); await page.getByLabel('Replacement text', { exact: true }).fill('stream'); await expectCount(7);
    const beforeNoop = await saved(); await search().getByRole('button', { name: 'Preview replace all', exact: true }).click(); await page.getByRole('button', { name: 'Replace all 7', exact: true }).click();
    await waitFor(async () => (await page.locator('.toast').innerText()).includes('No changes needed'), 'same-text replacement reports no change');
    const afterNoop = await saved(); assert.deepEqual(afterNoop.chapters, beforeNoop.chapters); assert.equal(afterNoop.historySequence, beforeNoop.historySequence);
    await close(); await launch(); await waitTexts(replaced); await command('undo'); await waitTexts(texts(fixture)); await command('redo'); await waitTexts(replaced);
    checks.push('Preview leaves prose unchanged, stale previews reject edits, same-text replacement adds no undo event, and replace-all is a single durable undo/redo operation across application restarts.');

    if (await search().count()) await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await chapter('Opening', 'Comment passage here.');
    const firstId = await addComment('Comment passage here.', 'PRIVATE_REVISION_NOTE: check the passage.');
    await select('passage'); await page.keyboard.press('ArrowRight'); await page.keyboard.insertText(' adjusted');
    await waitFor(async () => annotations((await saved()).chapters[0].content, firstId) === 'Comment passage adjusted here.', 'comment follows typing inside its passage');
    await select('Comment passage adjusted here.'); await page.getByRole('button', { name: 'Clear formatting', exact: true }).click();
    await waitFor(async () => annotations((await saved()).chapters[0].content, firstId) === 'Comment passage adjusted here.' && !all((await saved()).chapters[0].content).some(node => node.text?.includes('Comment passage') && node.marks?.some(mark => mark.type === 'bold')), 'clear formatting preserves comment');
    await card(firstId).getByRole('button', { name: 'Edit', exact: true }).click(); await card(firstId).getByRole('textbox', { name: 'Edit comment text', exact: true }).fill('PRIVATE_REVISION_NOTE: edited detail.'); await card(firstId).getByRole('button', { name: 'Save comment', exact: true }).click();
    await waitFor(async () => (await saved()).comments.find(comment => comment.id === firstId).text.endsWith('edited detail.'), 'edited comment saved');
    await card(firstId).getByRole('button', { name: 'Resolve', exact: true }).click(); await waitFor(async () => (await saved()).comments[0].resolved, 'comment resolved');
    await page.getByLabel('Comment filter', { exact: true }).selectOption('resolved'); await card(firstId).waitFor();
    await card(firstId).getByRole('button', { name: 'Reopen', exact: true }).click(); await waitFor(async () => !(await saved()).comments[0].resolved, 'comment reopened'); await page.getByLabel('Comment filter', { exact: true }).selectOption('all');
    await chapter('Ending', 'Across chapters'); const secondId = await addComment('Across chapters comment target.', 'PRIVATE_OTHER_CHAPTER: verify ending.');
    await chapter('Epilogue', 'Riverside'); await card(firstId).locator('.comment-passage').click(); await waitFor(async () => (await editor.innerText()).includes('Comment passage adjusted here.'), 'comment navigation across chapters');
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'Comment passage adjusted here.');
    await card(secondId).locator('.comment-passage').click(); await waitFor(async () => (await editor.innerText()).includes('Across chapters comment target.'), 'second comment passage navigation');
    await editor.locator(`[data-comment-id="${secondId}"]`).click(); assert.equal(await card(secondId).getAttribute('class').then(value => value.includes('active')), true);
    await card(firstId).getByRole('button', { name: 'Delete', exact: true }).click(); await waitFor(async () => (await saved()).comments.length === 1, 'comment deleted');
    await command('undo'); await waitFor(async () => (await saved()).comments.length === 2 && annotations((await saved()).chapters[0].content, firstId).length > 0, 'delete comment undo restores body and passage');
    checks.push('Comment add/edit/resolve/reopen/delete are saved and undoable; anchors survive typing, clear formatting and cross-chapter passage navigation.');

    await chapter('Opening', 'Copy visual formatting.');
    const sourceId = await addComment('Copy visual formatting.', 'PRIVATE_SOURCE_COMMENT: retain at source.');
    const targetId = await addComment('Paste formatting safely.', 'PRIVATE_TARGET_COMMENT: retain at destination.');
    await select('Copy visual formatting.'); await page.getByRole('button', { name: 'Copy formatting', exact: true }).click();
    const beforeFormat = await saved(); await select('Paste formatting safely.'); await page.getByRole('button', { name: 'Paste formatting', exact: true }).click();
    await waitFor(async () => all((await saved()).chapters[0].content).some(node => node.text === 'Paste formatting safely.' && node.marks?.some(mark => mark.type === 'bold')), 'copied formatting applied');
    let afterFormat = await saved(); assert.deepEqual(texts(afterFormat), texts(beforeFormat)); assert.deepEqual(afterFormat.comments, beforeFormat.comments);
    const target = all(afterFormat.chapters[0].content).find(node => node.text === 'Paste formatting safely.');
    assert.ok(target.marks.some(mark => mark.type === 'link' && mark.attrs.href === 'https://example.com/revision'));
    assert.deepEqual(target.marks.filter(mark => mark.type === 'commentAnchor').map(mark => mark.attrs.id), [targetId]);
    assert.ok(target.marks.some(mark => mark.type === 'textStyle' && mark.attrs.fontFamily === 'Georgia' && mark.attrs.fontSize === '18pt'));
    assert.ok(target.marks.some(mark => mark.type === 'highlight' && mark.attrs.color === '#8bc7ff'));
    assert.equal(annotations(afterFormat.chapters[0].content, sourceId), 'Copy visual formatting.');
    await command('undo'); await waitFor(async () => { const target = all((await saved()).chapters[0].content).find(node => node.text === 'Paste formatting safely.'); return !target.marks.some(mark => mark.type === 'bold') && target.marks.some(mark => mark.type === 'commentAnchor' && mark.attrs.id === targetId); }, 'single formatting undo retains link and target comment');
    await command('redo'); await waitFor(async () => all((await saved()).chapters[0].content).some(node => node.text === 'Paste formatting safely.' && node.marks?.some(mark => mark.type === 'bold')), 'formatting redo');
    await select('Paste formatting safely.');
    const copied = await editor.evaluate(element => { const data = new DataTransfer(), event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }); element.dispatchEvent(event); return { html: data.getData('text/html'), text: data.getData('text/plain') }; });
    assert.equal(copied.text, 'Paste formatting safely.'); assert.ok(copied.html.includes('https://example.com/revision') && copied.html.includes('<strong>'));
    assert.ok(!copied.html.includes('data-comment-id') && !copied.html.includes(targetId) && !copied.html.includes('PRIVATE_'));
    checks.push('Format copy/paste preserves manuscript words, target links and comments, excludes source anchors, and undoes/redoes as one edit. Synthetic standard-copy events preserve rich text without exposing private IDs or modifying the system clipboard.');

    await command('find'); await search().waitFor(); await page.getByLabel('Find text', { exact: true }).fill('stream'); await expectCount(7);
    for (const [theme, label] of [['dark', 'Dark'], ['paper', 'Light']]) {
      await command('settings-appearance'); await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor(); await page.getByRole('button', { name: label, exact: true }).click(); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' });
      await waitFor(async () => !await page.locator('.workspace').evaluate(element => element.inert), 'settings transition completed');
      await page.waitForTimeout(200);
      if (await page.getByRole('button', { name: 'Dismiss notification', exact: true }).count()) await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
      await page.screenshot({ path: path.join(output, `revision-tools-${theme}.png`) });
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650)); await page.waitForTimeout(150);
      const geometry = await page.evaluate(() => {
        const selectors = ['.manuscript-search-panel', '.inspector', '.writer-toolbar', '.writing-scroll'];
        return { theme: document.documentElement.dataset.theme, width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, boxes: selectors.map(selector => { const element = document.querySelector(selector), box = element?.getBoundingClientRect(); return { selector, ...(box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height } : {}) }; }) };
      });
      assert.ok(geometry.documentWidth <= geometry.width, JSON.stringify(geometry));
      for (const box of geometry.boxes) assert.ok(box.width > 0 && box.height > 0 && box.left >= -1 && box.right <= geometry.width + 1 && box.top >= -1 && box.bottom <= geometry.height + 1, JSON.stringify(geometry));
      layouts.push(geometry); await page.screenshot({ path: path.join(output, `revision-tools-${theme}-minimum.png`) });
    }
    checks.push('Search and comments remain inside both the 1280 × 850 and minimum 960 × 650 windows in dark and light themes.');
    const final = await saved();
    await select('stream stream rivers stream.'); await page.getByRole('button', { name: 'Copy formatting', exact: true }).click();
    await panel().getByRole('textbox', { name: 'New comment text', exact: true }).fill('PRIVATE_UNSAVED_DRAFT: original project only.');
    await page.getByLabel('Replacement text', { exact: true }).fill('brook'); await search().getByRole('button', { name: 'Preview replace all', exact: true }).click();
    await application.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, otherFile); await command('open');
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).path === otherFile && (await editor.innerText()).includes('two other matches.'), 'second synthetic project opened');
    await command('find'); await search().waitFor(); await page.getByLabel('Find text', { exact: true }).fill('stream'); await expectCount(2);
    assert.equal(await page.getByRole('region', { name: 'Replace all preview', exact: true }).count(), 0, 'A replacement preview must stay in its originating project.');
    await page.locator('.sidebar').getByRole('button', { name: /^Comments/ }).click(); await panel().waitFor();
    assert.equal(await panel().getByRole('textbox', { name: 'New comment text', exact: true }).inputValue(), '');
    assert.equal(await panel().locator('.comment-card').count(), 0); assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE_'));
    assert.deepEqual(JSON.parse(await fs.readFile(otherFile, 'utf8')).comments, []);
    await select('stream stream two other matches.'); await page.getByRole('button', { name: 'Paste formatting', exact: true }).click();
    await waitFor(async () => {
      const other = JSON.parse(await fs.readFile(otherFile, 'utf8')), paragraph = other.chapters[0].content.content[0];
      return paragraph.attrs.lineHeight === 1.5 && paragraph.content.some(node => node.marks?.some(mark => mark.type === 'textStyle' && mark.attrs.fontFamily === 'Cambria' && mark.attrs.fontSize === '12pt'));
    }, 'implicit source font and spacing pasted across projects');
    const other = JSON.parse(await fs.readFile(otherFile, 'utf8'));
    assert.deepEqual(texts(other), ['stream stream two other matches.']); assert.deepEqual(other.comments, []);
    assert.ok(!all(other.chapters[0].content).some(node => node.marks?.some(mark => mark.type === 'commentAnchor')));
    assert.deepEqual(other.documentStyle, { fontFamily: 'Arial', fontSize: 20, lineHeight: 2 }, 'Formatting changes the selected paragraph without changing project defaults.');
    await page.getByRole('tablist', { name: 'Open projects', exact: true }).getByRole('tab', { name: 'Revision tools', exact: true }).click();
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).path === file, 'original synthetic project restored');
    assert.deepEqual((await saved()).comments, final.comments);
    checks.push('Switching projects resets unsaved private comment input and replacement preview; neither reaches the other project or its native file.');
    checks.push('Copying an unstyled passage captures its implicit Cambria 12pt and 1.5 spacing; pasting into an Arial 20pt / double-spaced project preserves its words and defaults without copying private IDs.');
    await close(); await launch(); await chapter('Opening', 'Paste formatting safely.');
    assert.deepEqual((await saved()).comments, final.comments); assert.equal((await saved()).comments.length, 4);
    assert.equal(annotations((await saved()).chapters[0].content, firstId), 'Comment passage adjusted here.');
    assert.equal(annotations((await saved()).chapters[0].content, targetId), 'Paste formatting safely.');
    assert.deepEqual(errors, []); checks.push('Comment bodies, states, typed anchors and painted linked text survive a full restart.');
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, checks, layouts, userData };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'revision-tools-packaged-results.json' : 'revision-tools-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'revision-tools-failure.png') }).catch(() => {}); console.error('Renderer errors:', errors); throw error; }
  finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
