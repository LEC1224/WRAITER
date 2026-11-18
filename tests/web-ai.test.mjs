import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { browserCloudSettings, runBrowserAI } from '../src/web/ai.js';
const require = createRequire(import.meta.url);
const agent = require('../electron/writing-agent-core.cjs');
const nativeAgent = require('../electron/writing-agent.cjs');
const key = 'synthetic-user-owned-key';
const settings = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'synthetic-cloud' };
const signal = () => new AbortController().signal;
const result = text => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text }] }] }), { headers: { 'Content-Type': 'application/json' } });
async function withFetch(handler, action) {
  const original = globalThis.fetch; globalThis.fetch = handler;
  try { return await action(); } finally { globalThis.fetch = original; }
}
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const project = () => ({ format: 'wraiter', version: 1, id: 'browser-agent', title: 'Unicode 🐉 manuscript', notes: 'PRIVATE_NOTE_MUST_NOT_LEAVE_DEVICE', style: 'Keep the author’s voice.', chapters: [{ id: 'one', title: 'First', content: { type: 'doc', content: [paragraph('First  sentence.  Next one.')] } }, { id: 'two', title: 'Second', content: { type: 'doc', content: [paragraph('A   second chapter.')] } }], references: [], snapshots: [] });

test('browser connections allow only exact supported HTTPS providers and reject local nested task profiles', () => {
  for (const [provider, baseUrl] of [['openai', 'https://api.openai.com/v1'], ['anthropic', 'https://api.anthropic.com/v1'], ['compatible', 'https://api.x.ai/v1'], ['compatible', 'https://openrouter.ai/api/v1'], ['compatible', 'https://generativelanguage.googleapis.com/v1beta/openai']]) assert.equal(browserCloudSettings({ provider, baseUrl }).baseUrl, baseUrl);
  for (const baseUrl of ['http://api.openai.com/v1', 'http://127.0.0.1:11434', 'https://localhost/v1', 'https://api.openai.com.evil.invalid/v1', 'https://arbitrary.invalid/v1', 'https://api.openai.com:444/v1', 'https://user:password@api.openai.com/v1', 'https://api.openai.com/v1?secret=x', 'https://api.openai.com/v1#secret', 'https://api.openai.com/v1/../../secret']) assert.throws(() => browserCloudSettings({ provider: 'compatible', baseUrl }), /supported|Supported/);
  assert.throws(() => browserCloudSettings({ provider: 'anthropic', baseUrl: settings.baseUrl }), /does not match/);
  assert.throws(() => browserCloudSettings({ provider: 'openai', baseUrl: 'https://api.anthropic.com/v1' }), /does not match/);
  for (const provider of ['local', 'ollama', 'codex', 'claude']) {
    assert.throws(() => browserCloudSettings({ ...settings, provider }), /cloud API/);
    assert.throws(() => browserCloudSettings({ ...settings, taskProfiles: { continue: { provider } } }, 'generate', { mode: 'continue' }), /cloud API/);
    assert.throws(() => browserCloudSettings({ ...settings, taskProfiles: { chat: { provider } } }, 'agent'), /cloud API/);
  }
});

test('OpenAI requests use only the writer’s key directly, disable storage, omit credentials and never relay to WRAITER', async () => {
  const calls = [], originalPublisherKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'publisher-key-must-not-be-used';
  try {
    await withFetch(async (url, init) => { calls.push({ url, init }); return result('A bird began to sing.'); }, async () => {
      const body = { settings, request: { id: 'continue', mode: 'continue', before: 'The garden was quiet. ', words: 10 } };
      await assert.rejects(runBrowserAI('generate', body, signal()), /your own cloud provider API key/); assert.equal(calls.length, 0);
      assert.match(await runBrowserAI('generate', { ...body, apiKey: key }, signal()), /bird began to sing/);
    });
    assert.equal(calls.length, 1); const { url, init } = calls[0], body = JSON.parse(init.body);
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.headers.Authorization, `Bearer ${key}`); assert.equal(body.store, false);
    assert.equal(init.credentials, 'omit'); assert.equal(init.mode, 'cors'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.redirect, 'error');
    assert.ok(!JSON.stringify(calls).includes('publisher-key-must-not-be-used')); assert.ok(!JSON.stringify(calls).includes('private.example.net'));
  } finally { if (originalPublisherKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalPublisherKey; }
});

test('Anthropic uses its explicit browser-access flag and compatible providers use direct chat completions', async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.includes('anthropic') ? { content: [{ type: 'text', text: 'New sentence.' }], stop_reason: 'end_turn' } : { choices: [{ message: { content: 'New sentence.' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  }, async () => {
    for (const connection of [{ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1' }]) {
      assert.equal(await runBrowserAI('generate', { settings: { ...connection, model: 'synthetic-cloud' }, apiKey: key, request: { id: 'rewrite', mode: 'rewrite', selection: 'Old sentence.' } }, signal()), 'New sentence.');
    }
  });
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages'); assert.equal(calls[0].init.headers['x-api-key'], key); assert.equal(calls[0].init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(calls[1].url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(calls[1].init.headers.Authorization, `Bearer ${key}`); assert.equal(JSON.parse(calls[1].init.body).stream, false);
});

test('all five supported provider connections discover models directly with the active user key', async () => {
  const calls = [];
  await withFetch(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ data: [{ id: 'zeta' }, { name: 'alpha' }] }), { headers: { 'Content-Type': 'application/json' } }); }, async () => {
    for (const connection of [{ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }, { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, { provider: 'compatible', baseUrl: 'https://api.x.ai/v1' }, { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1' }, { provider: 'compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }]) {
      assert.deepEqual((await runBrowserAI('models', { settings: connection, apiKey: key }, signal())).models, ['alpha', 'zeta']);
    }
  });
  assert.equal(calls.length, 5); for (const call of calls) { assert.ok(call.url.endsWith('/models')); assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.headers.Authorization || call.init.headers['x-api-key'], call.url.includes('anthropic') ? key : `Bearer ${key}`); }
});

test('proofreading and inline grammar share validated findings while inline requests exclude private context', async () => {
  const calls = [], request = { id: 'proof', projectId: 'project1', scope: 'chapter', language: 'en-GB', style: 'PRIVATE_VOICE', passages: [{ id: 'passage1', chapterTitle: 'PRIVATE_TITLE', paragraph: 12, text: 'He walkd home.' }] };
  const findings = [{ passageId: 'passage1', start: 3, original: 'walkd', replacement: 'walked', severity: 'definite', category: 'spelling', reason: 'Past-tense spelling.' }, { passageId: 'passage1', start: 0, original: 'He', replacement: 'The man', severity: 'optional', category: 'phrasing', reason: 'A style alternative.' }];
  await withFetch(async (url, init) => { calls.push({ url, init }); return result(JSON.stringify({ findings })); }, async () => {
    const proofread = await runBrowserAI('proofread', { settings, apiKey: key, request }, signal()); assert.equal(proofread.findings.length, 2);
    const inline = await runBrowserAI('inline', { settings, apiKey: key, request: { ...request, scope: 'selection', references: ['PRIVATE_REFERENCE'] } }, signal());
    assert.deepEqual(inline.findings.map(item => [item.start, item.original, item.replacement]), [[3, 'walkd', 'walked']]);
  });
  assert.ok(calls[0].init.body.includes('PRIVATE_VOICE')); assert.ok(!calls[1].init.body.includes('PRIVATE_')); assert.ok(calls.every(call => call.url === 'https://api.openai.com/v1/responses'));
});

test('browser agent stages document edits locally with native-compatible fingerprints and no private notes', async () => {
  const original = project(), calls = [], replies = [JSON.stringify({ message: 'Removing repeated spaces.', done: false, tools: [{ name: 'normalize_spaces', arguments: {} }] }), JSON.stringify({ message: 'Removed repeated spaces.', done: true, tools: [] })];
  const responses = replies.map(result), originalBuffer = globalThis.Buffer; let edited;
  try {
    globalThis.Buffer = undefined;
    edited = await withFetch(async (url, init) => { calls.push({ url, init }); return responses[calls.length - 1]; }, () => runBrowserAI('agent', { settings, apiKey: key, request: { project: original, instruction: 'Remove repeated spaces.', activeChapterId: 'one' } }, signal()));
  } finally { globalThis.Buffer = originalBuffer; }
  assert.equal(edited.edits.length, 2); assert.equal(edited.toolCalls, 1); assert.equal(edited.edits[0].after, 'First sentence. Next one.');
  assert.equal(original.chapters[0].content.content[0].content[0].text, 'First  sentence.  Next one.');
  const fingerprint = createHash('sha256').update(agent.fingerprintInput(original)).digest('hex');
  assert.equal(edited.baseFingerprint, fingerprint); assert.equal(agent.projectFingerprint(original), fingerprint); assert.equal(nativeAgent.projectFingerprint(original), fingerprint);
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_NOTE_MUST_NOT_LEAVE_DEVICE')); assert.equal(calls.length, 2); assert.ok(calls.every(call => call.url === 'https://api.openai.com/v1/responses'));
});
