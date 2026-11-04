const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'inline-grammar-ipc-'));
  const project = { format: 'wraiter', version: 1, id: 'inline-ipc', title: 'PRIVATE TITLE', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, notes: 'PRIVATE NOTES', style: '', references: [], snapshots: [], chapters: [{ id: 'one', title: 'PRIVATE CHAPTER', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A sample sentence.' }] }] } }] };
  let count = 0, firstSeen, secondSeen, finishSecond, seenPrompt = '';
  const first = new Promise(resolve => { firstSeen = resolve; }), second = new Promise(resolve => { secondSeen = resolve; });
  const reply = res => { if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }] })); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify({ data: [] })); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); count++;
    if (count === 1) { seenPrompt = JSON.stringify(payload); firstSeen(); return; }
    if (count === 2) { finishSecond = () => reply(res); secondSeen(); return; }
    reply(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: true, aiGrammar: false, provider: 'compatible', baseUrl, model: 'test', taskProfiles: { proofread: { provider: 'compatible', baseUrl, model: 'test' } }, keys: {} }));
  await fs.writeFile(path.join(profile, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ args: [root], env, timeout: 60000 }); const page = await app.firstWindow();
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
    const make = id => ({ id, projectId: 'inline-ipc', scope: 'selection', language: 'en-US', style: 'PRIVATE VOICE', passages: [{ id: 'p1', chapterTitle: 'PRIVATE CHAPTER', paragraph: 1, text: 'A sample sentence.' }] });
    assert.deepEqual(await page.evaluate(request => window.wraiter.inlineGrammar(request), make('disabled')), { skipped: true }); assert.equal(count, 0);
    await page.evaluate(() => window.wraiter.settings({ aiGrammar: true }));
    await page.evaluate(request => { window.__inlinePending = window.wraiter.inlineGrammar(request); }, make('inline-1'));
    await first;
    await page.evaluate(request => { window.__manualPending = window.wraiter.proofread(request); }, make('manual-1'));
    await second;
    assert.deepEqual(await page.evaluate(() => window.__inlinePending), { skipped: true });
    assert.equal(await page.evaluate(() => window.wraiter.cancelInlineGrammar('manual-1')), false);
    assert.deepEqual(await page.evaluate(request => window.wraiter.inlineGrammar(request), make('busy')), { skipped: true });
    finishSecond(); assert.deepEqual(await page.evaluate(() => window.__manualPending), { findings: [] });
    assert.ok(!seenPrompt.includes('PRIVATE CHAPTER') && !seenPrompt.includes('PRIVATE VOICE') && !seenPrompt.includes('PRIVATE NOTES'));
    console.log('Inline grammar opt-in, privacy, foreground priority and scoped cancellation passed.');
  } finally { await app?.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
