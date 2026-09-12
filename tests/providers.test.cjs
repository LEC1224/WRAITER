const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { CodexBridge, serverArgs } = require('../electron/codex-bridge.cjs');
const { generate, ollamaContextWindow, outputLimit } = require('../electron/providers.cjs');
const { isLocalOllama } = require('../electron/ollama-service.cjs');

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
  assert.equal(outputLimit({ tokenCap: 500 }, { mode: 'chat' }), 500);
  assert.equal(ollamaContextWindow('short', 256), 2048);
  assert.equal(ollamaContextWindow('x'.repeat(20000), 1024), 8192);
  const api = await server(t, () => ({ data: { status: 'incomplete', output: [{ content: [{ type: 'output_text', text: 'Partial' }] }] } }));
  await assert.rejects(generate({ provider: 'openai', baseUrl: api.baseUrl, model: 'mock', tokenCap: 100 }, 'test-key', { mode: 'correct', selection: 'Synthetic selection.' }, new AbortController().signal), /incomplete/);
});
