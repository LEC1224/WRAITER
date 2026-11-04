const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { CodexBridge, serverArgs } = require('../electron/codex-bridge.cjs');
const { generate, ollamaContextWindow, outputLimit } = require('../electron/providers.cjs');
const { isLocalOllama } = require('../electron/ollama-service.cjs');
const { estimateTokens } = require('../electron/continuation-context.cjs');

async function bridge(t) {
  const client = await new CodexBridge(process.execPath, { args: [path.join(__dirname, 'codex-server.fixture.cjs')] }).start();
  t.after(() => client.close()); return client;
}
async function server(t, handle) {
  const seen = []; const instance = http.createServer(async (req, res) => {
    let body = ''; for await (const data of req) body += data;
    const record = { url: req.url, body: body ? JSON.parse(body) : null, headers: req.headers }; seen.push(record);
    const result = await handle(record, seen.length); res.setHeader('Content-Type', 'application/json');
    res.statusCode = result.status || 200; res.end(JSON.stringify(result.data));
  });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return { baseUrl: `http://127.0.0.1:${instance.address().port}`, seen };
}

test('Codex starts once, reuses the saved account, discovers models, and cleans its private process', async t => {
  const client = await bridge(t); const cwd = client.cwd;
  const status = await client.accountStatus(); assert.equal(status.signedIn, true); assert.equal(status.needsLogin, false);
  assert.equal((await client.login()).signedIn, true);
  assert.equal((await client.listModels())[0].model, 'test-model');
  const records = (await client.rpc('test/records', {})).records;
  assert.equal(records.filter(item => item.method === 'initialize').length, 1);
  assert.ok(!records.some(item => item.method === 'account/login/start'));
  assert.ok(!records.some(item => item.method === 'turn/start'));
  await client.close(); assert.equal(await fs.stat(cwd).catch(() => null), null);
});

test('Codex forks a clean reference base, rehashes changed text, and rejects model tool requests', async t => {
  const client = await bridge(t); const settings = { model: 'test-model', allowReasoning: false };
  const prompt = { system: 'Synthetic prose instructions.', user: 'Write a short sentence.' };
  for (const text of ['A red door.', 'A red door.', 'A tan door.']) {
    assert.equal(await client.complete(settings, prompt, [{ name: 'Reference', text }], new AbortController().signal), 'A synthetic completion.');
  }
  const records = (await client.rpc('test/records', {})).records;
  assert.equal(records.filter(item => item.method === 'thread/start').length, 2, 'unchanged references reuse their base; equal-length edited references rebuild it');
  assert.equal(records.filter(item => item.method === 'thread/fork').length, 3);
  assert.equal(records.filter(item => item.method === 'thread/delete').length, 1);
  const turns = records.filter(item => item.method === 'turn/start');
  assert.ok(turns.every(item => item.params.effort === 'low' && item.params.model === 'test-model'));
  assert.ok(turns.every(item => item.params.approvalPolicy === 'never' && item.params.sandboxPolicy.type === 'readOnly'));
  assert.ok(records.filter(item => item.method === 'thread/fork').every(item => item.params.ephemeral && item.params.excludeTurns));
  assert.equal(records.filter(item => item.error?.code === -32601).length, 3);
});

test('Codex cancellation interrupts the active turn and leaves the connection usable', async t => {
  const client = await bridge(t); const controller = new AbortController();
  const work = client.complete({ model: 'test-model' }, { system: 'Synthetic.', user: 'HANG_REQUEST' }, [], controller.signal);
  setTimeout(() => controller.abort(), 60);
  await assert.rejects(work, /cancelled|abort/i);
  assert.equal((await client.accountStatus()).signedIn, true);
  const records = (await client.rpc('test/records', {})).records;
  assert.equal(records.filter(item => item.method === 'turn/interrupt').length, 1);
  assert.ok(records.some(item => item.method === 'thread/unsubscribe'));
  assert.equal(await client.complete({ model: 'test-model' }, { system: 'Synthetic.', user: 'A new request' }, [], new AbortController().signal), 'A synthetic completion.');
});

test('Codex server arguments disable tools, inherited integrations, hooks, and project instructions', () => {
  const args = serverArgs(); assert.equal(args[0], 'app-server'); assert.ok(args.includes('stdio://'));
  for (const value of ['approval_policy="never"', 'sandbox_mode="read-only"', 'project_doc_max_bytes=0', 'features.hooks=false', 'features.plugins=false', 'features.shell_tool=false', 'features.apps=false', 'mcp_servers={}']) assert.ok(args.includes(value), value);
});

test('Ollama automatic service startup is restricted to the default loopback endpoint', () => {
  assert.ok(isLocalOllama('http://localhost:11434'));
  assert.ok(isLocalOllama('http://127.0.0.1:11434/'));
  for (const endpoint of ['https://localhost:11434', 'http://127.0.0.1:8080', 'http://example.com:11434', 'http://localhost:11434/proxy', 'http://localhost:11434?token=secret']) assert.equal(isLocalOllama(endpoint), false);
});

test('Ollama guided completion honours selected task controls and returns only its prose field', async t => {
  const api = await server(t, () => ({ data: { message: { content: JSON.stringify({ completion: 'one two three four' }) } } }));
  const settings = { provider: 'ollama', baseUrl: api.baseUrl, model: 'qwen3-test', ollamaMode: 'guided', tokenCap: 900, temperature: 0.25, allowReasoning: false };
  assert.equal(await generate(settings, '', { mode: 'continue', before: 'Synthetic prefix.', words: 3 }, new AbortController().signal), 'one two three');
  const body = api.seen[0].body;
  assert.equal(body.format.required[0], 'completion'); assert.equal(body.options.num_predict, 900);
  assert.equal(body.options.temperature, 0.25); assert.equal(body.keep_alive, '30m'); assert.equal(body.think, false);
  assert.match(body.messages[1].content, /\/no_think/); assert.ok(body.options.num_ctx >= 2048 && body.options.num_ctx <= 32768);
});

test('guided rephrasing returns the original rating and model notes in the same request as translations', async t => {
  const alternatives = [
    { text: 'updrafts', rating: 3, description: 'Concise weather terminology for rising air.' },
    { text: 'rising air currents', rating: 2, description: 'More descriptive, emphasizing the movement of the air.' }
  ];
  const api = await server(t, () => ({ data: { message: { content: JSON.stringify({ completion: JSON.stringify({ currentRating: 1, alternatives }) }) } } }));
  const result = await generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'test-rewriter', ollamaMode: 'guided' }, '', { mode: 'rewrite', selection: 'uppåtvindar', language: 'en-US', nativeLanguage: 'sv-SE', alternatives: true }, new AbortController().signal);
  assert.deepEqual(result, { currentRating: 1, alternatives });
  assert.equal(api.seen.length, 1);
  assert.match(api.seen[0].body.messages[1].content, /"description":/);
  assert.match(api.seen[0].body.messages[1].content, /"currentRating":/);
  assert.ok(api.seen[0].body.options.num_predict >= 768);
});

test('Ollama Auto falls back to raw once per unsupported model, preserves forward-only continuation', async t => {
  const api = await server(t, record => record.url === '/api/chat' ? { status: 400, data: { error: 'Structured format is not supported' } } : { data: { response: 'fresh prose' } });
  const settings = { provider: 'ollama', baseUrl: api.baseUrl, model: 'raw-model', ollamaMode: 'auto' };
  for (let i = 0; i < 2; i++) assert.equal(await generate(settings, '', { mode: 'continue', before: 'PREFIX_ONLY', after: 'FORBIDDEN_SUFFIX', words: 4 }, new AbortController().signal), 'fresh prose');
  assert.deepEqual(api.seen.map(item => item.url), ['/api/chat', '/api/generate', '/api/generate']);
  assert.equal(api.seen[1].body.raw, true); assert.equal(api.seen[1].body.prompt, 'PREFIX_ONLY');
  assert.ok(api.seen.every(item => !JSON.stringify(item.body).includes('FORBIDDEN_SUFFIX')));
});

test('Ollama never retries missing models or invalid credentials through a different generation route', async t => {
  const api = await server(t, () => ({ status: 404, data: { error: 'model requested-model not found' } }));
  await assert.rejects(generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'missing', ollamaMode: 'auto' }, '', { mode: 'continue', before: 'synthetic', words: 5 }, new AbortController().signal), /not found/);
  assert.equal(api.seen.length, 1);
});

test('local continuation retries command echoes once with stricter instructions and keeps the word cap', async t => {
  const api = await server(t, (_record, count) => ({ data: { message: { content: JSON.stringify({ completion: count === 1 ? 'complete' : 'She turned the key and waited.' }) } } }));
  const settings = { provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-story', ollamaMode: 'auto', temperature: 0.8 };
  assert.equal(await generate(settings, '', { mode: 'continue', before: 'A lock clicked.', words: 4, language: 'en-US' }), 'She turned the key');
  assert.equal(api.seen.length, 2);
  assert.deepEqual(api.seen.map(item => item.url), ['/api/chat', '/api/chat']);
  assert.match(api.seen[1].body.messages[0].content, /Required output: new manuscript prose/);
  assert.ok(api.seen[1].body.options.temperature <= 0.35);
  assert.equal(api.seen[1].body.messages[1].content, api.seen[0].body.messages[1].content);
});

test('local continuation removes trailing technique commentary before preview without another generation', async t => {
  const api = await server(t, () => ({ data: { message: { content: JSON.stringify({ completion: '“Come in,” Mara said. TECHNIQUE: This passage uses dialogue to build tension.' }) } } }));
  assert.equal(await generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-story', ollamaMode: 'guided' }, '', { mode: 'continue', before: 'Someone knocked.', words: 35 }), '“Come in,” Mara said.');
  assert.equal(api.seen.length, 1);
});

test('unusable local continuations fail after one retry without poisoning Auto structured support', async t => {
  const api = await server(t, (_record, count) => ({ data: { message: { content: count <= 2 ? '{broken' : JSON.stringify({ completion: 'A light flickered behind the glass.' }) } } }));
  const settings = { provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-story', ollamaMode: 'auto' };
  await assert.rejects(generate(settings, '', { mode: 'continue', before: 'Mara waited.', words: 10 }), /usable story continuation after two attempts/);
  assert.equal(api.seen.length, 2);
  assert.equal(await generate(settings, '', { mode: 'continue', before: 'Mara waited.', words: 10 }), 'A light flickered behind the glass.');
  assert.ok(api.seen.every(item => item.url === '/api/chat'));
});

test('reasoning-only, empty, and repeated context responses never become a local suggestion', async t => {
  for (const completion of ['complete', '<think>private planning</think>', '', 'The brass door remained shut.']) {
    const api = await server(t, () => ({ data: { message: { content: JSON.stringify({ completion }) } } }));
    await assert.rejects(generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-story', ollamaMode: 'guided' }, '', { mode: 'continue', before: 'The brass door remained shut.', words: 20 }), /usable story continuation after two attempts/);
    assert.equal(api.seen.length, 2);
  }
});

test('cancellation during a retry stops the local continuation without a third call', async t => {
  const controller = new AbortController();
  const api = await server(t, (_record, count) => {
    if (count === 2) controller.abort();
    return { data: { message: { content: JSON.stringify({ completion: 'complete' }) } } };
  });
  await assert.rejects(generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-story', ollamaMode: 'auto' }, '', { mode: 'continue', before: 'Mara waited.' }, controller.signal), /abort|cancel/i);
  assert.equal(api.seen.length, 2);
});

test('Raw continuation uses bounded manuscript prose despite document language, without unsafe phrase stops', async t => {
  const api = await server(t, () => ({ data: { response: '“I need to find the user,” she said.' } }));
  const before = 'old '.repeat(200) + 'Mara opened the door.';
  const request = { mode: 'continue', before, after: 'FORBIDDEN_SUFFIX', words: 20, contextWords: 50, language: 'en-US' };
  assert.equal(await generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-raw', ollamaMode: 'raw' }, '', request), '“I need to find the user,” she said.');
  const body = api.seen[0].body;
  assert.ok(body.prompt.length < before.length);
  assert.ok(body.prompt.endsWith('Mara opened the door.'));
  assert.doesNotMatch(body.prompt, /Continuation:|FORBIDDEN_SUFFIX|You are/);
  assert.ok(body.options.stop.every(stop => !/I need to|The user|Hmm|Okay/.test(stop)));
});

test('Raw continuation with references, voice, and rejected history ends on the live scene', async t => {
  const api = await server(t, () => ({ data: { response: 'The lantern guttered.' } }));
  await generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-raw', ollamaMode: 'raw' }, '', { mode: 'continue', before: 'Mara waited at the door.', style: 'Use spare prose.', references: [{ name: 'Canon', text: 'The key is brass.' }], history: ['She ran away.'], words: 20 });
  const prompt = api.seen[0].body.prompt;
  assert.match(prompt, /Use spare prose/); assert.match(prompt, /The key is brass/); assert.match(prompt, /She ran away/);
  assert.ok(prompt.endsWith('TEXT BEFORE CURSOR:\nMara waited at the door.'));
});

test('continuation validation also protects compatible providers without automatically spending extra requests', async t => {
  const api = await server(t, () => ({ data: { choices: [{ message: { content: 'complete' } }] } }));
  await assert.rejects(generate({ provider: 'compatible', baseUrl: api.baseUrl, model: 'synthetic' }, '', { mode: 'continue', before: 'Mara waited.' }), /continuation/i);
  assert.equal(api.seen.length, 1);
});

test('local context fitting respects the advertised model window and warns without changing source data', async t => {
  const api = await server(t, record => record.url === '/api/show' ? { data: { model_info: { 'general.architecture': 'synthetic', 'synthetic.context_length': 4096 } } } : { data: { message: { content: JSON.stringify({ completion: 'A bell sounded across the water.' }) } } });
  const request = { mode: 'continue', before: 'Earlier chapters describe the long road home. '.repeat(450) + 'Mara paused beside the river.', words: 20, contextWords: 16000, style: 'Use quiet, concrete prose.', references: [{ name: 'World', text: 'The northern river freezes in winter. '.repeat(1000) }], history: [] };
  const snapshot = structuredClone(request), notices = [];
  const settings = { provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-context', ollamaMode: 'guided', localContextLength: 32768, tokenCap: 256 };
  assert.equal(await generate(settings, '', request, undefined, undefined, notice => notices.push(notice)), 'A bell sounded across the water.');
  const chat = api.seen.find(record => record.url === '/api/chat').body;
  assert.equal(chat.options.num_ctx, 4096);
  assert.ok(estimateTokens(chat.messages.map(item => item.content).join('\n\n')) + 32 + 256 + 512 <= 4096);
  assert.ok(chat.messages[1].content.endsWith('Mara paused beside the river.'));
  assert.match(chat.messages[0].content, /Use quiet, concrete prose/);
  assert.ok(notices.some(notice => /Reference material/.test(notice)));
  assert.ok(notices.some(notice => /Older story text/.test(notice)));
  assert.deepEqual(request, snapshot);
  assert.equal(settings.localContextLength, 32768);
  await generate(settings, '', request);
  assert.equal(api.seen.filter(record => record.url === '/api/show').length, 1, 'Model metadata is reused without caching a smaller author preference.');
});

test('an echoed passage retries with less of the context actually sent, preserving the current scene', async t => {
  let generations = 0;
  const tail = 'Mara held the brass key toward Rowan and waited for him to speak.';
  const api = await server(t, record => record.url === '/api/show' ? { data: { model_info: { 'general.architecture': 'synthetic', 'synthetic.context_length': 4096 } } } : { data: { message: { content: JSON.stringify({ completion: ++generations === 1 ? tail.toUpperCase().replace('.', '!') : 'He took it carefully and opened the gate.' }) } } });
  const request = { mode: 'continue', before: 'Earlier, the travelers had followed a long winding road. '.repeat(500) + tail, contextWords: 16000, words: 20, references: [{ name: 'World', text: 'Background about the river and the road. '.repeat(700) }] };
  const notices = [];
  assert.equal(await generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-echo', ollamaMode: 'auto', tokenCap: 256 }, '', request, undefined, undefined, notice => notices.push(notice)), 'He took it carefully and opened the gate.');
  const attempts = api.seen.filter(record => record.url === '/api/chat').map(record => record.body);
  assert.equal(attempts.length, 2);
  assert.ok(attempts[1].messages[1].content.length < attempts[0].messages[1].content.length * 0.8, 'Retry must reduce an already-fitted prompt rather than refitting the same oversized original.');
  assert.ok(attempts.every(body => body.messages[1].content.endsWith(tail)));
  assert.match(attempts[1].messages[0].content, /Do not copy, paraphrase, or restart/);
  assert.ok(notices.some(notice => /repeated text/.test(notice)));
});

test('a local context-window error receives one reduced retry without a false unsupported-schema fallback', async t => {
  let generations = 0;
  const api = await server(t, record => {
    if (record.url === '/api/show') return { data: {} };
    return ++generations === 1 ? { status: 400, data: { error: 'input length exceeds the context window' } } : { data: { message: { content: JSON.stringify({ completion: 'The lantern cast a warm circle on the ground.' }) } } };
  });
  const request = { mode: 'continue', before: 'The road wound past many quiet farms. '.repeat(100) + 'Mara stopped at the gate.', words: 20, contextWords: 1000, references: [{ name: 'Facts', text: 'The farm has a lantern. '.repeat(70) }] };
  const notices = [];
  await generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-window-error', ollamaMode: 'auto' }, '', request, undefined, undefined, notice => notices.push(notice));
  const attempts = api.seen.filter(record => record.url !== '/api/show');
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every(record => record.url === '/api/chat'));
  assert.ok(attempts[1].body.messages[1].content.length < attempts[0].body.messages[1].content.length);
  assert.ok(notices.some(notice => /reported.*context window/.test(notice)));
});

test('missing model metadata still permits budgeted generation and an irreducible prompt stops before generation', async t => {
  const api = await server(t, record => record.url === '/api/show' ? { status: 404, data: { error: 'Endpoint unavailable' } } : { data: { message: { content: JSON.stringify({ completion: 'The latch finally gave way.' }) } } });
  const settings = { provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-old-server', localContextLength: 4096, ollamaMode: 'guided' };
  assert.equal(await generate(settings, '', { mode: 'continue', before: 'Mara waited beside the gate.', references: [{ name: 'World', text: 'Background facts. '.repeat(900) }] }), 'The latch finally gave way.');
  const previous = api.seen.length;
  await assert.rejects(generate({ ...settings, localContextLength: 1024 }, '', { mode: 'continue', before: 'Mara waited beside the gate.', style: 'Preserve these voice instructions. '.repeat(400) }), /context window is too small/);
  assert.equal(api.seen.length, previous);
});

test('cancelling metadata lookup cannot start generation or emit a late context notice', async t => {
  const controller = new AbortController(), notices = [];
  const api = await server(t, record => {
    assert.equal(record.url, '/api/show');
    controller.abort();
    return { data: {} };
  });
  await assert.rejects(generate({ provider: 'ollama', baseUrl: api.baseUrl, model: 'synthetic-cancel', ollamaMode: 'guided' }, '', { mode: 'continue', before: 'Mara waited.', references: [{ name: 'World', text: 'Background facts. '.repeat(900) }] }, controller.signal, undefined, notice => notices.push(notice)), /abort|cancel/i);
  assert.equal(api.seen.length, 1);
  assert.deepEqual(notices, []);
});

test('per-task API model and output caps are sent to the selected endpoint, Astra avoids unsupported sampling', async t => {
  const api = await server(t, () => ({ data: { output: [{ content: [{ type: 'output_text', text: 'Corrected text.' }] }] } }));
  const base = { provider: 'openai', baseUrl: api.baseUrl, tokenCap: 1234, temperature: 0.7, allowReasoning: false };
  await generate({ ...base, model: 'gpt-6-astra' }, 'test-key', { mode: 'correct', selection: 'Synthetic text.' }, new AbortController().signal);
  await generate({ ...base, model: 'gpt-4.1-mini' }, 'test-key', { mode: 'rewrite', selection: 'Synthetic text.' }, new AbortController().signal);
  assert.equal(api.seen[0].body.model, 'gpt-6-astra'); assert.equal(api.seen[0].body.max_output_tokens, 1234);
  assert.equal(api.seen[0].body.reasoning.effort, 'low'); assert.equal(api.seen[0].body.temperature, undefined);
  assert.equal(api.seen[1].body.model, 'gpt-4.1-mini'); assert.equal(api.seen[1].body.temperature, 0.7);
  assert.equal(api.seen[0].body.store, false);
});

test('output limits scale for selections, stay bounded, and stop partial corrections being accepted', async t => {
  assert.ok(outputLimit({}, { mode: 'correct', selection: 'x'.repeat(6000) }) > 3000);
  const rewrite = { mode: 'rewrite', selection: 'x'.repeat(6000), alternatives: true };
  assert.ok(outputLimit({}, rewrite) > outputLimit({}, { ...rewrite, alternatives: false }) * 2);
  assert.equal(outputLimit({ tokenCap: 512 }, rewrite), 512, 'the author\'s explicit token limit remains in control');
  assert.equal(outputLimit({}, { ...rewrite, selection: 'x'.repeat(64000) }), 32768);
  assert.ok(outputLimit({}, { ...rewrite, suggestionCounts: { translation: 4, rephrase: 8 } }) > outputLimit({}, rewrite));
  assert.ok(outputLimit({}, { mode: 'correct', alternatives: true, selection: 'x'.repeat(100), suggestionCounts: { translation: 1, correction: 5 } }) > outputLimit({}, { mode: 'correct', alternatives: true, selection: 'x'.repeat(100), suggestionCounts: { translation: 1, correction: 1 } }));
  assert.equal(outputLimit({ tokenCap: 500 }, { mode: 'chat' }), 500);
  assert.equal(ollamaContextWindow('short', 256), 2048);
  assert.equal(ollamaContextWindow('x'.repeat(20000), 1024), 8192);
  const api = await server(t, () => ({ data: { status: 'incomplete', output: [{ content: [{ type: 'output_text', text: 'Partial' }] }] } }));
  await assert.rejects(generate({ provider: 'openai', baseUrl: api.baseUrl, model: 'mock', tokenCap: 100 }, 'test-key', { mode: 'correct', selection: 'Synthetic selection.' }, new AbortController().signal), /incomplete/);
});
