const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, description) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(description);
}

(async () => {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'tab-cancellation-'));
  const project = { format: 'wraiter', version: 1, id: 'test-origin', title: 'Origin', language: 'en-US',
    chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original text.' }] }] } }] };
  await fs.writeFile(path.join(profile, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true,
    enabled: true, continuous: false, localGrammar: false, aiGrammar: false, spellcheck: false, provider: 'ollama',
    baseUrl: 'http://127.0.0.1:1', model: 'mock', ollamaMode: 'raw' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch(process.env.WRAITER_EXECUTABLE
    ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env } : { args: [root], env });
  let page;
  try {
    page = await app.firstWindow();
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor();
    await app.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.hide(); win.webContents.setBackgroundThrottling(false);
      const path = process.getBuiltinModule('node:path');
      const load = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'electron', 'main.cjs'));
      const providers = load('./providers.cjs'), { CodexBridge } = load('./codex-bridge.cjs');
      const probe = globalThis.tabProvider = { calls: 0, interrupted: false };
      providers.generate = async (settings, key, request, signal) => {
        probe.calls++;
        const bridge = new CodexBridge('fixture');
        bridge.rpc = method => {
          if (method === 'turn/start') return new Promise(resolve => { probe.acknowledge = () => resolve({ turn: { id: 'turn' } }); });
          if (method !== 'turn/interrupt') throw new Error('Unexpected mock RPC: ' + method);
          probe.interrupted = true;
          return Promise.resolve({});
        };
        signal.addEventListener('abort', () => { probe.aborted = true; }, { once: true });
        try { await bridge.runTurn('thread', {}, { user: 'Synthetic' }, signal); }
        catch (error) { if (!signal.aborted) throw error; }
        return 'STALE_PROVIDER_RESULT';
      };
      providers.generateStructured = (settings, key, prompt, signal) => new Promise(resolve => {
        signal.addEventListener('abort', () => { probe.inlineAborted = true; }, { once: true });
        probe.releaseInline = () => resolve('{"findings":[]}');
      });
    });
    const tabs = page.getByRole('tablist', { name: 'Open projects' });
    const clickTab = name => tabs.getByRole('tab', { name, exact: true }).evaluate(button => button.click());
    const active = name => waitFor(async () =>
      await tabs.getByRole('tab', { name, exact: true }).getAttribute('aria-selected') === 'true' &&
      !(await page.locator('.workspace').evaluate(element => element.inert)), 'Tab remained blocked: ' + name);
    const command = value => app.evaluate(({ BrowserWindow }, value) =>
      BrowserWindow.getAllWindows()[0].webContents.send('command', value), value);
    await page.getByRole('button', { name: 'New project tab' }).evaluate(button => button.click());
    await active('Untitled manuscript');
    await clickTab('Origin'); await active('Origin');
    await editor.evaluate(element => { element.editor.commands.focus('end'); element.editor.commands.insertContent(' Outgoing edit.'); });
    await command('complete');
    await waitFor(() => app.evaluate(() => !!globalThis.tabProvider.acknowledge), 'Turn never reached the mock transport');
    await clickTab('Untitled manuscript');
    await active('Untitled manuscript');
    assert.equal(await app.evaluate(() => globalThis.tabProvider.aborted), true);
    await editor.evaluate(element => element.editor.commands.insertContent('Destination edit.'));
    assert.equal(await editor.innerText(), 'Destination edit.');
    await page.evaluate(() => { window.cancelDone = false; window.cancelled = window.wraiter.cancel().then(() => { window.cancelDone = true; }); });
    const request = { id: 'parallel', mode: 'continue', before: 'Content', after: '', selection: '', words: 8, contextWords: 300 };
    await assert.rejects(page.evaluate(request => window.wraiter.generate(request), request), /already running/);
    assert.equal(await page.evaluate(() => window.cancelDone), false);
    await page.evaluate(() => window.wraiter.rememberProjectView({}));
    await app.evaluate(() => globalThis.tabProvider.acknowledge());
    await page.evaluate(() => window.cancelled);
    assert.equal(await app.evaluate(() => globalThis.tabProvider.interrupted), true);
    assert.equal(await page.locator('.ghost-text').count(), 0);
    await clickTab('Origin'); await active('Origin');
    assert.equal(await editor.innerText(), 'Original text. Outgoing edit.');

    // Queue a continuation behind an inline check whose teardown is slow. Both
    // the old check and the waiting continuation belong to the outgoing tab.
    await page.evaluate(() => window.wraiter.settings({ aiGrammar: true }));
    await page.evaluate(() => {
      window.heldInline = window.wraiter.inlineGrammar({ id: 'inline', projectId: 'test-origin', scope: 'selection',
        language: 'en-US', passages: [{ id: 'p1', chapterTitle: 'First', paragraph: 1, text: 'Original text.' }] });
    });
    await waitFor(() => app.evaluate(() => !!globalThis.tabProvider.releaseInline), 'Inline check never started');
    await page.evaluate(request => {
      window.queuedOutcome = window.wraiter.generate(request).then(() => 'accepted', error => error.message);
    }, { ...request, id: 'queued' });
    await waitFor(() => app.evaluate(() => !!globalThis.tabProvider.inlineAborted), 'Foreground reservation did not preempt inline checking');
    await clickTab('Untitled manuscript'); await active('Untitled manuscript');
    await app.evaluate(() => globalThis.tabProvider.releaseInline());
    assert.deepEqual(await page.evaluate(() => window.heldInline), { skipped: true });
    assert.match(await page.evaluate(() => window.queuedOutcome), /cancelled/i);
    assert.equal(await app.evaluate(() => globalThis.tabProvider.calls), 1);
    assert.equal(await editor.innerText(), 'Destination edit.');
    console.log(JSON.stringify({ passed: true, profile }));
  } finally {
    await app.evaluate(() => { globalThis.tabProvider?.acknowledge?.(); globalThis.tabProvider?.releaseInline?.(); }).catch(() => {});
    await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {});
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
