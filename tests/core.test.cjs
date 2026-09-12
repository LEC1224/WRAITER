const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { validateProject, validateRequest, atomicWrite, readLimited, DocumentStore, buildPrompt, cleanResult, hash, samePath, safeFilename } = require('../electron/core.cjs');
const { endpoint, requestJSON, generate, probe, codexArgs, codexEnvironment, spawnAndWait } = require('../electron/providers.cjs');

const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const project = (id = 'alpha', text = 'A quiet beginning.') => ({
  format: 'wraiter', version: 1, id, title: 'Draft', chapters: [{ id: `${id}-chapter`, title: 'Chapter one', status: 'Draft', content: { type: 'doc', content: [paragraph(text)] } }],
  references: [], notes: '', style: '', snapshots: []
});
async function temporary(t) {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'wraiter-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return directory;
}
async function mockServer(t, handle) {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('native validation preserves supported text, formatting, references, and snapshots', () => {
  const draft = project();
  draft.chapters[0].content.content.push(paragraph(' '), { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragraph('Cell')] }] }] });
  draft.chapters[0].content.content[0].content[0].marks = [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '20px', color: '#123456' } }];
  draft.references.push({ id: 'r1', name: 'World notes', text: 'A supplied fact.', enabled: true });
  draft.snapshots.push({ id: 's1', name: 'Before revision', title: draft.title, createdAt: new Date().toISOString(), chapters: structuredClone(draft.chapters), references: structuredClone(draft.references) });
  const before = JSON.stringify(draft);
  assert.equal(validateProject(draft), draft); assert.equal(JSON.stringify(draft), before);
});

test('native validation rejects malformed nested text and snapshot data before mutation', () => {
  for (const mutate of [
    p => { p.chapters[0].content.content = 'not an array'; },
    p => { p.chapters[0].content.content[0].content[0].text = {}; },
    p => { p.chapters[0].content.content[0].content.push({ type: 'paragraph' }); },
    p => { p.chapters.push(structuredClone(p.chapters[0])); },
    p => { p.references = [null]; },
    p => { p.snapshots = [{ id: 'broken', chapters: [] }]; },
    p => { p.chapters[0].content.content[0].content[0].marks = [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]; },
    p => { p.chapters[0].content.content.push({ type: 'image', attrs: { src: 'https://external.example/track.png' } }); }
  ]) {
    const draft = project(); mutate(draft);
    assert.throws(() => validateProject(draft), /invalid|unsupported|duplicated|embedded|Links must/i);
  }
  const deep = project(); let node = deep.chapters[0].content;
  for (let i = 0; i < 70; i++) { node.content = [{ type: 'blockquote', content: [] }]; node = node.content[0]; }
  node.content = [paragraph('Too deep')];
  assert.throws(() => validateProject(deep), /too complex/i);
});

test('atomic binary replacement keeps the preceding complete version and removes staging files', async t => {
  const directory = await temporary(t); const target = path.join(directory, 'export.pdf');
  await atomicWrite(target, Buffer.from([0, 255, 10, 13]));
  await atomicWrite(target, Buffer.from([1, 0, 254]), true);
  assert.deepEqual(await fs.readFile(target), Buffer.from([1, 0, 254]));
  assert.deepEqual(await fs.readFile(`${target}.bak`), Buffer.from([0, 255, 10, 13]));
  assert.deepEqual((await fs.readdir(directory)).sort(), ['export.pdf', 'export.pdf.bak']);
});

test('bounded imports reject oversized files and directories', async t => {
  const directory = await temporary(t); const target = path.join(directory, 'text.txt');
  await fs.writeFile(target, '123456');
  assert.equal((await readLimited(target, 6)).toString(), '123456');
  await assert.rejects(readLimited(target, 5), /limit/);
  await assert.rejects(readLimited(directory), /regular|EISDIR|EACCES|EPERM/);
});

test('autosave recovers untitled work and archives it before switching', async t => {
  const directory = await temporary(t); const store = new DocumentStore(directory); const draft = project();
  await store.persist(draft);
  const recovered = new DocumentStore(directory); assert.equal((await recovered.boot()).project.id, draft.id);
  const switched = await store.replace(project('beta'));
  assert.ok(switched.recoveredPath.startsWith(path.join(directory, 'Recovered drafts')));
  assert.equal(JSON.parse(await fs.readFile(switched.recoveredPath, 'utf8')).id, draft.id);
  assert.equal((await new DocumentStore(directory).boot()).project.id, 'beta');
  await assert.rejects(store.persist(draft), /no longer open/);
  assert.equal((await new DocumentStore(directory).boot()).project.id, 'beta');
});

test('native open validates before committing state or overwriting recovery', async t => {
  const directory = await temporary(t); const store = new DocumentStore(directory); await store.persist(project());
  const invalid = path.join(directory, 'bad.wraiter'); await fs.writeFile(invalid, '{broken');
  await assert.rejects(store.open(invalid));
  assert.equal(store.project.id, 'alpha'); assert.equal((await new DocumentStore(directory).boot()).project.id, 'alpha');
  const valid = path.join(directory, 'other.wraiter'); await atomicWrite(valid, JSON.stringify(project('other')));
  const result = await store.open(valid);
  assert.equal(store.project.id, 'other'); assert.ok(result.recoveredPath);
  assert.equal(store.expectedHash, hash(await fs.readFile(valid)));
});

test('named saves preserve changes, detect external edits, and leave a useful backup', async t => {
  const directory = await temporary(t); const store = new DocumentStore(directory); const target = path.join(directory, 'Draft.wraiter');
  await store.persist(project(), target);
  await store.persist(project('alpha', 'Second revision.'));
  const backup = await fs.readFile(`${target}.bak`, 'utf8');
  assert.match(backup, /quiet beginning/);
  await store.persist(project('alpha', 'Second revision.'));
  assert.equal(await fs.readFile(`${target}.bak`, 'utf8'), backup, 'An unchanged autosave must not erase the preceding revision backup.');
  const external = JSON.stringify(project('alpha', 'External edit.')); await fs.writeFile(target, external);
  await assert.rejects(store.persist(project('alpha', 'Latest local edit.')), /changed outside/);
  assert.equal(await fs.readFile(target, 'utf8'), external);
  const restored = await new DocumentStore(directory).boot();
  assert.match(JSON.stringify(restored.project), /Latest local edit/);
  const copy = path.join(directory, 'Separate.wraiter'); await store.persist(restored.project, copy);
  assert.equal(store.currentPath, copy); assert.match(await fs.readFile(copy, 'utf8'), /Latest local edit/);
});

test('external deletion and save-copy collisions require preservation instead of replacement', async t => {
  const directory = await temporary(t); const store = new DocumentStore(directory); const target = path.join(directory, 'Draft.wraiter');
  await store.persist(project(), target); await fs.unlink(target);
  await assert.rejects(store.persist(project('alpha', 'Local change')), /changed outside/);
  const copy = path.join(directory, 'Occupied.wraiter'); await fs.writeFile(copy, 'existing unrelated file');
  await assert.rejects(store.persist(project(), copy), /already exists/);
  assert.equal(await fs.readFile(copy, 'utf8'), 'existing unrelated file');
});

test('corrupt latest recovery falls back to the prior complete recovery without deleting evidence', async t => {
  const directory = await temporary(t); const store = new DocumentStore(directory);
  await store.persist(project()); await store.persist(project('alpha', 'New text'));
  await fs.writeFile(store.recoveryPath, 'broken JSON');
  const result = await new DocumentStore(directory).boot();
  assert.match(result.warning, /preceding recovery backup/); assert.equal(result.project.id, 'alpha');
  assert.equal(await fs.readFile(store.recoveryPath, 'utf8'), 'broken JSON');
});

test('prompt boundaries keep continuation forward-only and correction structure explicit', () => {
  const request = { id: 'req', mode: 'continue', before: 'Before sentinel', after: 'After sentinel', selection: 'Selection sentinel', words: 35, notes: 'Private notes sentinel', references: [{ name: 'Canon sheet', text: 'Author supplied context' }] };
  const prompt = buildPrompt(validateRequest(request));
  assert.match(prompt.user, /Before sentinel/); assert.match(prompt.user, /Author supplied context/);
  assert.doesNotMatch(prompt.user, /After sentinel|Selection sentinel|Private notes sentinel/);
  assert.match(buildPrompt({ ...request, mode: 'correct' }).user, /paragraph and line boundaries/);
  assert.match(buildPrompt({ ...request, mode: 'chat', conversation: [{ role: 'user', text: 'Prior question' }, { role: 'assistant', text: 'Prior answer' }] }).user, /Prior question[\s\S]*Prior answer/);
  assert.equal(validateRequest({ ...request, words: 10000 }).words, 500);
  assert.equal(validateRequest({ ...request, words: -4 }).words, 1);
  assert.throws(() => validateRequest({ ...request, conversation: [{ role: 'system', text: 'Injected' }] }), /conversation/);
  assert.equal(cleanResult('<think>hidden</think>one two three four', 'continue', 3), 'one two three');
  assert.equal(cleanResult('```text\nCorrected text.\n```', 'correct'), 'Corrected text.');
});

test('provider endpoints reject embedded credentials and ambiguous query destinations', () => {
  assert.equal(endpoint('http://localhost:11434/', 'api/chat'), 'http://localhost:11434/api/chat');
  assert.equal(endpoint('https://api.example/v1/', 'responses'), 'https://api.example/v1/responses');
  for (const base of ['file:///private', 'https://user:pass@example.com', 'https://example.com?token=abc', 'https://example.com#fragment', 'broken']) assert.throws(() => endpoint(base, 'messages'));
  assert.equal(safeFilename('../Bad: title. '), '..Bad title');
  assert.ok(samePath(path.resolve('a.wraiter'), path.resolve('.', 'a.wraiter')));
});

test('all HTTP adapters send the requested context only, using local mock services', async t => {
  const seen = [];
  const base = await mockServer(t, async (req, res) => {
    let bytes = ''; for await (const chunk of req) bytes += chunk;
    seen.push({ url: req.url, headers: req.headers, body: bytes ? JSON.parse(bytes) : null });
    res.setHeader('Content-Type', 'application/json');
    const responses = { '/api/chat': { message: { content: 'one two three four' } }, '/messages': { content: [{ type: 'text', text: 'one two three four' }] }, '/responses': { output: [{ content: [{ type: 'output_text', text: 'one two three four' }] }] }, '/chat/completions': { choices: [{ message: { content: 'one two three four' } }] }, '/api/tags': { models: [{ name: 'local-model' }] } };
    res.end(JSON.stringify(responses[req.url]));
  });
  const request = { id: 'mock', mode: 'continue', before: 'Mock text only', words: 3 };
  for (const provider of ['ollama', 'anthropic', 'openai', 'compatible']) {
    assert.equal(await generate({ provider, baseUrl: base, model: 'mock-model' }, 'test-only-key', request, new AbortController().signal), 'one two three');
  }
  assert.equal(seen[0].headers.authorization, undefined);
  assert.equal(seen[1].headers['x-api-key'], 'test-only-key');
  assert.equal(seen[2].headers.authorization, 'Bearer test-only-key');
  assert.equal(seen[2].body.store, false);
  assert.equal(seen[3].headers.authorization, 'Bearer test-only-key');
  assert.deepEqual((await probe({ provider: 'ollama', baseUrl: base }, '')).models, ['local-model']);
});

test('HTTP cancellation and redirects cannot continue or forward a manuscript', async t => {
  let redirected = false;
  const base = await mockServer(t, (req, res) => {
    if (req.url === '/redirect') { res.writeHead(307, { Location: '/should-not-arrive' }); res.end(); }
    else if (req.url === '/should-not-arrive') { redirected = true; res.end('{}'); }
    else if (req.url === '/large') { res.writeHead(200, { 'Content-Length': 5 * 1024 * 1024 }); res.end(); }
    else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); }
  });
  await assert.rejects(requestJSON(`${base}/redirect`, { method: 'POST', body: 'manuscript' }, new AbortController().signal));
  assert.equal(redirected, false);
  await assert.rejects(requestJSON(`${base}/large`, {}, new AbortController().signal), /4 MB/);
  const controller = new AbortController(); const work = requestJSON(`${base}/hanging`, {}, controller.signal);
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(work, /abort/i);
});

test('Codex isolation arguments retain login without inheriting API keys or user integrations', () => {
  const environment = codexEnvironment({ PATH: 'system-path', CODEX_HOME: 'existing-login', OPENAI_API_KEY: 'do-not-inherit', CODEX_API_KEY: 'do-not-inherit', ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(environment.CODEX_HOME, 'existing-login'); assert.equal(environment.PATH, 'system-path');
  assert.equal(environment.OPENAI_API_KEY, undefined); assert.equal(environment.CODEX_API_KEY, undefined); assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
  const args = codexArgs({ model: 'chosen-model' }, 'answer.txt');
  for (const value of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config', 'read-only', 'features.hooks=false', 'features.plugins=false', 'features.shell_tool=false', 'features.apps=false', 'project_doc_max_bytes=0']) assert.ok(args.includes(value), value);
  assert.equal(args.at(-1), '-'); assert.equal(args[args.indexOf('-m') + 1], 'chosen-model');
});

test('subprocess cancellation resolves only after the spawned process closes', async () => {
  const controller = new AbortController();
  const work = spawnAndWait(process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], {}, '', controller.signal);
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(work, /cancelled/);
  await spawnAndWait(process.execPath, ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0))'], {}, 'test input', new AbortController().signal);
});
