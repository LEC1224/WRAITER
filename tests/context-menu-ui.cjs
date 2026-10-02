// Actual native context-menu gestures and callbacks; only local synthetic AI.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (fn, label) => { const until = Date.now() + 20000; while (Date.now() < until) { try { if (await fn()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 80)); } throw new Error('Timed out: ' + label); };
const all = node => [node, ...(node.content || []).flatMap(all)];
const para = (text, marks = [], attrs = {}) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text, marks }] });
const words = node => all(node).filter(node => node.type === 'text').map(node => node.text).join('');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'context-menu-')), file = path.join(userData, 'Context menu.wraiter'), requests = [], errors = [], checks = [];
  const fixture = { format: 'wraiter', version: 1, id: 'context-menu-fixture', title: 'Context menu', language: 'en-US', chapters: [{ id: 'one', title: 'Opening', content: { type: 'doc', content: [
    para('Copy format source.', [{ type: 'bold' }, { type: 'italic' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '18pt' } }, { type: 'highlight', attrs: { color: '#8bc7ff' } }], { textAlign: 'right', lineHeight: '2' }),
    para('Target words remain.', [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'commentAnchor', attrs: { id: 'target-note' } }]),
    para('Continue anchor here.'), para('Untouched final words.')
  ] } }], comments: [{ id: 'target-note', chapterId: 'one', text: 'PRIVATE_CONTEXT_NOTE never sent.', quote: 'Target words remain.', resolved: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }] };
  await fs.writeFile(file, JSON.stringify(fixture));
  let delay = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'context-model' }] }));
    let text = ''; for await (const chunk of req) text += chunk; const body = JSON.parse(text); requests.push(body);
    const content = body.model === 'mock-rewrite' ? JSON.stringify({ alternatives: [{ text: 'wording', rating: 3 }, { text: 'phrasing', rating: 2 }, { text: 'expression', rating: 1 }] }) : body.model === 'mock-continue' ? 'and continued calmly.' : 'Target wording stays.';
    const pause = delay; await new Promise(resolve => setTimeout(resolve, pause)); if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, continuous: false, theme: 'dark', spellcheck: false, startup: 'restore', taskProfiles: Object.fromEntries(['continue', 'correct', 'rewrite', 'chat'].map(task => [task, { provider: 'compatible', baseUrl, model: 'mock-' + task }])) }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, editor;
  const launch = async () => {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env, timeout: 60000 } : { args: [root, file], env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 });
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).path === file && !await page.locator('.workspace').evaluate(element => element.inert) && (await editor.innerText()).includes('Target'), 'fixture ready');
    await app.evaluate(({ Menu }) => {
      global.contextMenus = []; const popup = Menu.prototype.popup;
      Menu.prototype.popup = function(options) {
        global.contextMenus.push(this);
        // Exercise one real native popup and its close lifecycle, then keep later
        // menus accessible for deterministic callback assertions in this process.
        if (global.contextMenus.length === 1) { this.once('menu-will-show', () => { global.nativeContextShown = true; }); setTimeout(() => this.closePopup(options.window), 100); popup.call(this, options); }
      };
    });
  };
  const close = async () => { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); app = null; };
  const saved = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const select = async target => {
    await editor.evaluate((element, target) => {
      element.focus(); const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.ghost-text,.ai-loading')) nodes.push(walker.currentNode);
      const start = nodes.map(node => node.textContent).join('').indexOf(target); if (start < 0) throw new Error('Missing selection: ' + target);
      const end = start + target.length, range = document.createRange(); let offset = 0, began = false;
      for (const node of nodes) { if (!began && start < offset + node.length) { range.setStart(node, start - offset); began = true; } if (began && end <= offset + node.length) { range.setEnd(node, end - offset); break; } offset += node.length; }
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, target);
    await page.waitForTimeout(100); assert.equal(await page.evaluate(() => window.getSelection().toString()), target);
  };
  const menuCount = () => app.evaluate(() => global.contextMenus.length);
  const menuInfo = (index = -1) => app.evaluate((_electron, index) => global.contextMenus.at(index).items.map(item => ({ id: item.id, label: item.label, enabled: item.enabled, role: item.role, checked: item.checked })), index);
  const click = (id, index = -1) => app.evaluate(({ BrowserWindow }, { id, index }) => { const item = global.contextMenus.at(index).getMenuItemById(id); if (!item || !item.enabled) throw new Error('Unavailable menu action: ' + id); item.click(undefined, BrowserWindow.getAllWindows()[0], {}); }, { id, index });
  const openSelection = async () => {
    const before = await menuCount();
    const point = await page.evaluate(() => { const selection = window.getSelection(), range = selection.getRangeAt(0); const box = [...range.getClientRects()].find(box => box.height > 0) || range.getBoundingClientRect(); return { x: box.left + Math.max(1, Math.min(box.width / 2, 30)), y: box.top + box.height / 2 }; });
    await page.mouse.click(point.x, point.y, { button: 'right' }); await waitFor(async () => await menuCount() > before, 'native menu opened'); return menuInfo();
  };
  const openText = async text => { await select(text); return openSelection(); };
  const expectTargetMark = async type => waitFor(async () => (await saved()).chapters[0].content.content[1].content[0].marks?.some(mark => mark.type === type), type + ' saved');
  try {
    await launch(); const first = await openText('Copy format source.');
    assert.equal(first.find(item => item.id === 'copy-format').enabled, true); assert.equal(first.find(item => item.id === 'paste-format').enabled, false);
    assert.equal(first.find(item => item.id === 'rewrite').enabled, false); assert.equal(first.find(item => item.id === 'toggle-ai').checked, false);
    await waitFor(async () => await app.evaluate(() => global.nativeContextShown), 'real native popup shown'); await page.waitForTimeout(150);
    await click('copy-format'); await page.getByText('Formatting copied.', { exact: false }).waitFor();
    const targetMenu = await openText('Target words remain.'); assert.equal(targetMenu.find(item => item.id === 'paste-format').enabled, true);
    assert.equal(await page.locator('.comments-panel').count(), 0, 'Right-clicking an anchor must not open the comments panel.');
    await click('paste-format'); await expectTargetMark('bold');
    let target = (await saved()).chapters[0].content.content[1];
    assert.equal(words(target), 'Target words remain.'); assert.equal(target.attrs.lineHeight, '2');
    assert.ok(target.content[0].marks.some(mark => mark.type === 'link')); assert.ok(target.content[0].marks.some(mark => mark.type === 'commentAnchor' && mark.attrs.id === 'target-note'));
    await openText('Target words remain.'); await click('undo'); await waitFor(async () => !(await saved()).chapters[0].content.content[1].content[0].marks.some(mark => mark.type === 'bold'), 'menu undo');
    await openText('Target words remain.'); await click('redo'); await expectTargetMark('bold');
    await openText('Target words remain.'); await click('clear-format'); await waitFor(async () => !(await saved()).chapters[0].content.content[1].content[0].marks.some(mark => mark.type === 'bold'), 'menu clear');
    assert.ok((await saved()).chapters[0].content.content[1].content[0].marks.some(mark => mark.type === 'commentAnchor'));
    checks.push('Real editor right-click preserves selected text; native copy/paste formatting, clear formatting and persistent undo/redo preserve words and private anchors.');

    await openText('Target words remain.'); await click('add-comment');
    const note = page.getByRole('textbox', { name: 'New comment text', exact: true }); await note.waitFor(); await waitFor(async () => await note.evaluate(element => element === document.activeElement), 'comment composer focused');
    await note.fill('Another PRIVATE_CONTEXT_NOTE.'); await page.locator('.comments-panel').getByRole('button', { name: 'Add comment', exact: true }).click();
    await waitFor(async () => (await saved()).comments.length === 2, 'comment added');
    const beforeField = await menuCount(); await note.fill('Private unsaved note input.'); await note.click({ button: 'right' }); await waitFor(async () => await menuCount() > beforeField, 'input menu');
    const field = await menuInfo(); assert.ok(field.some(item => item.role === 'undo')); assert.ok(!field.some(item => item.id === 'paste-format' || item.id === 'correct' || item.id === 'undo'));
    checks.push('Add comment focuses its composer with the original passage retained; private note fields receive only their own standard native editing menu.');

    await openText('Target words remain.'); await click('context-assistant'); const composer = page.getByRole('textbox', { name: 'Ask the writing assistant', exact: true });
    await composer.waitFor(); await waitFor(async () => await composer.evaluate(element => element === document.activeElement), 'assistant composer focused'); assert.equal(requests.length, 0);
    await openText('Target words remain.'); await click('toggle-ai'); await page.getByRole('button', { name: 'AI on', exact: true }).waitFor();
    delay = 1000; await openText('Target words remain.'); await click('correct'); await waitFor(async () => requests.some(request => request.model === 'mock-correct'), 'correction sent');
    const pending = await openText('Target words remain.'); assert.equal(pending.find(item => item.id === 'stop-ai').enabled, true); assert.equal(pending.find(item => item.id === 'paste-format').enabled, false);
    await click('stop-ai'); await page.locator('.ai-loading').waitFor({ state: 'hidden' }); assert.ok(!(await editor.innerText()).includes('Target wording stays.'));
    delay = 0; await openText('Target words remain.'); await click('correct'); await page.locator('.revision-preview').waitFor();
    assert.equal((await saved()).chapters[0].content.content[1].content[0].text, 'Target words remain.');
    await openText('Target words remain.'); assert.equal((await menuInfo()).find(item => item.id === 'accept').enabled, true); await click('accept');
    await waitFor(async () => words((await saved()).chapters[0].content.content[1]) === 'Target wording stays.', 'correction accepted');
    assert.ok(all((await saved()).chapters[0].content.content[1]).some(node => node.marks?.some(mark => mark.type === 'commentAnchor' && mark.attrs.id === 'target-note')));
    await openText('wording'); await click('rewrite'); await page.getByRole('listbox', { name: 'Rephrasing alternatives', exact: true }).waitFor();
    assert.ok(requests.some(request => request.model === 'mock-rewrite')); await openText('wording'); await click('dismiss'); await page.locator('.revision-preview').waitFor({ state: 'hidden' });
    assert.equal(words((await saved()).chapters[0].content.content[1]), 'Target wording stays.');
    checks.push('Selection AI opens its question composer without sending a request, routes correction/rephrasing to their configured local models, supports stopping and accepting/dismissing previews, and retains comment anchors.');

    // Right-click outside the retained rewrite selection, without first moving
    // the cursor with a left click or keyboard command.
    const beforeCaret = await menuCount();
    const caretPoint = await editor.evaluate(element => {
      const paragraph = [...element.querySelectorAll('p')].find(item => item.textContent === 'Continue anchor here.'), node = paragraph.firstChild, range = document.createRange();
      range.setStart(node, node.length - 1); range.setEnd(node, node.length); const box = range.getBoundingClientRect();
      return { x: box.right - 0.5, y: box.top + box.height / 2 };
    });
    await page.mouse.click(caretPoint.x, caretPoint.y, { button: 'right' }); await waitFor(async () => await menuCount() > beforeCaret, 'cursor menu outside selection');
    const caret = await menuInfo();
    assert.deepEqual(await editor.evaluate(element => ({ empty: element.editor.state.selection.empty, paragraph: element.editor.state.selection.$from.parent.textContent })), { empty: true, paragraph: 'Continue anchor here.' });
    assert.equal(caret.find(item => item.id === 'complete').enabled, true); assert.equal(caret.find(item => item.id === 'correct').enabled, false);
    await click('complete'); await page.locator('.ghost-text:not(.revision-preview)').waitFor();
    assert.equal(words((await saved()).chapters[0].content.content[2]), 'Continue anchor here.'); await openSelection(); await click('accept');
    await waitFor(async () => words((await saved()).chapters[0].content.content[2]).includes('and continued calmly.'), 'continuation accepted');
    assert.ok(requests.some(request => request.model === 'mock-continue'));
    assert.ok(requests.every(request => !JSON.stringify(request).includes('PRIVATE_CONTEXT_NOTE') && !JSON.stringify(request).includes('target-note')));
    checks.push('Right-clicking outside a selection places an empty cursor in the clicked paragraph and offers continuation there; generation remains a preview until accepted, and private notes/IDs never enter local AI prompts.');

    await openText('Untouched final words.'); const staleIndex = await menuCount() - 1; await editor.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.insertText(' Edited.');
    await waitFor(async () => words((await saved()).chapters[0].content.content[3]).endsWith(' Edited.'), 'typing after menu');
    const afterTyping = (await saved()).chapters; await click('paste-format', staleIndex); await page.getByText('The manuscript changed. Right-click the passage again.', { exact: true }).waitFor(); assert.deepEqual((await saved()).chapters, afterTyping);
    await select('Untouched final words.'); const beforeKeyboard = await menuCount(); await page.keyboard.press('Shift+F10'); await waitFor(async () => await menuCount() > beforeKeyboard, 'keyboard context menu');
    assert.equal((await menuInfo()).find(item => item.id === 'copy-format').enabled, true); assert.equal(await page.evaluate(() => window.getSelection().toString()), 'Untouched final words.');
    await page.screenshot({ path: path.join(output, 'context-menu-editor.png') });
    checks.push('Stale native menu callbacks reject changed passages; Shift+F10 opens the same editor menu with the keyboard selection intact.');
    assert.deepEqual(errors, []);
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, checks, menus: await app.evaluate(() => global.contextMenus.map(menu => menu.items.map(item => ({ id: item.id, label: item.label, role: item.role, enabled: item.enabled })))), providerRequests: requests.map(request => request.model), userData };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'context-menu-packaged-results.json' : 'context-menu-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, menus: undefined }, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'context-menu-failure.png') }).catch(() => {}); console.error('Renderer errors:', errors); console.error('Native menu:', await menuInfo().catch(() => [])); console.error('Selection:', await editor?.evaluate(element => ({ text: window.getSelection()?.toString(), state: element.editor?.state.selection.toJSON(), marks: element.editor?.state.storedMarks, paragraph: element.editor?.state.selection.$from.parent.toJSON() })).catch(() => null)); throw error; }
  finally { await close(); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
