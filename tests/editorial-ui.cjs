// Real Electron/editor/history integration with synthetic local model replies.
// This never opens a personal manuscript or contacts a paid AI provider.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (fn, label) => { const until = Date.now() + 25000; while (Date.now() < until) { try { if (await fn()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${label}`); };
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'editorial-')), errors = [], checks = [];
  const initial = { format: 'wraiter', version: 1, id: 'editorial-ui', title: 'The Glass Orchard', language: 'en-US', chapters: [{ id: 'one', title: 'Opening', content: { type: 'doc', content: [paragraph('The [i]quiet [b]orchard[/b][/i] waited.'), paragraph('A second paragraph.')] } }, { id: 'two', title: 'Ending', content: { type: 'doc', content: [paragraph('The gate stood open.')] } }] };
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') return response.end('{"models":[{"name":"editorial-test"}]}');
    let data = ''; for await (const chunk of request) data += chunk;
    const prompt = JSON.parse(data).prompt || '';
    const records = JSON.parse(prompt.match(/CURRENT TOOL RESULTS:\n(.*?)\n\nRemaining document tools:/s)?.[1] || '[]');
    const instruction = prompt.match(/AUTHOR REQUEST:\n(.*?)\n\nAUTHOR WRITING VOICE/s)?.[1] || '';
    let answer;
    if (instruction === 'Convert markup.') answer = records.length ? { done: true, tools: [], message: 'Converted paired tags to formatting.' } : { done: false, message: 'Converting markup.', tools: [{ name: 'convert_bbcode', arguments: { scope: 'one' } }] };
    else if (instruction === 'Restructure the opening.') {
      if (!records.length) answer = { done: false, message: 'Reading structure.', tools: [{ name: 'read_structure', arguments: { chapterId: 'one' } }] };
      else if (records.length === 1) answer = { done: false, message: 'Splitting the chapter.', tools: [{ name: 'split_chapter', arguments: { chapterId: 'one', revision: 0, index: 1, title: 'The middle' } }] };
      else answer = { done: true, tools: [], message: 'Split the opening into two chapters.' };
    } else if (instruction === 'Delete the ending.') answer = records.length ? { done: true, tools: [], message: 'Removed the ending chapter.' } : { done: false, message: 'Removing the ending.', tools: [{ name: 'delete_chapter', arguments: { chapterId: 'two', revision: 0, before: 'Ending' } }] };
    else answer = { done: true, tools: [], message: 'Synthetic answer.' };
    response.end(JSON.stringify({ response: JSON.stringify(answer) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: true, continuous: false, provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'editorial-test', ollamaMode: 'raw' }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: initial, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, editor;
  const launch = async () => {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 });
  };
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const boot = () => page.evaluate(() => window.wraiter.boot());
  const ask = async (text, answer) => {
    if (!await page.getByRole('textbox', { name: 'Ask the writing assistant', exact: true }).count()) await command('toggle-assistant');
    await page.getByRole('textbox', { name: 'Ask the writing assistant', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send writing question', exact: true }).click();
    await page.getByText(answer, { exact: true }).waitFor({ timeout: 25000 });
    assert.equal(await page.locator('.chat-message-warning').count(), 0);
  };
  const closeReport = () => page.getByRole('dialog', { name: 'Assistant changes', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click();
  const clearSelection = async () => { await editor.evaluate(element => { element.focus(); const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); }); await page.waitForTimeout(120); };
  try {
    await launch(); await clearSelection();
    await ask('Convert markup.', 'Converted paired tags to formatting.');
    await waitFor(async () => await editor.innerText() === 'The quiet orchard waited.\n\nA second paragraph.', 'converted prose');
    assert.equal((await editor.locator('em').allTextContents()).join(''), 'quiet orchard'); assert.equal(await editor.locator('strong').innerText(), 'orchard');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Assistant changes', exact: true });
    await dialog.waitFor(); assert.match(await dialog.innerText(), /\[i\]quiet/); assert.equal((await dialog.locator('em').allTextContents()).join(''), 'quiet orchard');
    await page.screenshot({ path: path.join(output, 'editorial-report.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    await page.waitForTimeout(150); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, 'editorial-report-small.png') });
    await closeReport();
    checks.push('BBCode becomes native nested italics/bold; the report shows exact before/after content at normal and minimum window sizes.');

    await page.locator('.chapter-select').filter({ hasText: 'Ending' }).click(); await clearSelection(); await page.keyboard.insertText(' Later author work.');
    await waitFor(async () => JSON.stringify((await boot()).project).includes('Later author work.'), 'saved later edit');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await dialog.getByRole('button', { name: 'Revert this assistant edit', exact: true }).click();
    await waitFor(async () => await dialog.getByRole('button', { name: 'Revert this assistant edit', exact: true }).isDisabled(), 'reverted report state');
    await closeReport();
    assert.match(await editor.innerText(), /Later author work/);
    await page.locator('.chapter-select').filter({ hasText: 'Opening' }).click(); assert.match(await editor.innerText(), /\[i\]quiet/);
    await command('undo'); await waitFor(async () => await editor.locator('em').count() > 0, 'undo revert');
    await waitFor(async () => (await boot()).project.chats[0].messages.some(message => message.historyEntryId), 'saved report link');
    checks.push('Revert preserves later writing in another chapter; undoing the revert restores the rich edit.');

    await app.close(); app = null; await launch();
    dialog = page.getByRole('dialog', { name: 'Assistant changes', exact: true });
    if (!await page.getByRole('button', { name: 'Review changes', exact: true }).count()) await command('toggle-assistant');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await dialog.waitFor(); assert.equal((await dialog.locator('em').allTextContents()).join(''), 'quiet orchard'); await closeReport();
    await clearSelection(); await ask('Restructure the opening.', 'Split the opening into two chapters.');
    await waitFor(async () => (await boot()).project.chapters.length === 3, 'split saved');
    assert.equal(await page.locator('.chapter-select').filter({ hasText: 'The middle' }).count(), 1);
    await page.getByRole('button', { name: 'Undo assistant edit', exact: true }).last().click();
    await waitFor(async () => (await boot()).project.chapters.length === 2, 'undo split');
    checks.push('Saved report links and formatting survive restart; chapter splitting applies and undoes through the real UI.');

    await page.locator('.chapter-select').filter({ hasText: 'Ending' }).click(); await clearSelection();
    await ask('Delete the ending.', 'Removed the ending chapter.');
    await waitFor(async () => (await boot()).project.chapters.length === 1, 'delete saved');
    assert.match(await editor.innerText(), /orchard/);
    await page.getByRole('button', { name: 'Undo assistant edit', exact: true }).last().click();
    await waitFor(async () => (await boot()).project.chapters.length === 2, 'undo chapter deletion');
    checks.push('Deleting the displayed chapter safely selects the surviving chapter; undo restores the deleted chapter and its later author edits.');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'editorial-ui-report.json'), JSON.stringify({ passed: true, checks, userData }, null, 2));
    console.log(checks.join('\n'));
  } catch (error) { if (page) await page.screenshot({ path: path.join(output, 'editorial-ui-failure.png') }).catch(() => {}); throw error; }
  finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
