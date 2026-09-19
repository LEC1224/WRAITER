const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'desktop-ipc-'));
  const requests = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    let data = ''; req.on('data', bytes => { data += bytes; }); req.on('end', () => {
      requests.push({ body: JSON.parse(data), authorization: req.headers.authorization });
      res.end(JSON.stringify({ choices: [{ message: { content: 'A revised passage.' } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [root], env, timeout: 60000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.wraiter));
    const boot = await page.evaluate(() => window.wraiter.boot());
    assert.ok(Array.isArray(boot.availableSpellLanguages));
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => ({ label: item.label, items: item.submenu.items.map(child => ({ label: child.label, accelerator: child.accelerator })) })));
    assert.deepEqual(menu.map(item => item.label), ['&File', '&Edit', '&View', '&Tools', '&Settings', '&Help']);
    const settings = { enabled: true, taskProfiles: Object.fromEntries(['continue', 'correct', 'rewrite', 'chat'].map(task => [task, { provider: 'compatible', baseUrl, model: `mock-${task}` }])), nativeLanguage: 'sv', zoom: 110, apiKeyTask: 'correct', apiKey: 'only-a-local-test-key' };
    const saved = await page.evaluate(value => window.wraiter.settings(value), settings);
    assert.equal(saved.zoom, 110); assert.equal(saved.nativeLanguage, 'sv'); assert.equal(saved.taskHasKey.correct, true);
    assert.equal(saved.keys, undefined); assert.equal(saved.apiKey, undefined);
    for (const mode of ['continue', 'correct', 'rewrite', 'chat']) {
      await page.evaluate(mode => window.wraiter.generate({ id: `test-${mode}`, mode, before: 'A sentence.', selection: 'en mening', instruction: 'Test local routing.', contentLanguage: 'en-GB', words: 15 }), mode);
    }
    assert.deepEqual(requests.map(request => request.body.model), ['mock-continue', 'mock-correct', 'mock-rewrite', 'mock-chat']);
    // Same provider+endpoint intentionally shares one credential across task profiles.
    assert.ok(requests.every(request => request.authorization === 'Bearer only-a-local-test-key'));
    await page.evaluate(() => window.wraiter.settings({ taskProfiles: { correct: { baseUrl: 'http://127.0.0.1:9/v1' } } }));
    const scoped = await page.evaluate(() => window.wraiter.boot());
    assert.equal(scoped.prefs.taskHasKey.correct, false); assert.equal(scoped.prefs.taskHasKey.continue, true);
    const fonts = await page.evaluate(() => window.wraiter.listFonts()); assert.ok(fonts.length > 5); assert.ok(fonts.includes('Georgia'));
    const language = await page.evaluate(() => window.wraiter.setDocumentLanguage('sv-SE')); assert.equal(language.language, 'sv-SE');
    const history = await page.evaluate(() => window.wraiter.listGitHistory()); assert.equal(history.available, true);
    if (history.entries.length) { const prior = await page.evaluate(revision => window.wraiter.getGitRevision(revision), history.entries[0].revision); assert.equal(prior.format, 'wraiter'); }
    console.log('Desktop IPC passed: native menus, per-task model routing, encrypted endpoint-scoped credentials, font enumeration, language selection, Git history. All AI responses came from a local mock server.');
  } finally {
    if (app) {
      try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {}
      await app.close().catch(() => {});
    }
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
