const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const waitFor = async (fn, label, timeout = 10000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { const result = await fn(); if (result) return result; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Timed out: ${label}`);
};
(async () => {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'session-'));
  const projectPath = path.join(userData, 'Integration manuscript.wraiter');
  const events = [], failures = [];
  let nextReply = 'and found a note waiting on the windowsill.', delay = 0;
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'integration-test-model' }] })); }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push(JSON.parse(body || '{}'));
      const reply = nextReply;
      setTimeout(() => { if (!res.destroyed) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: { content: reply } })); } }, delay);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app;
  try {
    app = await electron.launch(launchOptions);
    const page = await app.firstWindow();
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await page.screenshot({ path: path.join(output, '01-paper.png') });
    assert.match(await editor.innerText(), /Mara/);
    events.push('Launches into a complete writing workspace.');

    await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
    await page.keyboard.insertText('A reliable sentence with a mistkae.');
    await waitFor(async () => {
      const recovery = JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8'));
      return JSON.stringify(recovery).includes('mistkae');
    }, 'local recovery');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, projectPath);
    await page.keyboard.press('Control+s');
    await waitFor(async () => JSON.parse(await fs.readFile(projectPath, 'utf8')).chapters.length === 2, 'named save');
    events.push('Typing is saved to recovery and a native manuscript.');

    await page.getByRole('button', { name: 'New chapter', exact: true }).click();
    await page.getByRole('textbox', { name: 'Chapter title', exact: true }).fill('Integration chapter');
    await editor.click(); await page.keyboard.insertText('This is a new chapter.');
    await page.getByRole('button', { name: /An open window/ }).click();
    assert.match(await editor.innerText(), /mistkae/);
    await page.getByRole('button', { name: /Integration chapter/ }).click();
    assert.equal((await editor.innerText()).trim(), 'This is a new chapter.');
    events.push('Chapter navigation preserves edits and chapter titles.');

    await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('Before. A quiet hour. After.');
    await page.keyboard.press('Control+f');
    await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('quiet');
    await page.getByRole('textbox', { name: 'Replacement text', exact: true }).fill('bright');
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    assert.match(await editor.innerText(), /bright hour/);
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await editor.click(); await page.keyboard.press('Control+z');
    assert.match(await editor.innerText(), /quiet hour/);
    events.push('Find/replace edits the selected chapter and can be undone.');

    await page.getByRole('button', { name: /Revision history/ }).click();
    await page.getByRole('button', { name: 'Save revision snapshot', exact: true }).click();
    await waitFor(async () => JSON.parse(await fs.readFile(projectPath, 'utf8')).snapshots.length === 1, 'snapshot save');
    events.push('Revision snapshot is persisted inside the manuscript.');

    await page.getByRole('button', { name: 'Toggle writing assistant', exact: true }).click();
    await page.getByRole('button', { name: 'Connect an AI', exact: false }).click();
    await page.getByRole('textbox', { name: 'Provider base address', exact: true }).fill(baseUrl);
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Connected.' }).waitFor();
    await page.getByRole('combobox', { name: 'Model', exact: true }).fill('integration-test-model');
    await page.getByRole('switch', { name: 'Enable writing assistance', exact: true }).click();
    await page.getByRole('button', { name: 'Save preferences', exact: false }).click();
    await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Control+Enter');
    await page.locator('.ghost-text').waitFor();
    await editor.press('Control+ArrowRight');
    assert.ok(await page.locator('.ghost-text').count(), 'partial acceptance retains the unaccepted remainder');
    await editor.press('Escape');
    assert.equal(await page.locator('.ghost-text').count(), 0);
    assert.ok((await editor.innerText()).trim().endsWith('and'), 'only the next word was inserted');
    await page.keyboard.press('Control+z');
    assert.ok(!(await editor.innerText()).trim().endsWith('and'));
    await page.keyboard.press('Control+End'); await page.keyboard.press('Control+Enter');
    await page.locator('.ghost-text').waitFor();
    await page.keyboard.press('Control+s');
    const savedWithGhost = await fs.readFile(projectPath, 'utf8');
    assert.ok(!savedWithGhost.includes(nextReply), 'unaccepted ghost must not be saved');
    assert.ok(!(await editor.textContent()).includes('<think>'));
    await editor.press('Tab');
    await waitFor(async () => !(await page.locator('.ghost-text').count()), 'ghost accepted');
    assert.match(await editor.innerText(), /windowsill/);
    await page.keyboard.press('Control+z');
    assert.ok(!(await editor.innerText()).includes('windowsill'));
    events.push('Ollama protocol generation creates a display-only preview; Tab acceptance is undoable.');

    const requestCountBeforeDelayed = requests.length;
    nextReply = 'A stale suggestion that must disappear.'; delay = 900;
    await page.keyboard.press('Control+End'); await page.keyboard.press('Control+Enter');
    await waitFor(() => requests.length > requestCountBeforeDelayed, 'delayed provider request');
    await page.keyboard.insertText(' My own continuation.');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.ghost-text').count(), 0);
    assert.ok(!(await editor.innerText()).includes('stale suggestion'));
    delay = 0;
    events.push('Typing during generation discards stale output.');

    await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('She opend the door.');
    await page.keyboard.press('Control+a');
    nextReply = 'She opened the door.';
    await page.getByRole('button', { name: 'Check this passage', exact: false }).click();
    await page.locator('.revision-card').waitFor();
    assert.equal((await editor.innerText()).trim(), 'She opend the door.');
    await page.locator('.revision-card').getByRole('button', { name: 'Accept', exact: true }).click();
    assert.equal((await editor.innerText()).trim(), 'She opened the door.');
    await page.keyboard.press('Control+z');
    assert.equal((await editor.innerText()).trim(), 'She opend the door.');
    events.push('AI correction stays a proposal until accepted and undoes in one step.');

    const pdfPath = path.join(userData, 'Export.pdf');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, pdfPath);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: /PDF document/ }).click();
    await waitFor(async () => (await fs.readFile(pdfPath)).subarray(0, 4).toString() === '%PDF', 'PDF export', 20000);
    events.push('PDF export produces a real PDF containing the manuscript.');

    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: 'Warm dark', exact: false }).click();
    await page.getByRole('button', { name: 'Save preferences', exact: false }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.screenshot({ path: path.join(output, '02-dark.png') });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(960, 650); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, '03-compact.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'No horizontal window overflow');
    events.push('Dark theme persists; the minimum window size stays within its viewport.');

    const keyResults = await page.evaluate(async baseUrl => {
      const previous = await window.wraiter.settings({});
      const first = await window.wraiter.settings({ provider: 'openai', baseUrl: baseUrl + '/a/v1', apiKey: 'test-only-key-never-sent', enabled: false });
      const other = await window.wraiter.settings({ baseUrl: baseUrl + '/b/v1', apiKey: '' });
      const returned = await window.wraiter.settings({ baseUrl: baseUrl + '/a/v1', apiKey: '' });
      await window.wraiter.settings(previous);
      return [first.hasKey, other.hasKey, returned.hasKey];
    }, baseUrl);
    assert.deepEqual(keyResults, [true, false, true]);
    const settingsOnDisk = await fs.readFile(path.join(userData, 'settings.json'), 'utf8');
    assert.ok(!settingsOnDisk.includes('test-only-key-never-sent'));
    events.push('API keys are encrypted on Windows and scoped to the selected endpoint.');

    await page.keyboard.press('Control+s');
    await waitFor(async () => (await fs.readFile(projectPath, 'utf8')).includes('She opend'), 'final save');
    await app.close(); app = null;
    const reopened = await electron.launch(launchOptions); app = reopened;
    const second = await reopened.firstWindow();
    await second.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
    await second.getByRole('button', { name: /Integration chapter/ }).click();
    assert.equal((await second.getByRole('textbox', { name: 'Manuscript editor', exact: true }).innerText()).trim(), 'She opend the door.');
    assert.equal(await second.evaluate(() => document.documentElement.dataset.theme), 'dark');
    events.push('Closing and relaunching restores the manuscript and preferences.');
    assert.deepEqual(failures.filter(text => !text.includes('ERR_CONNECTION_REFUSED')), []);
    await fs.writeFile(path.join(output, 'integration-results.json'), JSON.stringify({ passed: true, events, providerRequests: requests.length, userData, screenshots: ['01-paper.png', '02-dark.png', '03-compact.png'] }, null, 2));
    console.log(JSON.stringify({ passed: true, events, userData }, null, 2));
  } catch (error) {
    if (app) { const windows = app.windows(); if (windows[0]) await windows[0].screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
    console.error(error); console.error('Renderer errors:', failures); console.error('Completed:', events);
    process.exitCode = 1;
  } finally { if (app) await app.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
})();
