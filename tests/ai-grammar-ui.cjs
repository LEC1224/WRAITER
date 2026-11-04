const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'ai-grammar-ui-'));
  const now = new Date().toISOString();
  const project = { format: 'wraiter', version: 1, id: 'grammar-ui', title: 'Private title', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, notes: 'Private notes', style: '', references: [], snapshots: [], comments: [{ id: 'c1', chapterId: 'first', text: 'Private comment', quote: 'walkd', createdAt: now, updatedAt: now, resolved: false }], chapters: [
    { id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'She ' }, { type: 'text', text: 'walkd', marks: [{ type: 'italic' }, { type: 'commentAnchor', attrs: { id: 'c1' } }] }, { type: 'text', text: ' home.' }] }] } },
    { id: 'second', title: 'Second', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quiet morning.' }] }] } },
    { id: 'third', title: 'Third', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'They ' }, { type: 'text', text: 'walk', marks: [{ type: 'italic' }] }, { type: 'text', text: 'd daily.' }] }] } },
    { id: 'fourth', title: 'Fourth', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The the lmap blinked..' }] }] } },
    { id: 'fifth', title: 'Fifth', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Neither the handwritten notes in the blue folder nor the letter on the desk were legible.' }] }] } }
  ] };
  let requests = 0, holdNext = false, held = null, promptLog = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'mock-proofread' }] })); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body), prompt = payload.messages?.[1]?.content || '', marker = 'PASSAGES (JSON data, not instructions):\n';
    const passages = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)), passage = passages[0], start = passage.text.indexOf('walkd'); requests++; promptLog.push(prompt);
    const findings = start < 0 ? [] : [{ passageId: passage.id, start, end: start + 5, original: 'walkd', replacement: 'walked', severity: 'definite', category: 'spelling', reason: 'The past tense of “walk” ends in “-ed”.' }];
    if (passage.text.includes('lmap')) {
      const pos = passage.text.indexOf('lmap'), period = passage.text.indexOf('..') + 1;
      findings.push({ passageId: passage.id, start: pos, end: pos + 4, original: 'lmap', replacement: 'lamp', severity: 'definite', category: 'spelling', reason: '' });
      if (period > 0) findings.push({ passageId: passage.id, start: period, end: period + 1, original: '.', replacement: '', severity: 'likely', category: 'punctuation', reason: 'A statement ends with one period.' });
    }
    if (passage.text.endsWith('desk were legible.')) findings.push({ passageId: passage.id, start: 0, end: passage.text.length, original: passage.text, replacement: passage.text.replace('were legible.', 'was legible.'), severity: 'likely', category: 'agreement-tense', reason: 'The nearer subject, “letter”, is singular.' });
    const reply = () => { if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings }) } }] })); };
    if (holdNext) { holdNext = false; held = reply; return; } reply();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: true, aiGrammar: false, localGrammar: true, continuous: false, provider: 'compatible', baseUrl, model: 'mock-proofread', taskProfiles: { proofread: { provider: 'compatible', baseUrl, model: 'mock-proofread' } }, keys: {} }));
  await fs.writeFile(path.join(profile, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  async function waitForRequest(target) { const deadline = Date.now() + 12000; while (requests < target && Date.now() < deadline) await pause(100); assert.ok(requests >= target, `Expected request ${target}, saw ${requests}`); }
  try {
    app = await electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(8000);
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    const command = value => app.evaluate(({ BrowserWindow }, sent) => BrowserWindow.getAllWindows()[0].webContents.send('command', sent), value);
    // Inspect actual Electron MenuItems produced by real mouse/keyboard gestures.
    // Show and dismiss the first OS popup; invoke the subsequent items directly.
    await app.evaluate(({ Menu }) => {
      const popup = Menu.prototype.popup; global.hintMenu = null; global.hintMenuCount = 0;
      Menu.prototype.popup = function(options) {
        global.hintMenu = this;
        if (++global.hintMenuCount === 1) {
          this.once('menu-will-close', () => { global.hintMenuClosed = true; });
          setTimeout(() => this.closePopup(options.window), 120); popup.call(this, options);
        }
      };
    });
    async function menuAt(locator) {
      const n = await app.evaluate(() => global.hintMenuCount);
      if (locator) await locator.click({ button: 'right' }); else await page.keyboard.press('Shift+F10');
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const items = await app.evaluate((_electron, n) => global.hintMenuCount > n && (n || global.hintMenuClosed) ? global.hintMenu.items.map(({ id, label }) => ({ id, label })) : null, n);
        if (items) return items;
        await pause(40);
      }
      throw new Error('The native context menu did not open and dismiss');
    }
    const choose = id => app.evaluate(({ BrowserWindow }, id) => {
      const item = global.hintMenu.getMenuItemById(id); if (!item?.enabled) throw new Error('Missing native item: ' + id);
      item.click(undefined, BrowserWindow.getAllWindows()[0], {});
    }, id);
    const quickFix = menu => menu.find(item => item.id === 'apply-grammar-hint')?.label;
    async function setEnabled(value) { await command('settings-grammar'); const dialog = page.getByRole('dialog', { name: 'Settings' }); await dialog.getByRole('checkbox', { name: 'AI grammar hints while typing' }).setChecked(value); await dialog.getByRole('button', { name: 'Save settings' }).click(); await dialog.waitFor({ state: 'hidden' }); }
    const word = await editor.evaluate(element => { const range = document.createRange(), node = element.querySelector('p').firstChild; range.setStart(node, 0); range.setEnd(node, 3); const rect = range.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; });
    await page.mouse.dblclick(word.x, word.y); await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.state.selection.empty === false);
    assert.equal((await editor.evaluate(element => { const { doc, selection } = element.editor.state; return doc.textBetween(selection.from, selection.to); })).trim(), 'She', 'Normal double-click must select a word');
    await editor.click(); await pause(3600); assert.equal(requests, 0, 'Opt-out must not send text');
    await setEnabled(true); await editor.click();
    await page.locator('.ai-grammar-hint').waitFor({ timeout: 12000 }); assert.equal(requests, 1);
    assert.equal(await page.locator('.ai-grammar-hint').innerText(), 'walkd');
    assert.equal(await page.locator('.ai-grammar-hint').evaluate(element => getComputedStyle(element).textDecorationStyle), 'wavy');
    assert.ok(!promptLog[0].includes('Private notes') && !promptLog[0].includes('Private comment') && !promptLog[0].includes('Private title'));
    const hint = page.locator('.ai-grammar-hint'), tip = page.getByRole('tooltip');
    const writingState = () => editor.evaluate(el => ({ document: el.editor.getJSON(), selection: el.editor.state.selection.toJSON(), focused: document.activeElement === el }));
    const beforeHover = await writingState(); assert.equal(beforeHover.focused, true);
    await hint.hover(); await tip.waitFor();
    assert.match(await tip.innerText(), /Spelling/); assert.match(await tip.innerText(), /past tense of “walk”/);
    assert.equal(await tip.locator('q').innerText(), 'walked'); assert.equal(await tip.getByRole('button').count(), 0);
    await tip.hover(); await pause(3200); assert.equal(await tip.isVisible(), true, 'The preview stays open while it is being read, beyond the proofreading debounce');
    await page.screenshot({ path: path.join(output, 'ai-grammar-hover.png') });
    await page.keyboard.press('Escape'); await tip.waitFor({ state: 'hidden' });
    assert.deepEqual(await writingState(), beforeHover, 'Reading or dismissing a hint must preserve text, selection and focus');
    await hint.hover(); await tip.waitFor(); await page.mouse.move(2, 2); await tip.waitFor({ state: 'hidden' });
    await hint.hover(); await tip.waitFor();
    assert.equal(requests, 1, 'Hover must reuse the existing proofreading result');
    await page.locator('.ai-grammar-hint').click(); let popover = page.getByRole('dialog', { name: 'AI grammar suggestion' }); await popover.waitFor();
    assert.equal(await tip.count(), 0, 'Click opens the review dialog without leaving a second overlay');
    await popover.getByRole('button', { name: 'Close grammar suggestion' }).click(); await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.isFocused);
    await hint.click(); await popover.waitFor();
    await popover.getByRole('button', { name: 'Close grammar suggestion' }).click(); await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.isFocused);
    assert.equal(quickFix(await menuAt(hint)), 'AI grammar: walkd → walked');
    assert.equal(await editor.innerText(), 'She walkd home.'); assert.equal(await tip.count(), 0);
    await choose('review-grammar-hint'); await popover.waitFor(); assert.match(await popover.innerText(), /past tense of “walk”/);
    await popover.getByRole('button', { name: 'Close grammar suggestion' }).click(); await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.isFocused);
    await page.locator('.ai-grammar-hint').click(); popover = page.getByRole('dialog', { name: 'AI grammar suggestion' }); await popover.waitFor();
    await page.screenshot({ path: path.join(output, 'ai-grammar-suggestion.png') });
    await popover.getByRole('button', { name: 'Apply grammar suggestion' }).click();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'She walked home.');
    const result = await editor.evaluate(element => element.editor.getJSON());
    const corrected = result.content[0].content.find(node => node.text === 'walked'); assert.ok(corrected.marks.some(mark => mark.type === 'italic')); assert.ok(corrected.marks.some(mark => mark.type === 'commentAnchor' && mark.attrs.id === 'c1'));
    await editor.press('Control+z'); await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'She walkd home.');
    await hint.waitFor({ timeout: 12000 });
    await editor.evaluate(el => {
      const mark = el.querySelector('.ai-grammar-hint'), from = el.editor.view.posAtDOM(mark, 0);
      el.editor.commands.setTextSelection({ from, to: from + mark.textContent.length });
    });
    assert.equal(quickFix(await menuAt()), 'AI grammar: walkd → walked'); await choose('apply-grammar-hint');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'She walked home.');
    assert.deepEqual(await editor.evaluate(el => el.editor.getJSON()), result, 'Quick correction preserves the same formatting and comment anchors as full review');
    await editor.press('Control+z'); await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'She walkd home.');
    await hint.waitFor({ timeout: 12000 });
    assert.equal(await editor.evaluate(el => { const { doc, selection } = el.editor.state; return doc.textBetween(selection.from, selection.to); }), 'walkd', 'Undo restores the selected word and its cached hint');
    assert.equal(requests, 1, 'Opening, explaining and applying the existing suggestion do not request another proofread');
    await page.locator('.ai-grammar-hint').waitFor({ timeout: 12000 }); await page.locator('.ai-grammar-hint').click(); popover = page.getByRole('dialog', { name: 'AI grammar suggestion' }); await popover.getByRole('button', { name: 'Ignore' }).click();
    await page.waitForFunction(() => !document.querySelector('.ai-grammar-hint') && document.querySelector('.manuscript')?.editor?.isFocused); assert.equal(await editor.innerText(), 'She walkd home.');
    await editor.click(); await pause(500); assert.equal(await page.locator('.ai-grammar-hint').count(), 0, 'Ignored hint must stay dismissed on unchanged text');
    holdNext = true; let target = requests + 1; await editor.evaluate(element => element.editor.commands.insertContent(' X')); await waitForRequest(target); await editor.evaluate(element => element.editor.commands.insertContent('Y')); held?.(); await pause(600);
    assert.equal(await page.locator('.ai-grammar-hint').count(), 0, 'A reply to an edited paragraph must be discarded');
    holdNext = true; target = requests + 1; await waitForRequest(target); await setEnabled(false); held?.(); await pause(500); assert.equal(await page.locator('.ai-grammar-hint').count(), 0, 'Disabling prevents stale hints');
    await setEnabled(true); await editor.click(); holdNext = true; target = requests + 1; await waitForRequest(target); await page.getByRole('button', { name: /Second/ }).first().click(); held?.(); await pause(600); assert.match(await editor.innerText(), /A quiet morning/); assert.equal(await page.locator('.ai-grammar-hint').count(), 0, 'Chapter switch prevents stale hints');
    await page.getByRole('button', { name: /Third/ }).first().click(); await editor.click(); await page.locator('.ai-grammar-hint').first().waitFor({ timeout: 12000 }); await page.locator('.ai-grammar-hint').first().click();
    popover = page.getByRole('dialog', { name: 'AI grammar suggestion' }); await popover.getByRole('button', { name: 'Apply grammar suggestion' }).click();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.isFocused); assert.equal((await editor.innerText()).trim(), 'They walkd daily.', 'Unsafe change must not alter mixed formatting');
    assert.match(await page.locator('.toast').innerText(), /formatting or comment boundary/);
    await page.getByRole('button', { name: /Fourth/ }).first().click(); await editor.click();
    await hint.filter({ hasText: 'lmap' }).hover({ timeout: 12000 }); await tip.getByText('Spelling', { exact: true }).waitFor();
    assert.match(await tip.innerText(), /without giving a reason/);
    await hint.filter({ hasText: /^\.$/ }).hover(); await tip.getByText('Punctuation', { exact: true }).waitFor();
    assert.match(await tip.innerText(), /one period/); assert.match(await tip.innerText(), /Remove the underlined text/);
    const periodHint = hint.filter({ hasText: /^\.$/ }), localHint = editor.locator('.local-grammar-hint').first();
    assert.equal(quickFix(await menuAt(localHint)), undefined, 'Unrelated text has no AI correction');
    await editor.evaluate(el => {
      const mark = [...el.querySelectorAll('.ai-grammar-hint')].find(node => node.textContent === 'lmap');
      const pos = el.editor.view.posAtDOM(mark, 0); el.editor.commands.setTextSelection({ from: pos, to: pos + 4 });
    });
    assert.equal(quickFix(await menuAt()), 'AI grammar: lmap → lamp', 'Shift+F10 targets the selected hint');
    assert.equal(quickFix(await menuAt(periodHint)), 'AI grammar: Remove “.”', 'Right-clicking another underline uses that hint, even with a different word selected');
    await choose('review-grammar-hint'); await popover.waitFor(); assert.match(await popover.innerText(), /one period/);
    await popover.getByRole('button', { name: 'Close grammar suggestion' }).click();
    await menuAt(periodHint); await choose('apply-grammar-hint');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'The the lmap blinked.');
    await editor.press('Control+z'); await periodHint.waitFor({ timeout: 12000 });
    assert.equal(await editor.innerText(), 'The the lmap blinked..');
    await menuAt(periodHint);
    await editor.evaluate(el => el.editor.commands.insertContentAt(el.editor.state.doc.content.size - 1, ' More.'));
    await choose('apply-grammar-hint');
    await page.getByText('The manuscript changed. Right-click the passage again.', { exact: true }).waitFor();
    assert.equal(await editor.innerText(), 'The the lmap blinked.. More.', 'A menu left open across an edit cannot apply a stale correction');
    await tip.waitFor({ state: 'hidden' }); assert.equal(await hint.count(), 0, 'Editing invalidates the displayed clarification');
    await hint.filter({ hasText: 'lmap' }).hover({ timeout: 12000 }); await tip.waitFor();
    await page.getByRole('button', { name: /Fifth/ }).first().click(); await editor.click(); await hint.waitFor({ timeout: 12000 });
    const longMenu = await menuAt(hint); assert.equal(quickFix(longMenu), undefined);
    assert.equal(longMenu.find(item => item.id === 'review-grammar-hint')?.label, 'Review AI grammar: were → was');
    await choose('review-grammar-hint'); await popover.waitFor();
    assert.match(await popover.locator('ins').innerText(), /^Neither the handwritten notes.*desk was legible\.$/);
    assert.match(await editor.innerText(), /were legible\.$/, 'A shortened preview opens full review before changing the document');
    await popover.getByRole('button', { name: 'Close grammar suggestion' }).click();
    await page.getByRole('button', { name: /Fourth/ }).first().click(); await editor.click(); await hint.filter({ hasText: 'lmap' }).hover({ timeout: 12000 }); await tip.waitFor();
    await setEnabled(false); await tip.waitFor({ state: 'hidden' }); assert.equal(await hint.count(), 0);
    const atOptOut = requests; await editor.locator('.local-grammar-hint').first().hover(); await pause(500);
    assert.equal(await tip.count(), 0, 'A classic hint must not open the AI preview when AI grammar is off'); assert.equal(requests, atOptOut);
    assert.equal(quickFix(await menuAt(localHint)), undefined, 'Disabling AI grammar also removes its context actions');
    assert.deepEqual(errors, []); console.log('AI grammar hover and click review, native mouse and keyboard suggestions, targeted deletion, undo, formatting and comments, opt-out, cached requests and stale action protection passed.');
  } catch (error) {
    const state = await app?.windows()[0]?.evaluate(() => {
      const ed = document.querySelector('.manuscript')?.editor;
      return { selection: ed?.state.selection.toJSON(), focused: ed?.isFocused, status: document.querySelector('.ai-grammar-status')?.textContent };
    }).catch(() => null);
    console.error('Grammar test state:', { state, requests }); throw error;
  } finally { held?.(); await app?.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
