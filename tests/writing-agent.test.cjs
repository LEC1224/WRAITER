const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runWritingAgent, createDocumentTools, collectBlocks, parseReply, projectFingerprint } = require('../electron/writing-agent.cjs');
const { generateStructured } = require('../electron/providers.cjs');
const p = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const project = () => ({ format: 'wraiter', version: 1, id: 'agent-test', title: 'Synthetic manuscript', notes: 'PRIVATE_NOTES_NOT_SENT', style: 'PRIVATE_STYLE_NOT_SENT', chapters: [{ id: 'one', title: 'First', content: { type: 'doc', content: [p('First  sentence.  Next one.'), p('')] } }, { id: 'two', title: 'Second', content: { type: 'doc', content: [p('A   second chapter.'), { type: 'codeBlock', content: [{ type: 'text', text: 'const  x = 1;' }] }] } }], references: [], snapshots: [] });
const reply = (tools = [], message = 'Done.') => JSON.stringify({ message, done: !tools.length, tools });
const call = (name, args = {}) => ({ name, arguments: args });

test('writing chat executes a manuscript-wide double-space cleanup and verifies the result', async () => {
  const original = project(), events = [], prompts = []; let round = 0;
  const result = await runWritingAgent({ project: original, instruction: 'Remove double spacings.', activeChapterId: 'one', settings: {}, onProgress: event => events.push(event) }, async (_settings, _key, prompt) => {
    prompts.push(prompt);
    return ++round === 1 ? reply([call('normalize_spaces')], 'Removing repeated spaces.') : reply([], 'Removed 3 repeated-space runs across both chapters.');
  });
  assert.equal(result.edits.length, 2); assert.equal(result.toolCalls, 1);
  assert.equal(result.edits[0].after, 'First sentence. Next one.'); assert.equal(result.edits[1].after, 'A second chapter.');
  assert.match(prompts[1].user, /Removed 3 repeated-space runs/);
  assert.ok(!JSON.stringify(prompts).includes('PRIVATE_NOTES_NOT_SENT'));
  assert.ok(!JSON.stringify(prompts).includes('PRIVATE_STYLE_NOT_SENT'));
  assert.equal(original.chapters[0].content.content[0].content[0].text, 'First  sentence.  Next one.', 'server only stages changes until the batch is complete');
  assert.ok(events.some(event => event.tool === 'normalize_spaces' && event.state === 'done' && event.count === 3));
  assert.equal(result.baseFingerprint, projectFingerprint(original));
});

test('agent can inspect, search, and revise exact text without regenerating the manuscript', async () => {
  const source = project(); let round = 0;
  const result = await runWritingAgent({ project: source, instruction: 'Change sentence to paragraph.', settings: {} }, async (_s, _k, prompt) => {
    round++;
    if (round === 1) return reply([call('search_document', { find: 'sentence' })]);
    if (round === 2) { assert.match(prompt.user, /"count":1/); return reply([call('replace_all', { find: 'sentence', replace: 'paragraph', expectedCount: 1 })]); }
    return reply([], 'Changed one occurrence.');
  });
  assert.equal(result.edits.length, 1); assert.equal(result.edits[0].after, 'First  paragraph.  Next one.');
});

test('selection scope limits edits and stays mapped after earlier virtual edits', () => {
  const source = project();
  const document = createDocumentTools(source, { selection: { chapterId: 'one', from: 1, to: 17 } });
  assert.equal(document.defaultScope, 'selection');
  assert.equal(document.execute('normalize_spaces', {}).count, 1);
  const read = document.execute('read_document', {}); assert.equal(read.blocks[0].text, 'First sentence.');
  document.execute('rewrite_passage', { blockId: 'c0.b0', before: 'First sentence.', after: 'New beginning.' });
  assert.equal(document.changes().edits[0].after, 'New beginning.  Next one.');
  assert.equal(document.changes().edits.length, 1);
});

test('wrong preconditions and unknown host tools cannot change the virtual manuscript', () => {
  const document = createDocumentTools(project());
  assert.throws(() => document.execute('replace_all', { find: 'sentence', replace: 'paragraph', expectedCount: 2 }), /Found 1/);
  assert.throws(() => document.execute('rewrite_passage', { blockId: 'c0.b0', before: 'Invented', after: 'New' }), /did not exactly match/);
  assert.throws(() => document.execute('run_shell', { command: 'anything' }), /Unknown document tool/);
  assert.deepEqual(document.changes(), { edits: [], chapterTitles: [] });
});

test('large replacements are bounded before any block is changed and long blocks can be paged', () => {
  const source = project(); source.chapters[0].content.content = [p('a'.repeat(10000))];
  const document = createDocumentTools(source);
  assert.throws(() => document.execute('replace_all', { find: 'a', replace: 'x'.repeat(10000), expectedCount: 10002 }), /Expected match count/);
  const count = document.execute('search_document', { find: 'a' }).count;
  assert.throws(() => document.execute('replace_all', { find: 'a', replace: 'x'.repeat(10000), expectedCount: count }), /4 MB/);
  assert.deepEqual(document.changes().edits, []);
  const page = document.execute('read_document', { blockId: 'c0.b0', limitChars: 1000 });
  assert.equal(page.blocks[0].nextOffset, 1000); assert.equal(page.blocks[0].complete, false);
  const next = document.execute('read_document', { blockId: 'c0.b0', limitChars: 1000, offset: page.blocks[0].nextOffset });
  assert.equal(next.blocks[0].offset, 1000); assert.equal(next.blocks[0].nextOffset, 2000);
});

test('tool errors are returned to the model for repair, with a bounded action loop', async () => {
  let round = 0;
  const result = await runWritingAgent({ project: project(), instruction: 'Replace sentence with paragraph.', settings: {} }, async (_s, _k, prompt) => {
    round++;
    if (round === 1) return reply([call('replace_all', { find: 'sentence', replace: 'paragraph', expectedCount: 99 })]);
    if (round === 2) { assert.match(prompt.user, /Found 1 matches/); return reply([call('replace_all', { find: 'sentence', replace: 'paragraph', expectedCount: 1 })]); }
    return reply([], 'Changed one occurrence.');
  });
  assert.deepEqual(result.activity.map(event => event.state), ['error', 'done']); assert.equal(result.edits.length, 1);
  let calls = 0;
  await assert.rejects(runWritingAgent({ project: project(), instruction: 'Inspect everything.', settings: {} }, async () => { calls++; return reply([call('read_document')]); }), /planning limit/);
  assert.equal(calls, 8);
});

test('a question is answered without edits and cancellation never returns a partially edited batch', async () => {
  const result = await runWritingAgent({ project: project(), instruction: 'What can you help with?', settings: {} }, async () => reply([], 'I can edit the open manuscript.'));
  assert.deepEqual(result.edits, []); assert.equal(result.toolCalls, 0);
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(runWritingAgent({ project: project(), instruction: 'Fix the spacing.', settings: {}, signal: controller.signal }, async () => { if (++calls === 2) controller.abort(); return calls === 1 ? reply([call('normalize_spaces')]) : reply(); }), /abort/i);
});

test('empty paragraphs and nested text blocks use correct ProseMirror positions', () => {
  const source = project(); source.chapters[0].content.content = [p(''), { type: 'blockquote', content: [p('Nested.')] }, p('Last.')];
  const blocks = collectBlocks(source).filter(block => block.chapterId === 'one');
  assert.deepEqual(blocks.map(block => [block.from, block.to]), [[1, 1], [4, 11], [14, 19]]);
});

test('action parser accepts fenced JSON and rejects prose or final replies with unexecuted tools', () => {
  assert.equal(parseReply('```json\n' + reply() + '\n```').done, true);
  assert.throws(() => parseReply('Use the replace command instead.'), /JSON action envelope/);
  assert.throws(() => parseReply(JSON.stringify({ done: true, message: 'Done', tools: [call('normalize_spaces')] })), /unexecuted/);
});

test('structured agent generation uses the chat connection without prose cleanup or a tiny prediction cap', async t => {
  const payload = reply([call('replace_all', { find: 'old', replace: 'new', expectedCount: 2 })]); let received;
  const server = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; received = JSON.parse(body); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: payload }, finish_reason: 'stop' }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const output = await generateStructured({ provider: 'compatible', model: 'local-test', baseUrl: `http://127.0.0.1:${server.address().port}`, tokenCap: 64 }, '', { system: 'Return a writing action envelope.', user: 'Make a synthetic edit.' }, new AbortController().signal);
  assert.equal(output, payload); assert.equal(received.max_tokens, 6000); assert.equal(received.messages[0].content, 'Return a writing action envelope.');
});
