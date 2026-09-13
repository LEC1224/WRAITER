// WRAITER 0.3 desktop workflows using synthetic prose and a local model stub.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const JSZip = require('jszip');
const { defaults } = require('../electron/preferences.cjs');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (fn, label, timeout = 20000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await fn()) return; } catch {} await pause(100); } throw new Error(`Timed out: ${label}`); };
const textOf = node => node.type === 'text' ? node.text : (node.content || []).map(textOf).join(node.type === 'doc' ? '\n' : '');
const run = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const paragraph = (...content) => ({ type: 'paragraph', content });
const fixture = () => ({ format: 'wraiter', version: 1, id: 'v03-desktop-synthetic', title: 'V03 synthetic manuscript', subtitle: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), language: 'en-US', layout: 'story', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, chapters: [{ id: 'first', title: 'First chapter', status: 'Draft', content: { type: 'doc', content: [paragraph(run('Alpha  '), run('first', [{ type: 'bold' }]), run(' paragraph.')), paragraph(run('Another  sentence.'))] } }, { id: 'second', title: 'Second chapter', status: 'Draft', content: { type: 'doc', content: [paragraph(run('Other   '), run('second', [{ type: 'italic' }]), run(' chapter.'))] } }], notes: 'PRIVATE_NOTE_SENTINEL', style: '', references: [], snapshots: [] });
const envelope = (tools = [], message = 'Removed 3 repeated-space runs across both chapters.') => JSON.stringify({ message, done: tools.length === 0, tools });

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'v03-desktop-')); const requests = [], failures = [], passed = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ models: [{ name: 'mock-agent' }] }));
    let body = ''; for await (const part of req) body += part;
    const request = JSON.parse(body); requests.push(request); const prompt = request.prompt || request.messages?.map(item => item.content).join('\n') || '';
    let reply;
    if (!prompt.includes('CURRENT TOOL RESULTS:')) reply = 'A local test continuation.';
    else if (prompt.includes('"tool":"normalize_spaces"')) reply = envelope();
    else reply = envelope([{ name: 'normalize_spaces', arguments: {} }], 'Removing repeated spaces throughout the manuscript.');
    res.end(JSON.stringify(req.url === '/api/generate' ? { response: reply } : { message: { content: JSON.stringify({ completion: reply }) } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ...defaults, enabled: true, continuous: false, provider: 'ollama', model: 'mock-agent', baseUrl, ollamaMode: 'raw', taskProfiles: { chat: { provider: 'ollama', baseUrl, model: 'mock-agent' } }, keys: {} }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture(), path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app, page, editor;
  const recover = async () => JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
  const boot = () => page.evaluate(() => window.wraiter.boot());
  const launch = async () => { app = await electron.launch(launchOptions); page = await app.firstWindow(); editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); page.on('pageerror', error => failures.push(error.message)); await editor.waitFor({ timeout: 30000 }); };
  const menu = async (group, label) => app.evaluate(({ Menu }, [group, label]) => { const section = Menu.getApplicationMenu().items.find(item => item.label.replaceAll('&', '') === group); const item = section?.submenu.items.find(item => item.label.replaceAll('&', '') === label); if (!item) throw new Error(`Missing menu item ${group} > ${label}`); item.click(); }, [group, label]);
  const destination = target => app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, target);
  const chapter = title => page.locator('.chapter-select').filter({ hasText: title });
  const selectText = async value => {
    await editor.evaluate((element, value) => {
      element.focus(); const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = []; while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.ghost-text,.ai-loading')) nodes.push(walker.currentNode);
      const full = nodes.map(node => node.textContent).join(''); const start = full.indexOf(value), end = start + value.length; if (start < 0) throw new Error('Missing selection text');
      const range = document.createRange(); let offset = 0, began = false;
      for (const node of nodes) { const length = node.textContent.length; if (!began && start <= offset + length) { range.setStart(node, start - offset); began = true; } if (began && end <= offset + length) { range.setEnd(node, end - offset); break; } offset += length; }
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, value); await pause(100);
  };
  const exportFile = async (format, scope, filename) => {
    const target = path.join(userData, filename); await destination(target); await menu('File', 'Export…');
    await page.getByRole('combobox', { name: 'Export scope', exact: true }).selectOption(scope); await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption(format);
    await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click(); await waitFor(async () => (await fs.stat(target)).size > 0, `${format} ${scope} export`);
    // Informational format-fidelity notices are allowed, and must be dismissed
    // before the next real native-menu workflow.
    const closeNotice = page.getByRole('dialog').getByRole('button', { name: /^(Close(?: dialog)?|OK|Got it|Continue writing)$/ }); if (await closeNotice.count()) await closeNotice.first().click();
    return target;
  };
  try {
    await launch(); await chapter('First chapter').click();
    assert.equal(await page.getByRole('combobox', { name: 'Document layout', exact: true }).inputValue(), 'story');
    assert.equal(await page.locator('.chapter-meta').isVisible(), false);
    await page.getByRole('combobox', { name: 'Document layout', exact: true }).selectOption('article'); await page.locator('.chapter-meta').waitFor(); assert.match(await page.locator('.chapter-meta').innerText(), /words|read|min/i);
    await page.getByRole('combobox', { name: 'Document layout', exact: true }).selectOption('story'); assert.equal(await page.locator('.chapter-meta').isVisible(), false);
    passed.push('Story layout hides chapter statistics; Article enables word count and reading time.');
    await selectText('first'); await page.getByRole('combobox', { name: 'Font family', exact: true }).click(); await page.getByRole('textbox', { name: 'Search fonts', exact: true }).fill('Arial');
    const fontOption = page.getByRole('option', { name: /^Arial Aa$/ }); await fontOption.waitFor(); assert.match(await fontOption.evaluate(element => getComputedStyle(element).fontFamily), /Arial/);
    await fontOption.click(); await waitFor(async () => JSON.stringify((await recover()).chapters[0]).includes('Arial'), 'font preference applied to manuscript selection');
    passed.push('Font picker renders installed font names in their actual fonts and applies the selection.');
    await editor.click(); await page.keyboard.press('Control+End'); await menu('View', 'Writing assistant');
    await page.getByRole('textbox', { name: 'Ask the writing assistant', exact: true }).fill('Remove double spaces throughout the manuscript.');
    await page.getByRole('button', { name: 'Send writing question', exact: true }).click();
    await page.locator('.chat-message.assistant').filter({ hasText: 'Removed 3 repeated-space runs' }).waitFor({ timeout: 30000 });
    await waitFor(async () => { const value = await recover(); return textOf(value.chapters[0].content) === 'Alpha first paragraph.\nAnother sentence.' && textOf(value.chapters[1].content) === 'Other second chapter.'; }, 'agent edits every chapter');
    const changed = await recover(); assert.ok(JSON.stringify(changed.chapters[0]).includes('"bold"')); assert.ok(JSON.stringify(changed.chapters[0]).includes('Arial')); assert.ok(JSON.stringify(changed.chapters[1]).includes('"italic"'));
    assert.equal(requests.length, 2); assert.ok(requests.every(request => request.model === 'mock-agent')); assert.ok(!JSON.stringify(requests).includes('PRIVATE_NOTE_SENTINEL'));
    const editHistory = await page.evaluate(id => window.wraiter.loadEditHistory(id), changed.id); const entry = editHistory.events.filter(event => event.kind === 'edit').at(-1);
    assert.equal(entry.entry.kind, 'project'); assert.match(entry.entry.label, /assistant|AI|Remove double/i);
    await page.screenshot({ path: path.join(output, 'v03-agent-edits.png') }); passed.push('Agent chat executes and reports manuscript-wide edits while preserving rich formatting.');
    await editor.click(); await page.keyboard.press('Control+z');
    await waitFor(async () => { const value = await recover(); return textOf(value.chapters[0].content).includes('Alpha  first') && textOf(value.chapters[1].content).includes('Other   second'); }, 'one undo restores all agent edits');
    await app.close(); app = null; await launch(); await chapter('First chapter').click(); await editor.click(); await page.keyboard.press('Control+y');
    await waitFor(async () => { const value = await recover(); return textOf(value.chapters[0].content).includes('Alpha first') && textOf(value.chapters[1].content).includes('Other second'); }, 'redo survives process restart');
    passed.push('One Ctrl+Z reverses the entire agent operation; Ctrl+Y reapplies it after restarting WRAITER.');
    await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('xyz', { delay: 45 });
    await page.keyboard.press('Control+z'); await waitFor(async () => textOf((await recover()).chapters[0].content).endsWith('xy'), 'atomic character undo');
    await app.close(); app = null; await launch(); await chapter('First chapter').click(); await editor.click(); await page.keyboard.press('Control+y');
    await waitFor(async () => textOf((await recover()).chapters[0].content).endsWith('xyz'), 'typed-character redo across sessions');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await waitFor(async () => textOf((await recover()).chapters[0].content).endsWith('Another sentence.'), 'typing test restored');
    passed.push('Individual typing transactions remain undoable and redoable between sessions.');
    const selectionText = 'first'; await selectText(selectionText); const selected = await exportFile('bbcode', 'selection', 'Selected - BBCode.txt');
    const bbcode = await fs.readFile(selected, 'utf8'); assert.match(bbcode, /\[b\]first\[\/b\]/); assert.ok(!bbcode.includes('Alpha') && !bbcode.includes('Other'));
    const current = await exportFile('txt', 'chapter', 'One chapter.txt'); const currentText = await fs.readFile(current, 'utf8'); assert.ok(currentText.includes('Alpha first paragraph.') && !currentText.includes('Other second chapter.'));
    const full = await exportFile('txt', 'manuscript', 'Full manuscript.txt'); const fullText = await fs.readFile(full, 'utf8'); assert.ok(fullText.includes('Alpha first paragraph.') && fullText.includes('Other second chapter.'));
    passed.push('Exports support selected text, one chapter, and the full manuscript; BBCode retains inline emphasis.');
    for (const [format, filename] of [['pdf', 'Standard.pdf'], ['pdf-desktop', 'Desktop.pdf'], ['pdf-mobile', 'Mobile.pdf']]) {
      const target = await exportFile(format, 'manuscript', filename); assert.equal((await fs.readFile(target)).subarray(0, 4).toString(), '%PDF');
    }
    const epub = await exportFile('epub', 'manuscript', 'Manuscript.epub'); const archive = await JSZip.loadAsync(await fs.readFile(epub)); assert.equal(await archive.file('mimetype').async('string'), 'application/epub+zip'); assert.ok(archive.file('META-INF/container.xml'));
    passed.push('Standard, desktop, and mobile PDF exports create real PDFs; EPUB has a valid publication container.');
    const odt = path.join(userData, 'Native manuscript.odt'); await destination(odt); await menu('File', 'Save as…'); await waitFor(async () => (await boot()).binding?.format === 'odt' && (await fs.stat(odt)).size > 0, 'native ODT binding');
    let office = await JSZip.loadAsync(await fs.readFile(odt)); assert.ok((await office.file('content.xml').async('string')).includes('Alpha'));
    await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' Saved to ODT.'); await menu('File', 'Save');
    await waitFor(async () => (await (await JSZip.loadAsync(await fs.readFile(odt))).file('content.xml').async('string')).replace(/<text:s\b[^>]*\/>/g, ' ').includes('Saved to ODT.'), 'native ODT save back');
    assert.equal((await boot()).path, odt); assert.ok((await fs.stat(`${odt}.bak`)).size > 0);
    const docx = path.join(userData, 'Native manuscript.docx'); await destination(docx); await menu('File', 'Save as…'); await waitFor(async () => (await boot()).binding?.format === 'docx' && (await fs.stat(docx)).size > 0, 'native DOCX binding');
    office = await JSZip.loadAsync(await fs.readFile(docx)); assert.ok((await office.file('word/document.xml').async('string')).includes('Saved to ODT.'));
    await app.close(); app = null; await launch(); assert.equal((await boot()).binding.format, 'docx'); assert.equal((await boot()).path, docx);
    passed.push('Native ODT saves stay ODT, Save As converts to DOCX, and the native file remains bound after restart.');
    await page.screenshot({ path: path.join(output, 'v03-writer-story.png') });
    assert.deepEqual(failures, []);
    const result = { passed: true, checks: passed, providerRequests: requests.length, userData }; await fs.writeFile(path.join(output, 'v03-app-results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'v03-failure.png') }).catch(() => {}); console.error(error); console.error('Completed:', passed); console.error('Renderer errors:', failures); process.exitCode = 1;
  } finally { if (app) await app.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})();
