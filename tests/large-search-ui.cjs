// Late Find results in a private synthetic profile; no author text or AI calls.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (fn, label) => {
  const until = Date.now() + 20000;
  while (Date.now() < until) { try { if (await fn()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error(label);
};
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'large-search-'));
  const fixture = { format: 'wraiter', version: 1, id: 'large-search', title: 'Late Find results', references: [], notes: '', style: '', snapshots: [], chapters: [
    { id: 'many', title: 'Many results', content: { type: 'doc', content: Array.from({ length: 2405 }, (_, index) => paragraph(`Paragraph ${index + 1}. The needle rests beside the quiet river.`)) } },
    { id: 'other', title: 'Another chapter', content: { type: 'doc', content: Array.from({ length: 10 }, (_, index) => paragraph(`Other paragraph ${index + 1}. Another needle is here.`)) } }
  ] };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, pageMode: 'continuous' }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app, page;
  try {
    app = await _electron.launch(options); page = await app.firstWindow(); const errors = [], checks = [];
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
    const search = () => page.getByRole('region', { name: 'Manuscript search and replace', exact: true });
    const find = () => page.getByRole('textbox', { name: 'Find text', exact: true });
    const active = () => editor.locator('.search-match-active');
    const activeVisible = async () => {
      await waitFor(async () => await active().count() === 1 && await active().evaluate(element => { const bounds = element.closest('.writing-scroll').getBoundingClientRect(), box = element.getBoundingClientRect(); return box.top >= bounds.top && box.bottom <= bounds.bottom; }), 'active result is visibly highlighted');
      assert.equal(await active().innerText(), 'needle');
    };
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).project.historySequence > 0, 'initial history');
    const initialHistory = await page.evaluate(() => window.wraiter.loadEditHistory('large-search'));
    await command('find'); await find().fill('needle'); await page.getByLabel('Search scope', { exact: true }).selectOption('chapter');
    await waitFor(async () => (await search().getByRole('status').innerText()) === '2405 matches', 'complete current-chapter results');
    await find().press('Shift+Enter'); await activeVisible();
    assert.match(await search().getByRole('status').innerText(), /2405 of 2405/);
    assert.equal(await editor.locator('.search-match').count(), 2001);
    assert.ok(await find().evaluate(element => element === document.activeElement));
    await find().press('Enter'); await activeVisible(); assert.match(await search().getByRole('status').innerText(), /^1 of 2405/);
    assert.equal(await editor.locator('.search-match').count(), 2000);
    await find().press('Shift+F3'); await activeVisible(); assert.match(await search().getByRole('status').innerText(), /2405 of 2405/);
    checks.push('Shift+Enter and Shift+F3 reveal result 2405 while Find retains focus; wrapping to result one reuses the bounded ordinary highlights.');
    assert.equal((await page.evaluate(() => window.wraiter.loadEditHistory('large-search'))).totalEvents, initialHistory.totalEvents);

    await find().fill('NEEDLE'); await page.getByLabel('Match case', { exact: true }).check();
    await waitFor(async () => (await search().getByRole('status').innerText()) === '0 matches' && await active().count() === 0, 'case change removes the previous active result');
    await page.getByLabel('Match case', { exact: true }).uncheck(); await find().fill('needle'); await activeVisible();
    assert.match(await search().getByRole('status').innerText(), /2405 of 2405/);
    await page.getByLabel('Replacement text', { exact: true }).fill('target'); await search().getByRole('button', { name: 'Replace', exact: true }).click();
    await waitFor(async () => (await editor.locator(':scope > p').last().innerText()).includes('The target rests') && await active().count() === 0, 'editing the selected result clears its stale highlight');
    await command('undo'); await waitFor(async () => (await editor.locator(':scope > p').last().innerText()).includes('The needle rests'), 'replace undo');
    await find().press('Shift+Enter'); await activeVisible();
    checks.push('Case options and replacement invalidate old highlights; undo restores the passage and late Find navigation.');

    await page.getByLabel('Search scope', { exact: true }).selectOption('manuscript'); await find().press('Enter');
    await waitFor(async () => (await editor.innerText()).includes('Other paragraph 1.'), 'cross-chapter Find'); await activeVisible();
    assert.match(await search().getByRole('status').innerText(), /2406 of 2415/);
    await find().press('Shift+Enter'); await waitFor(async () => (await editor.innerText()).startsWith('Paragraph 1.'), 'return to the long chapter'); await activeVisible();
    checks.push('Cross-chapter navigation highlights the actual current passage and returns to a result beyond the long chapter limit.');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    for (const theme of ['Light', 'Dark', 'High contrast']) {
      await command('settings-appearance'); await page.getByRole('button', { name: theme, exact: true }).click(); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' }); await find().press('Shift+Enter'); await activeVisible();
      await page.screenshot({ path: path.join(userData, `active-find-${theme.replace(/ /g, '-').toLowerCase()}.png`) });
    }
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'needle');
    assert.equal(await editor.locator('.search-match').count(), 0);
    checks.push('Active matches remain visible at the minimum window in all themes; closing Find removes decorations and preserves selected prose.');
    assert.deepEqual(errors, []);
    const result = { passed: true, checks, userData, errors };
    await fs.writeFile(path.join(output, 'large-search-ui-results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await page?.screenshot({ path: path.join(userData, 'failure.png') }).catch(() => {});
    const diagnostic = await page?.evaluate(() => {
      const element = document.querySelector('.manuscript'), editor = element?.editor, active = element?.querySelector('.search-match-active'), scroller = document.querySelector('.writing-scroll');
      return { selection: editor?.state.selection.toJSON(), selectionText: editor && editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to), paragraph: editor?.state.selection.$head.parent.textContent, activeCount: element?.querySelectorAll('.search-match-active').length, activeBounds: active?.getBoundingClientRect().toJSON(), viewport: scroller?.getBoundingClientRect().toJSON(), scrollTop: scroller?.scrollTop, focused: document.activeElement?.getAttribute('aria-label') };
    }).catch(() => null);
    console.error(JSON.stringify({ userData, diagnostic })); throw error;
  }
  finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
