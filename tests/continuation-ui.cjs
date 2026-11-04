// Synthetic manuscript and a local fake Ollama service; no real model or cloud calls.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const { defaults } = require('../electron/preferences.cjs');

const waitFor = async (fn, label, timeout = 15000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${label}`);
};
const manuscriptText = 'Mara paused beside the garden gate. The lantern swung gently as she listened for footsteps along the empty lane.';
const firstContinuation = 'The latch clicked, and a light appeared beyond the hedge.';
const repairedContinuation = 'She followed the narrow path until the lantern came into view.';
const fixture = {
  format: 'wraiter', version: 1, id: 'continuation-ui-synthetic', title: 'Synthetic continuation checks', language: 'en-US',
  chapters: [{ id: 'opening', title: 'Opening', status: 'Draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: manuscriptText }] }] } }],
  notes: '', style: '', references: [], snapshots: []
};
const textOf = node => node.type === 'text' ? node.text : (node.content || []).map(textOf).join(node.type === 'doc' ? '\n' : '');

(async () => {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'continuation-ui-'));
  const requests = [], queued = [], serverErrors = [], pageErrors = [], checks = [];
  const continuationModel = 'continuation-ui-model', checkpointModel = 'checkpoint-ui-model';
  const enqueue = (...replies) => queued.push(...replies.map(reply => typeof reply === 'string' ? { text: reply } : reply));
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/tags') {
      return res.end(JSON.stringify({ models: [{ name: continuationModel }, { name: checkpointModel }] }));
    }
    try {
      let input = '';
      for await (const chunk of req) input += chunk;
      const body = JSON.parse(input);
      if (req.method === 'POST' && req.url === '/api/show') {
        return res.end(JSON.stringify({ model_info: { 'general.architecture': 'synthetic', 'synthetic.context_length': 4096 } }));
      }
      if (req.method !== 'POST' || !['/api/chat', '/api/generate'].includes(req.url)) throw new Error(`Unexpected endpoint: ${req.method} ${req.url}`);
      // Version summaries may run after a real acceptance. They must not consume
      // continuation fixtures or become false positives in the retry assertions.
      if (body.model === checkpointModel) {
        const label = JSON.stringify({ title: 'Synthetic prose added', summary: 'Added a garden detail in Opening.' });
        return res.end(JSON.stringify(req.url === '/api/chat' ? { message: { content: JSON.stringify({ completion: label }) } } : { response: label }));
      }
      if (body.model !== continuationModel) throw new Error(`Unexpected model: ${body.model}`);
      const reply = queued.shift();
      if (!reply) throw new Error('Unexpected extra continuation request.');
      const request = { endpoint: req.url, body, closed: false, finished: false };
      requests.push(request);
      res.on('close', () => { request.closed = true; });
      const finish = () => {
        request.finished = true;
        if (!res.destroyed) res.end(JSON.stringify(req.url === '/api/chat' ? { message: { content: JSON.stringify({ completion: reply.text }) } } : { response: reply.text }));
      };
      if (reply.hold) reply.release = finish;
      else finish();
    } catch (error) {
      serverErrors.push(error.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({
    ...defaults, setupComplete: true, tutorialComplete: true, enabled: true, continuous: false,
    provider: 'ollama', baseUrl, model: continuationModel, ollamaMode: 'auto', spellcheck: false,
    taskProfiles: { checkpoint: { provider: 'ollama', baseUrl, model: checkpointModel } }, keys: {}
  }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, page, editor, stage = 'launch', activeUserData = userData;
  const savedProject = async () => JSON.parse(await fs.readFile(path.join(activeUserData, 'recovery.json'), 'utf8')).project;
  const savedText = async () => textOf((await savedProject()).chapters[0].content);
  const visibleText = () => editor.evaluate(element => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('.ghost-text,.ai-loading').forEach(node => node.remove());
    return copy.textContent;
  });
  const atEnd = async () => { await editor.click(); await editor.press('Control+End'); };
  const preview = async (expected, baseline = manuscriptText) => {
    await page.locator('.ghost-text').waitFor();
    await page.locator('.generation-inline').waitFor({ state: 'hidden' });
    assert.equal((await page.locator('.ghost-text').textContent()).trim(), expected);
    assert.equal(await visibleText(), baseline, 'A ghost suggestion must not edit the manuscript.');
    assert.equal(await savedText(), baseline, 'Recovery must exclude the ghost suggestion.');
  };
  const command = value => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('command', value), value);
  const noticeCommand = (requestId, message) => command(`continuation-notice:${JSON.stringify({ requestId, message })}`);
  const launch = async () => {
    env.WRAITER_USER_DATA = activeUserData;
    app = await electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] }), env, timeout: 60000 });
    page = await app.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor({ timeout: 30000 });
    await page.evaluate(() => {
      window.testContinuationNotices = [];
      window.wraiter.onCommand(command => {
        if (command.startsWith('continuation-notice:')) window.testContinuationNotices.push(JSON.parse(command.slice(20)));
      });
    });
  };
  try {
    await launch();
    assert.equal(await visibleText(), manuscriptText);
    assert.equal(requests.length, 0, 'Opening a manuscript must not generate prose.');

    stage = 'sanitizing and accepting';
    enqueue(`${firstContinuation}TECHNIQUE: This passage uses a mix of narrative and dialogue to build tension.`);
    await atEnd(); await editor.press('Tab'); await preview(firstContinuation);
    assert.equal(requests.length, 1, 'Usable prose with an appended annotation needs no extra generation.');
    assert.doesNotMatch(await page.locator('.ghost-text').textContent(), /TECHNIQUE|This passage uses/);
    await page.screenshot({ path: path.join(output, 'continuation-sanitized-preview.png') });
    await editor.press('Tab');
    await waitFor(async () => await visibleText() === `${manuscriptText} ${firstContinuation}`, 'accepting only sanitized prose');
    await waitFor(async () => await savedText() === `${manuscriptText} ${firstContinuation}`, 'accepted prose recovery');
    assert.equal(await page.locator('.ghost-text').count(), 0);
    await editor.press('Control+z');
    await waitFor(async () => await visibleText() === manuscriptText, 'undo restoring the original manuscript');
    await waitFor(async () => await savedText() === manuscriptText, 'undo recovery');
    checks.push('The actual ghost preview strips a same-paragraph TECHNIQUE annotation; accepting inserts only prose, and Ctrl+Z restores the manuscript.');

    stage = 'retrying a status-only answer';
    let beforeCount = requests.length;
    enqueue('complete', repairedContinuation);
    await atEnd(); await editor.press('Tab'); await preview(repairedContinuation);
    assert.equal(requests.length, beforeCount + 2, 'A status-only answer must receive exactly one automatic retry.');
    assert.doesNotMatch(await page.locator('.ghost-text').textContent(), /\bcomplete\b/i);
    await editor.press('Escape');
    await page.locator('.ghost-text').waitFor({ state: 'hidden' });
    assert.equal(await visibleText(), manuscriptText);
    checks.push('A bare complete answer is retried automatically and only the resulting prose reaches the ghost suggestion.');

    stage = 'rejecting two invalid answers';
    beforeCount = requests.length;
    enqueue('complete', 'TECHNIQUE: This passage uses a mix of narrative and dialogue.');
    await atEnd(); await editor.press('Tab');
    const error = page.locator('.toast[role="status"]').filter({ hasText: /usable.*continuation/i });
    await error.waitFor();
    assert.match(await error.innerText(), /usable.*continuation.*two attempts/i);
    assert.match(await error.innerText(), /another|different model/i);
    await page.locator('.generation-inline').waitFor({ state: 'hidden' });
    assert.equal(requests.length, beforeCount + 2, 'Repeated invalid content must stop after two attempts.');
    assert.equal(await page.locator('.ghost-text').count(), 0);
    assert.equal(await visibleText(), manuscriptText);
    assert.equal(await savedText(), manuscriptText);
    await error.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
    checks.push('Two invalid answers produce a useful error after two attempts, with no ghost or manuscript edit.');

    stage = 'cancelling the retry';
    beforeCount = requests.length;
    const heldReply = { text: 'A late answer must never appear in the manuscript.', hold: true };
    enqueue('complete', heldReply);
    await atEnd(); await editor.press('Tab');
    await waitFor(() => requests.length === beforeCount + 2 && typeof heldReply.release === 'function', 'pending second generation');
    await page.locator('.generation-inline').waitFor();
    assert.equal(await page.locator('.ghost-text').count(), 0, 'The rejected first answer must never flash as a ghost.');
    assert.equal(await visibleText(), manuscriptText);
    await editor.press('Escape');
    await page.locator('.generation-inline').waitFor({ state: 'hidden' });
    await waitFor(() => requests.at(-1).closed, 'cancelling the second HTTP generation');
    heldReply.release();
    await page.waitForTimeout(350);
    assert.equal(requests.length, beforeCount + 2, 'Cancellation must not issue another retry.');
    assert.equal(await page.locator('.ghost-text').count(), 0);
    assert.equal(await page.locator('.toast').count(), 0, 'An explicitly cancelled request must not surface a generation error.');
    assert.equal(await visibleText(), manuscriptText);
    assert.equal(await savedText(), manuscriptText);
    checks.push('Escape cancels the pending retry HTTP request and suppresses late prose without an extra call or document edit.');

    stage = 'rejecting a punctuation-shifted loop';
    beforeCount = requests.length;
    enqueue('“The lantern swung gently,” as she listened for footsteps along the empty lane!', firstContinuation);
    await atEnd(); await editor.press('Tab'); await preview(firstContinuation);
    assert.equal(requests.length, beforeCount + 2, 'Punctuation and quotation changes must not disguise an echoed passage.');
    assert.doesNotMatch(await page.locator('.ghost-text').textContent(), /lantern swung/);
    await editor.press('Escape'); await page.locator('.ghost-text').waitFor({ state: 'hidden' });
    checks.push('An earlier sentence echoed with changed punctuation and quotes is rejected, and a new continuation is shown after one retry.');

    stage = 'reducing long reference and older manuscript context';
    await app.close(); app = null;
    activeUserData = path.join(userData, 'long-context'); await fs.mkdir(activeUserData);
    const earlierText = 'Earlier in the synthetic scene, Mara counted the stones beside the old bridge. '.repeat(600);
    const longManuscriptText = earlierText + manuscriptText;
    const referenceText = 'Synthetic background: the old garden has a gate, a hedge, and a narrow path.\n'.repeat(550);
    const longFixture = {
      ...fixture, id: 'continuation-ui-long-context',
      chapters: [{ ...fixture.chapters[0], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: longManuscriptText }] }] } }],
      references: [{ id: 'garden-reference', name: 'Synthetic garden reference', enabled: true, text: referenceText }, { id: 'disabled-reference', name: 'Disabled synthetic note', enabled: false, text: 'A disabled reference remains disabled.' }]
    };
    const longSettings = { ...defaults, setupComplete: true, tutorialComplete: true, enabled: true, continuous: false, provider: 'ollama', baseUrl, model: continuationModel, ollamaMode: 'auto', spellcheck: false, contextWords: 16000, taskProfiles: { checkpoint: { provider: 'ollama', baseUrl, model: checkpointModel } }, keys: {} };
    await fs.writeFile(path.join(activeUserData, 'settings.json'), JSON.stringify(longSettings));
    await fs.writeFile(path.join(activeUserData, 'recovery.json'), JSON.stringify({ project: longFixture, path: null, expectedHash: null }));
    await launch();
    const originalSettings = await fs.readFile(path.join(activeUserData, 'settings.json'), 'utf8');
    const notice = page.locator('.continuation-notice[role="status"]');
    const contextReply = { text: repairedContinuation, hold: true };
    beforeCount = requests.length; enqueue(contextReply);
    await atEnd(); await editor.press('Tab');
    await waitFor(() => typeof contextReply.release === 'function', 'held continuation with reduced context');
    await notice.waitFor(); assert.match(await notice.innerText(), /reference|earlier|context/i);
    assert.equal(await page.locator('.ghost-text').count(), 0);
    const liveRequestId = await page.evaluate(() => window.testContinuationNotices.at(-1).requestId);
    await noticeCommand('stale-request-id', 'STALE NOTICE MUST NOT APPEAR');
    await page.waitForTimeout(80); assert.doesNotMatch(await notice.innerText(), /STALE/);
    const reducedPrompt = requests.at(-1).body.messages.map(message => message.content).join('\n');
    assert.ok(reducedPrompt.includes(manuscriptText), 'Reduction must preserve the immediate scene.');
    assert.ok(reducedPrompt.length < longManuscriptText.length + referenceText.length, 'Only the outbound context must be reduced.');
    contextReply.release(); await preview(repairedContinuation, longManuscriptText);
    await page.waitForTimeout(6700);
    assert.equal(await notice.isVisible(), true, 'The warning must persist beyond the transient notification timeout.');
    await notice.scrollIntoViewIfNeeded();
    assert.equal(await notice.evaluate(node => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }), true, 'The warning must fit the visible writing area.');
    await page.screenshot({ path: path.join(output, 'continuation-context-notice.png') });
    assert.deepEqual((await savedProject()).references, longFixture.references, 'Context reduction must preserve saved reference text and enabled choices.');
    assert.equal(await fs.readFile(path.join(activeUserData, 'settings.json'), 'utf8'), originalSettings, 'Context reduction must not change preferences.');
    await notice.getByRole('button', { name: 'Dismiss continuation notice', exact: true }).click();
    await notice.waitFor({ state: 'hidden' }); assert.equal(await page.locator('.ghost-text').count(), 1, 'Dismissing a notice must retain the prose preview.');
    await noticeCommand(liveRequestId, 'LATE NOTICE MUST NOT APPEAR');
    await page.waitForTimeout(80); assert.equal(await notice.count(), 0, 'Completed request notices must be ignored.');
    await editor.press('Escape');
    checks.push('Oversized references and older prose are reduced only for the request; a persistent, dismissible context warning survives the preview, and saved references and preferences remain unchanged.');

    stage = 'clearing notices when cancelled';
    const cancelledReply = { text: firstContinuation, hold: true };
    beforeCount = requests.length; enqueue(cancelledReply);
    await atEnd(); await editor.press('Tab');
    await waitFor(() => typeof cancelledReply.release === 'function', 'held reduced-context generation for cancellation');
    await notice.waitFor();
    const cancelledRequestId = await page.evaluate(() => window.testContinuationNotices.at(-1).requestId);
    await noticeCommand(liveRequestId, 'STALE PREVIOUS REQUEST NOTICE');
    await page.waitForTimeout(80); assert.doesNotMatch(await notice.innerText(), /STALE/);
    await editor.press('Escape');
    await page.locator('.generation-inline').waitFor({ state: 'hidden' }); await notice.waitFor({ state: 'hidden' });
    await waitFor(() => requests.at(-1).closed, 'aborting reduced-context generation');
    await noticeCommand(cancelledRequestId, 'CANCELLED REQUEST NOTICE');
    cancelledReply.release(); await page.waitForTimeout(250);
    assert.equal(await notice.count(), 0); assert.equal(await page.locator('.ghost-text').count(), 0);
    assert.equal(requests.length, beforeCount + 1); assert.equal(await visibleText(), longManuscriptText);
    checks.push('Stale notices are ignored during a newer request and after completion; cancellation clears the live notice and ignores later events.');

    stage = 'retaining a context warning through failure and clearing on project change';
    beforeCount = requests.length; enqueue('complete', 'complete');
    await atEnd(); await editor.press('Tab');
    await page.locator('.toast').filter({ hasText: /usable.*continuation/i }).waitFor();
    await page.locator('.generation-inline').waitFor({ state: 'hidden' });
    assert.equal(requests.length, beforeCount + 2); assert.equal(await notice.isVisible(), true);
    assert.equal(await page.locator('.ghost-text').count(), 0); assert.equal(await savedText(), longManuscriptText);
    assert.deepEqual((await savedProject()).references, longFixture.references);
    await command('new');
    await waitFor(async () => (await visibleText()).trim() === '', 'opening a new synthetic manuscript');
    assert.equal(await notice.count(), 0, 'Project changes must clear the previous continuation warning.');
    checks.push('A context warning remains after failed generation and clears when changing projects.');

    assert.equal(queued.length, 0);
    assert.ok(requests.every(request => request.endpoint === '/api/chat'), 'Auto mode must keep structured chat for supported models, including after malformed content.');
    assert.ok(requests.every(request => request.body.format?.properties?.completion?.type === 'string'), 'Every Auto continuation attempt must request a structured completion.');
    assert.ok(requests.every(request => request.body.messages?.some(message => message.content.includes(manuscriptText))), 'Retries must retain the scene to continue.');
    assert.deepEqual(serverErrors, []);
    assert.deepEqual(pageErrors, []);
    const report = { passed: true, continuationRequests: requests.length, checks, userData };
    await fs.writeFile(path.join(output, 'continuation-ui-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ stage, continuationRequests: requests.length, queuedReplies: queued.length, serverErrors, pageErrors }));
    await page?.screenshot({ path: path.join(output, 'continuation-ui-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app?.close().catch(() => {});
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
