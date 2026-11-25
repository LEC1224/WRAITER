// Long-running local grammar exercise using only an isolated synthetic profile.
// node tests/offline-grammar-soak-ui.cjs --minutes=180
// WRAITER_EXECUTABLE optionally points at the packaged app.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const minutes = Number(process.argv.find(arg => arg.startsWith('--minutes='))?.slice(10) || 10);
assert.ok(Number.isFinite(minutes) && minutes > 0 && minutes <= 300, 'Choose 0–300 minutes.');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 45000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) {
    try { if (await check()) return; } catch (error) { last = error; }
    await delay(150);
  }
  throw new Error(`${label}${last ? ': ' + last.message : ''}`);
}

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'offline-grammar-soak-'));
  const file = path.join(profile, 'Synthetic grammar endurance.wraiter');
  const project = { format: 'wraiter', version: 1, id: 'grammar-endurance', title: 'Synthetic grammar endurance', language: 'en-US', notes: '', style: '', references: [], snapshots: [],
    chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: Array.from({ length: 80 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: index ? `The quiet river crossed the wide valley at sunset, beside the old stone bridge. Passage ${index}.` : 'The dogs run home with a friend.' }] })) } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true, spellcheck: true, startup: 'new', pageMode: 'continuous' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env, timeout: 60000 } : { args: [root, file], env, timeout: 60000 });
  let app, page, editor, cdp; const errors = [], samples = []; let cycles = 0, launches = 0;
  const started = Date.now(), deadline = started + minutes * 60000;
  async function connect() {
    app = await launch(); page = await app.firstWindow(); launches++;
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.hide(); window.webContents.setBackgroundThrottling(false);
      global.grammarNetworkRequests = [];
      window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        if (/^https?:/i.test(details.url)) { global.grammarNetworkRequests.push(details.url); callback({ cancel: true }); }
        else callback({});
      });
    });
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ state: 'attached' });
    await waitFor(async () => await editor.locator(':scope > p').count() === 80, 'Synthetic chapter did not open');
    cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  }
  async function stop() {
    if (!app) return;
    try { await page.evaluate(() => window.wraiter.finishClose()); } catch {}
    await app.close(); app = undefined;
  }
  async function sample() {
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
    const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, workingSetKB: item.memory.workingSetSize, privateKB: item.memory.privateBytes })));
    samples.push({ elapsedMs: Date.now() - started, cycles, launches, heapBytes: heap.usedSize, nodes: metrics.Nodes, documents: metrics.Documents, listeners: metrics.JSEventListeners, processes });
  }
  async function report(status, error) {
    const result = { status, minutesRequested: minutes, elapsedMs: Date.now() - started, cycles, launches, profile, executable: process.env.WRAITER_EXECUTABLE || 'development Electron', samples, errors, ...(error ? { failure: error.message } : {}) };
    await fs.writeFile(path.join(profile, 'report.json'), JSON.stringify(result, null, 2));
  }
  try {
    await connect(); await sample();
    while (Date.now() < deadline || !cycles) {
      const number = cycles + 1;
      const wrong = `🙂 She walk home. The dogs runs past a freind. Passage ${number}.`;
      const right = `🙂 She walks home. The dogs run past a friend. Passage ${number}.`;
      const replace = text => editor.evaluate((element, text) => {
        const current = element.editor, first = current.state.doc.firstChild;
        current.view.dispatch(current.state.tr.insertText(text, 1, first.nodeSize - 1));
      }, text);
      const first = editor.locator(':scope > p').first();
      const findings = async () => first.evaluate(element => [...element.querySelectorAll('.local-grammar-hint, .local-spelling-hint')].map(item => item.textContent));
      await replace(wrong);
      try {
        await waitFor(async () => { const current = await findings(); return ['walk', 'runs', 'freind'].every(text => current.includes(text)); }, 'Offline grammar and spelling did not complete');
      } catch (error) {
        error.message += `; text=${JSON.stringify(await first.innerText())}; hints=${JSON.stringify(await findings())}; state=${JSON.stringify(await editor.evaluate(element => {
          const current = element.editor, plugin = current.state.plugins.find(item => item.key.startsWith('localGrammar$'));
          const state = plugin?.getState(current.state);
          return state && { status: state.status, error: state.error, count: state.allHints?.length, hints: state.allHints?.slice(0, 10).map(hint => [hint.original, hint.rule]) };
        }))}`;
        throw error;
      }
      await replace(right);
      await waitFor(async () => { const current = await findings(); return !['walk', 'runs', 'freind'].some(text => current.includes(text)); }, 'Stale hints survived replacement');
      assert.equal(await first.innerText(), right, 'Checking must never change text');
      assert.deepEqual(await app.evaluate(() => global.grammarNetworkRequests), [], 'Checking must not request an online service');
      assert.deepEqual(errors, []);
      cycles++;
      if (cycles % 10 === 0) { await sample(); await report('running'); console.log(JSON.stringify({ cycles, elapsedMinutes: Number(((Date.now() - started) / 60000).toFixed(1)), heapMB: Number((samples.at(-1).heapBytes / 1048576).toFixed(1)), profile })); }
      if (cycles % 80 === 0 && Date.now() < deadline) {
        await stop(); await connect(); await sample();
      }
      if (Date.now() < deadline) await delay(Math.min(20000, deadline - Date.now()));
    }
    await sample(); await report('passed');
    console.log(JSON.stringify({ passed: true, cycles, launches, elapsedMinutes: Number(((Date.now() - started) / 60000).toFixed(1)), profile }));
  } catch (error) { await report('failed', error).catch(() => {}); throw error; }
  finally { await stop().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
