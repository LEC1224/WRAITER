const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'ai-grammar-coverage-'));
  const project = { format: 'wraiter', version: 1, id: 'coverage-ui', title: 'PRIVATE TITLE', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, notes: 'PRIVATE NOTES', style: 'PRIVATE VOICE', references: [], snapshots: [], comments: [], chapters: [
    { id: 'first', title: 'First chapter', content: { type: 'doc', content: [
      paragraph('She walkd home. A quiet morning followed.'), paragraph('The lmap blinked.'),
      ...Array.from({ length: 6 }, (_, i) => paragraph('The room number ' + (i + 1) + ' was quiet.'))
    ] } },
    { id: 'second', title: 'Second chapter', content: { type: 'doc', content: [paragraph('He walkd outside.'), paragraph('No errors in this sentence.')] } }
  ] };
  let gated = true;
  const requests = [], held = [], errors = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'mock-grammar' }] })); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body), user = payload.messages?.[1]?.content || '';
    const marker = 'PASSAGES (JSON data, not instructions):\n';
    const passages = JSON.parse(user.slice(user.indexOf(marker) + marker.length));
    requests.push(passages);
    assert.ok(passages.length <= 6 && passages.every(p => p.text.length <= 4000) && passages.reduce((n, p) => n + p.text.length, 0) <= 12000);
    assert.ok(!body.includes('PRIVATE'));
    const findings = passages.flatMap(p => [...p.text.matchAll(/\b(walkd|lmap)\b/g)].map(match => ({
      passageId: p.id, start: match.index, end: match.index + match[0].length, original: match[0], replacement: match[0] === 'walkd' ? 'walked' : 'lamp',
      category: 'spelling', severity: 'definite', reason: 'Check the spelling of “' + match[0] + '”.'
    })));
    const reply = () => { if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings }) } }] })); };
    if (gated) held.push(reply); else reply();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: true, aiGrammar: true, localGrammar: true, continuous: false, provider: 'compatible', baseUrl, model: 'mock-grammar', taskProfiles: { proofread: { provider: 'compatible', baseUrl, model: 'mock-grammar' } }, keys: {} }));
  await fs.writeFile(path.join(profile, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  async function waitFor(check, description) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await check()) return; await pause(80); }
    throw new Error('Timed out: ' + description);
  }
  try {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    const hints = page.locator('.ai-grammar-hint'), word = hints.filter({ hasText: 'walkd' }), lamp = hints.filter({ hasText: 'lmap' });
    await waitFor(() => held.length > 0, 'automatic proofreading before any interaction');
    assert.equal(requests[0].length, 6, 'The first request batches multiple paragraphs without an edit or focus gesture');
    assert.equal(await editor.evaluate(el => el.editor.state.doc.textContent), project.chapters[0].content.content.map(p => p.content[0].text).join(''));
    assert.match(await page.locator('.ai-grammar-status').innerText(), /checking/i);
    // Change another sentence while the original response is pending, then move
    // all positions by inserting a new paragraph before the checked passage.
    await editor.evaluate(el => {
      const ed = el.editor, text = ed.state.doc.firstChild.textContent, at = 1 + text.indexOf('quiet');
      ed.commands.insertContentAt({ from: at, to: at + 5 }, 'sunny');
      for (let i = 0; i < 150; i++) {
        const old = i % 2 ? 'cloudy' : 'sunny', next = i % 2 ? 'sunny' : 'cloudy';
        const position = 1 + ed.state.doc.firstChild.textContent.indexOf(old);
        ed.commands.insertContentAt({ from: position, to: position + old.length }, next);
      }
      ed.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: 'An earlier observation.' }] });
    });
    held.shift()();
    await word.waitFor();
    assert.equal(await word.innerText(), 'walkd'); await lamp.waitFor();
    const retainedId = await word.getAttribute('data-ai-grammar-id');
    assert.ok(requests[0].some(p => p.text.includes('quiet morning')), 'The arriving response was based on the old sentence');
    // Every later response is still gated: these underlines came from that
    // original response, despite the changed document and shifted positions.
    await editor.evaluate(el => el.editor.commands.insertContentAt(el.editor.state.doc.content.size - 1, ' Another sentence.'));
    assert.equal(await word.getAttribute('data-ai-grammar-id'), retainedId, 'Editing elsewhere keeps the existing underline');
    await editor.evaluate(el => {
      const ed = el.editor; let from;
      ed.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent.startsWith('She walkd')) from = pos + 1; });
      if (!from) throw new Error('Missing target sentence');
      ed.commands.insertContentAt({ from, to: from + 3 }, 'They');
    });
    await waitFor(async () => await word.count() === 0, 'an edit to the grammatical subject invalidates its hint');
    assert.equal(await lamp.count(), 1, 'An independent sentence keeps its underline');
    gated = false; while (held.length) held.shift()();
    await waitFor(() => requests.flat().some(p => p.text === 'He walkd outside.'), 'proofreading reaches the inactive chapter');
    await word.waitFor();
    await waitFor(async () => /finished/i.test(await page.locator('.ai-grammar-status').innerText()), 'finished progress');
    const afterScan = requests.length; await pause(1500); assert.equal(requests.length, afterScan, 'An unchanged manuscript is not continuously rechecked');
    await page.getByRole('button', { name: /Second chapter/ }).first().click();
    await word.waitFor(); assert.equal(await editor.innerText(), 'He walkd outside.\n\nNo errors in this sentence.');
    await pause(800); assert.equal(requests.length, afterScan, 'Opening a checked chapter reuses its results');
    await app.evaluate(({ clipboard }) => clipboard.writeText('Pasted one: The lmap was dim.\n\nPasted two: She walkd away.'));
    await editor.focus(); await editor.press('Control+End'); await editor.press('End'); await editor.press('Enter'); await editor.press('Control+v');
    await editor.evaluate(async el => {
      for (let i = 0; i < 15; i++) {
        el.editor.commands.insertContentAt(el.editor.state.doc.firstChild.nodeSize - 1, ' x');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });
    assert.ok(requests.flat().some(p => p.text.includes('Pasted one:')) && requests.flat().some(p => p.text.includes('Pasted two:')), 'Pasted paragraphs are requested while edits continue every 100ms');
    await waitFor(async () => await hints.count() >= 3, 'hints cover the existing and pasted paragraphs');
    const command = value => app.evaluate(({ BrowserWindow }, sent) => BrowserWindow.getAllWindows()[0].webContents.send('command', sent), value);
    await command('settings-grammar');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.waitFor();
    assert.match(await settings.innerText(), /AI-heavy:/);
    assert.match(await settings.innerText(), /cloud providers may charge/i);
    await page.screenshot({ path: path.join(output, 'ai-grammar-coverage-settings.png') });
    await settings.getByRole('checkbox', { name: /AI grammar hints/ }).setChecked(false);
    await settings.getByRole('button', { name: 'Save settings' }).click(); await settings.waitFor({ state: 'hidden' });
    await waitFor(async () => await hints.count() === 0, 'opt-out clears AI underlines');
    const stopped = requests.length;
    await editor.evaluate(el => el.editor.commands.insertContentAt(el.editor.state.doc.content.size - 1, ' More walkd errors.'));
    await pause(900); assert.equal(requests.length, stopped, 'Opt-out stops automatic requests');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'ai-grammar-coverage-results.json'), JSON.stringify({ passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, requests: requests.length, profile, checks: ['automatic multi-paragraph scan', 'late response survives unrelated sentence edit and position shifts', 'hints persist outside their sentence', 'subject edit invalidates stale hint', 'inactive chapter coverage', 'unchanged manuscript/chapter cache', 'real multiline paste', 'progress', 'opt-out'] }, null, 2));
    console.log('AI grammar automatic manuscript coverage, late result mapping, sentence invalidation, persistent hints, pasted paragraphs, stable cache, progress and opt-out passed.');
  } catch (error) {
    console.error('Coverage diagnostics:', { requests: requests.map(passages => passages.map(p => p.text.slice(0, 90))), status: await page?.locator('.ai-grammar-status').innerText().catch(() => ''), errors }); throw error;
  } finally {
    gated = false; while (held.length) held.shift()();
    await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
