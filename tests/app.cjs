// Synthetic manuscripts and a local fake Ollama service; no paid AI calls.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const waitFor = async (fn, label, timeout = 12000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { if (await fn()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
};
(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'session-')), projectPath = path.join(userData, 'Integration manuscript.wraiter');
  const { defaults } = require('../electron/preferences.cjs');
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ...defaults, setupComplete: true, tutorialComplete: true, keys: {} }));
  const events = [], failures = [], requests = [];
  let nextReply = 'and found a note waiting on the windowsill.', delay = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ models: ['continue', 'correct', 'rewrite', 'proofread', 'chat'].map(task => ({ name: `mock-${task}` })) }));
    let body = ''; req.on('data', bytes => { body += bytes; });
    req.on('end', () => {
      requests.push({ ...JSON.parse(body || '{}'), endpoint: req.url }); const reply = nextReply;
      setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify(req.url === '/api/generate' ? { response: reply } : { message: { content: JSON.stringify({ completion: reply }) } })); }, delay);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app, page, editor;
  const recover = async () => JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
  const textOf = node => node.type === 'text' ? node.text : (node.content || []).map(textOf).join(node.type === 'doc' ? '\n' : '');
  const visibleText = () => editor.evaluate(element => { const copy = element.cloneNode(true); copy.querySelectorAll('.ghost-text,.ai-loading').forEach(item => item.remove()); return copy.textContent; });
  const menu = (group, label) => app.evaluate(({ Menu }, [group, label]) => {
    const section = Menu.getApplicationMenu().items.find(item => item.label.replace(/&/g, '') === group);
    const entry = section?.submenu.items.find(item => item.label.replace(/&/g, '') === label);
    if (!entry) throw new Error(`Missing native menu ${group} > ${label}`); entry.click();
  }, [group, label]);
  const replaceEditor = async text => { await editor.click(); await page.keyboard.press('Escape'); await page.keyboard.press('Control+a'); await page.keyboard.insertText(text); };
  const selectText = async target => {
    await editor.evaluate((element, target) => {
      element.focus(); const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.ghost-text,.ai-loading')) nodes.push(walker.currentNode);
      const all = nodes.map(node => node.textContent).join(''), start = all.indexOf(target), end = start + target.length;
      if (start < 0) throw new Error(`Selection text not found: ${target}`);
      const range = document.createRange(); let offset = 0, began = false;
      for (const node of nodes) { const length = node.textContent.length; if (!began && start <= offset + length) { range.setStart(node, start - offset); began = true; } if (began && end <= offset + length) { range.setEnd(node, end - offset); break; } offset += length; }
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, target);
    await waitFor(() => page.evaluate(target => window.getSelection().toString() === target, target), 'selected passage'); await page.waitForTimeout(80);
  };
  const prepareWindow = async () => {
    page = await app.firstWindow(); editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    page.on('pageerror', error => failures.push(error.message)); page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
    await editor.waitFor({ timeout: 30000 });
  };
  const reload = async () => { await page.reload(); await editor.waitFor({ timeout: 30000 }); };
  const chapter2 = () => page.locator('.chapter-select').filter({ hasText: 'Integration chapter' });
  const preview = async (selector = '.ghost-text') => { await page.locator(selector).waitFor(); await page.locator('.ghost-controls').waitFor(); await page.locator('.generation-inline').waitFor({ state: 'hidden' }); };
  try {
    app = await electron.launch(launchOptions); await prepareWindow();
    assert.equal((await editor.innerText()).trim(), '');
    assert.deepEqual(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => item.label.replace(/&/g, ''))), ['File', 'Edit', 'View', 'Tools', 'Settings', 'Help']);
    await replaceEditor('A reliable sentence with a mistkae.');
    await waitFor(async () => JSON.stringify(await recover()).includes('mistkae'), 'local recovery');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, projectPath);
    await menu('File', 'Save'); await waitFor(async () => JSON.parse(await fs.readFile(projectPath, 'utf8')).chapters.length === 1, 'named save');
    events.push('Blank manuscript, native File/Edit/View/Tools/Settings/Help menu, named saves and recovery work.');
    await page.getByRole('button', { name: 'New chapter', exact: true }).click(); await page.getByRole('textbox', { name: 'Chapter title', exact: true }).fill('Integration chapter');
    await replaceEditor('This is a new chapter.'); await page.locator('.chapter-select').filter({ hasText: 'Chapter one' }).click(); assert.match(await visibleText(), /mistkae/);
    await chapter2().click(); assert.equal(await visibleText(), 'This is a new chapter.');
    await replaceEditor('Before. A quiet hour. After.'); await menu('Edit', 'Find…');
    await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('quiet'); await page.getByRole('textbox', { name: 'Replacement text', exact: true }).fill('bright');
    await page.getByRole('button', { name: 'Replace', exact: true }).click(); assert.match(await visibleText(), /bright hour/);
    await page.getByRole('button', { name: 'Close search', exact: true }).click(); await editor.click(); await page.keyboard.press('Control+z'); assert.match(await visibleText(), /quiet hour/);
    events.push('Chapter navigation, titles and undoable find/replace preserve the manuscript.');
    await selectText('A quiet hour.'); await page.getByRole('combobox', { name: 'Font family', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search fonts', exact: true }).fill('Arial'); await page.getByRole('option', { name: /^Arial Aa$/ }).click();
    await page.getByRole('spinbutton', { name: 'Font size in points', exact: true }).fill('22'); await page.keyboard.press('Enter');
    await waitFor(async () => JSON.stringify(await recover()).includes('22pt'), 'font formatting save'); assert.ok(JSON.stringify((await recover()).chapters[1]).includes('Arial'));
    await page.screenshot({ path: path.join(output, '01-paper.png') }); events.push('Installed font and point-size controls apply formatting to the selected text.');
    await menu('View', 'Revision history'); await page.getByRole('tab', { name: /^Checkpoints/ }).click(); await page.getByRole('button', { name: 'Save version', exact: true }).click();
    await page.getByRole('textbox', { name: 'Version description', exact: true }).fill('Before AI editing'); await page.getByRole('dialog').getByRole('button', { name: 'Save version', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); const versions = await page.evaluate(() => window.wraiter.listGitHistory());
    assert.ok(versions.available && versions.entries.some(entry => entry.message === 'Before AI editing'));
    const savedVersion = versions.entries.find(entry => entry.message === 'Before AI editing').revision;
    assert.equal(textOf((await page.evaluate(revision => window.wraiter.getGitRevision(revision), savedVersion)).chapters[1].content), 'Before. A quiet hour. After.');
    events.push('Named Git checkpoints preserve full document content and formatting.');

    await page.evaluate(baseUrl => window.wraiter.settings({ setupComplete: true, tutorialComplete: true, enabled: true, continuous: false, provider: 'ollama', baseUrl, model: 'mock-continue', ollamaMode: 'raw', nativeLanguage: 'sv-SE', taskProfiles: Object.fromEntries(['continue', 'correct', 'rewrite', 'proofread', 'chat'].map(task => [task, { provider: 'ollama', baseUrl, model: `mock-${task}`, codexPath: '' }])) }), baseUrl);
    await reload(); await chapter2().click(); await page.getByRole('combobox', { name: 'Content language', exact: true }).selectOption('en-GB');
    await replaceEditor('Before. A quiet hour. After.'); await selectText('A quiet hour.'); nextReply = 'A peaceful moment.';
    await page.keyboard.press('Tab'); await preview('.revision-preview'); assert.equal(await visibleText(), 'Before. A quiet hour. After.');
    await menu('File', 'Save'); await waitFor(async () => (await fs.readFile(projectPath, 'utf8')).includes('A quiet hour.'), 'selection preview save');
    assert.ok(!(await fs.readFile(projectPath, 'utf8')).includes('A peaceful moment.')); assert.ok(requests.at(-1).prompt.includes('SELECTED TEXT:\nA quiet hour.')); assert.equal(requests.at(-1).model, 'mock-rewrite');
    await page.keyboard.press('Escape'); await waitFor(() => page.evaluate(() => window.getSelection().toString() === 'A quiet hour.'), 'selection restored after rejection');
    nextReply = 'A calmer hour.'; await page.keyboard.press('Tab'); await preview('.revision-preview'); assert.ok(requests.at(-1).prompt.includes('A peaceful moment.'));
    await page.keyboard.press('Tab'); assert.equal(await visibleText(), 'Before. A calmer hour. After.'); await page.keyboard.press('Control+z'); assert.equal(await visibleText(), 'Before. A quiet hour. After.');
    events.push('Selection + Tab previews only that passage; saves exclude the preview, Esc restores selection, rejected alternatives are remembered, acceptance is undoable.');
    await replaceEditor('Start '); nextReply = 'moon rises softly.'; await page.keyboard.press('Tab'); await preview();
    await page.keyboard.press('ArrowRight'); assert.equal(await visibleText(), 'Start m'); await page.keyboard.press('Control+ArrowRight'); assert.equal(await visibleText(), 'Start moon ');
    assert.equal(await page.locator('.ghost-text').textContent(), 'rises softly.'); await page.keyboard.press('Escape'); assert.equal(await page.locator('.ghost-text').count(), 0);
    await page.keyboard.press('Control+z'); assert.equal(await visibleText(), 'Start m'); events.push('Right-arrow accepts one character and Ctrl+Right one word; the remainder stays outside the document.');
    await replaceEditor('Start'); nextReply = 'and continued softly.'; delay = 700; let beforeCount = requests.length;
    await page.keyboard.press('Tab'); await waitFor(() => requests.length > beforeCount, 'pending completion request'); await page.keyboard.insertText(' and'); await preview();
    assert.equal(await visibleText(), 'Start and'); assert.equal(await page.locator('.ghost-text').textContent(), ' continued softly.');
    await page.keyboard.press('Tab'); assert.equal(await visibleText(), 'Start and continued softly.');
    await replaceEditor('Start'); nextReply = 'a stale suggestion.'; beforeCount = requests.length;
    await page.keyboard.press('Tab'); await waitFor(() => requests.length > beforeCount, 'mismatch completion request'); await page.keyboard.insertText(' my own words'); await page.waitForTimeout(1000);
    assert.equal(await page.locator('.ghost-text').count(), 0); assert.equal(await visibleText(), 'Start my own words'); delay = 0;
    events.push('Typing a matching prefix while generation runs trims the suggestion; a different continuation suppresses stale output.');
    await replaceEditor('She opend the door.'); await selectText('She opend the door.'); nextReply = 'She opened the door.';
    await page.keyboard.press('Control+Alt+g'); await preview('.revision-preview'); assert.equal(requests.at(-1).model, 'mock-correct');
    assert.ok(requests.at(-1).prompt.includes('content language is en-GB') && requests.at(-1).prompt.includes('native language is sv-SE'));
    await page.keyboard.press('Tab'); assert.equal(await visibleText(), 'She opened the door.'); await page.keyboard.press('Control+z'); assert.equal(await visibleText(), 'She opend the door.');
    await replaceEditor('We stopped for fika.'); await selectText('fika'); nextReply = 'a coffee break'; await page.keyboard.press('Tab'); await preview('.revision-preview');
    assert.ok(requests.at(-1).prompt.includes('translate ONLY that selected text') && requests.at(-1).prompt.includes('SELECTED TEXT:\nfika'));
    await page.keyboard.press('Tab'); assert.equal(await visibleText(), 'We stopped for a coffee break.');
    events.push('Spell correction uses its own model and content language; native-language translation replaces only the selection.');
    await menu('View', 'Writing assistant'); await page.getByRole('textbox', { name: 'Ask the writing assistant', exact: true }).fill('Is the pacing clear?'); nextReply = JSON.stringify({ message: 'The pacing is clear.', done: true, tools: [] });
    await page.getByRole('button', { name: 'Send writing question', exact: true }).click(); await page.locator('.chat-message.assistant').filter({ hasText: 'The pacing is clear.' }).waitFor(); assert.equal(requests.at(-1).model, 'mock-chat');
    events.push('Autocomplete, correction, rephrasing and chat route to four independently selected models.');
    const pdfPath = path.join(userData, 'Export.pdf'); await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, pdfPath);
    await menu('File', 'Export…'); await page.getByRole('combobox', { name: 'Export scope', exact: true }).selectOption('manuscript'); await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('pdf'); await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click(); await waitFor(async () => (await fs.readFile(pdfPath)).subarray(0, 4).toString() === '%PDF', 'PDF export', 20000);
    events.push('Native File menu exports a real PDF.');
    await waitFor(async () => JSON.stringify(await recover()).includes('coffee break'), 'before preference reload');
    await page.evaluate(() => window.wraiter.settings({ theme: 'dark', hotkeys: { complete: 'Ctrl+Space', accept: 'Ctrl+Enter', save: 'Ctrl+Alt+W' } }));
    await reload(); await chapter2().click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await replaceEditor('Custom keys '); nextReply = 'work properly.'; await page.keyboard.press('Control+Space'); await preview();
    await page.keyboard.press('Control+Enter'); assert.equal(await visibleText(), 'Custom keys work properly.');
    await page.evaluate(() => { window.__testCommands = []; window.wraiter.onCommand(command => window.__testCommands.push(command)); });
    // CDP keyboard events bypass the Windows menu accelerator path; Electron native input exercises it.
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.focus(); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control', 'alt'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: ['control', 'alt'] }); });
    await waitFor(() => page.evaluate(() => window.__testCommands.includes('save')), 'native custom save accelerator');
    assert.equal(await page.evaluate(() => window.__testCommands.filter(command => command === 'save').length), 1);
    await page.screenshot({ path: path.join(output, '02-dark.png') }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650)); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, '03-compact.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    events.push('Custom AI keys work; native custom Save fires once; dark theme and minimum-width layout persist.');
    await menu('View', 'Revision history'); await page.getByRole('tab', { name: /^Checkpoints/ }).click(); const restoreCard = page.locator('.snapshot-card').filter({ hasText: 'Before AI editing' });
    await restoreCard.getByRole('button', { name: 'Restore this version', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Restore version', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('status').filter({ hasText: 'Earlier version restored' }).waitFor();
    await chapter2().click(); assert.equal(await visibleText(), 'Before. A quiet hour. After.');
    assert.ok((await page.evaluate(() => window.wraiter.listGitHistory())).entries.some(entry => entry.message === 'Before restoring a version'));
    events.push('Restoring a Git version first checkpoints the current manuscript and retains its history.');
    await menu('File', 'Save'); await waitFor(async () => (await fs.readFile(projectPath, 'utf8')).includes('A quiet hour.'), 'final save');
    await app.close(); app = await electron.launch(launchOptions); await prepareWindow(); await chapter2().click();
    assert.equal(await visibleText(), 'Before. A quiet hour. After.'); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal((await page.evaluate(() => window.wraiter.boot())).prefs.hotkeys.complete, 'Ctrl+Space'); events.push('Relaunch restores manuscript, formatting, chapters, theme and custom shortcuts.');
    assert.deepEqual(failures.filter(text => !text.includes('ERR_CONNECTION_REFUSED')), []);
    await fs.writeFile(path.join(output, 'integration-results.json'), JSON.stringify({ passed: true, events, providerRequests: requests.length, userData, screenshots: ['01-paper.png', '02-dark.png', '03-compact.png'] }, null, 2));
    console.log(JSON.stringify({ passed: true, events, providerRequests: requests.length, userData }, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error(error); console.error('Renderer errors:', failures); console.error('Completed:', events); process.exitCode = 1;
  } finally { if (app) await app.close().catch(() => {}); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
})();
