const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { NeuralGrammar } = require('../electron/neural-grammar.cjs');
const { NeuralGrammarEngine, allowedEdit, insideDialogue } = require('../electron/neural-grammar-engine.cjs');
const directory = path.resolve(__dirname, '../build/neural-grammar');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function workerFactory() {
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor(file, options) {
      super(); this.file = file; this.options = options; this.sent = []; this.stopped = false; this.autoStop = true; this.terminated = false;
      workers.push(this);
      this.on('error', () => queueMicrotask(() => this.emit('exit', 1)));
    }
    postMessage(message) {
      if (message.type === 'shutdown') {
        this.stopped = true;
        if (this.autoStop) queueMicrotask(() => this.emit('exit', 0));
      } else this.sent.push(message);
    }
    terminate() { this.terminated = true; this.emit('exit', 0); return Promise.resolve(0); }
    unref() { this.unreferenced = true; }
    reply(index, results) { this.emit('message', { id: this.sent[index].id, results }); }
  }
  return { workers, FakeWorker };
}

test('neural IPC validates bounded passages and does not start for Swedish', async () => {
  const { workers, FakeWorker } = workerFactory();
  const checker = new NeuralGrammar(directory, { WorkerClass: FakeWorker });
  assert.deepEqual(await checker.check({ language: 'sv-SE', texts: ['Det var sent.'] }), [[]]);
  assert.equal(workers.length, 0);
  for (const request of [
    null, {}, { language: 'en-US', texts: ['x'.repeat(3501)] },
    { language: 'en-US', texts: Array(17).fill('hello') },
    { language: 'en-US', texts: Array(4).fill('x'.repeat(3500)) },
    { language: 'en-US', texts: [false] }
  ]) assert.throws(() => checker.check(request), /Invalid local grammar request/);
});

test('neural IPC correlates replies and cancels idle disposal when work resumes', async () => {
  const { workers, FakeWorker } = workerFactory();
  const checker = new NeuralGrammar(directory, { WorkerClass: FakeWorker, idleTimeout: 20 });
  const a = checker.check({ language: 'en-US', texts: ['A.'] });
  const b = checker.check({ language: 'en-GB', texts: ['B.', 'C.'] });
  assert.equal(workers.length, 1);
  workers[0].reply(1, [[], []]);
  workers[0].reply(0, [[]]);
  assert.deepEqual(await a, [[]]);
  assert.deepEqual(await b, [[], []]);
  const c = checker.check({ language: 'en-US', texts: ['D.'] });
  await sleep(35);
  assert.equal(workers[0].stopped, false, 'A pending request must protect the worker from the previous idle timer');
  workers[0].reply(2, [[]]); await c;
  await sleep(35);
  assert.equal(workers[0].stopped, true);
  assert.equal(checker.worker, null);
});

test('neural worker errors reject all requests and stale replies cannot affect a restarted worker', async () => {
  const { workers, FakeWorker } = workerFactory();
  const checker = new NeuralGrammar(directory, { WorkerClass: FakeWorker });
  const first = checker.check({ language: 'en-US', texts: ['First.'] });
  const second = checker.check({ language: 'en-US', texts: ['Second.'] });
  const settled = Promise.allSettled([first, second]);
  workers[0].emit('error', new Error('synthetic private input'));
  assert.ok((await settled).every(result => result.status === 'rejected' && !result.reason.message.includes('private')));
  const third = checker.check({ language: 'en-US', texts: ['Third.'] });
  workers[0].emit('message', { id: workers[1].sent[0].id, results: [[{ original: 'stale' }]] });
  assert.equal(checker.pending.size, 1);
  workers[1].reply(0, [[]]);
  assert.deepEqual(await third, [[]]);
  checker.stop();
});

test('neural timeouts, malformed replies and queue limits fail without hanging callers', async () => {
  for (const kind of ['timeout', 'shape', 'capacity', 'stop']) {
    const { workers, FakeWorker } = workerFactory();
    const checker = new NeuralGrammar(directory, { WorkerClass: FakeWorker, timeout: kind === 'timeout' ? 15 : 30000 });
    const requests = Array.from({ length: kind === 'capacity' ? 32 : 1 }, () => checker.check({ language: 'en-US', texts: ['Text.'] }));
    const settled = Promise.allSettled(requests);
    if (kind === 'shape') workers[0].reply(0, []);
    if (kind === 'capacity') await assert.rejects(checker.check({ language: 'en-US', texts: ['Overflow.'] }), /busy/);
    if (kind === 'timeout') await sleep(35);
    if (kind === 'capacity' || kind === 'stop') checker.stop();
    assert.ok((await settled).every(result => result.status === 'rejected'), kind);
    checker.stop();
    assert.equal(checker.pending.size, 0);
  }
});

test('neural shutdown drains without native termination, is bounded, and prevents restart during quit', async () => {
  for (const exits of [true, false]) {
    const { workers, FakeWorker } = workerFactory();
    const checker = new NeuralGrammar(directory, { WorkerClass: FakeWorker, shutdownTimeout: 25 });
    const checking = checker.check({ language: 'en-US', texts: ['A pending passage.'] });
    const rejected = assert.rejects(checking, /stopped/);
    workers[0].autoStop = false;
    const draining = checker.stop();
    const duringDrain = checker.check({ language: 'en-US', texts: ['While stopping.'] });
    assert.ok(duringDrain instanceof Promise, 'A retiring worker must reject asynchronously so optional-engine fallback runs');
    await assert.rejects(duringDrain, /stopping/);
    const stopping = checker.stop({ permanent: true });
    assert.equal(workers[0].stopped, true, 'Send a graceful shutdown message');
    assert.equal(workers[0].terminated, false, 'Do not terminate an active native runtime');
    await rejected;
    await assert.rejects(checker.check({ language: 'en-US', texts: ['Later.'] }), /closed/);
    if (exits) workers[0].emit('exit', 0);
    assert.equal(await draining, exits);
    assert.equal(await stopping, exits);
    assert.equal(await checker.stop({ permanent: true }), exits, 'Repeated shutdown shares its result');
    assert.equal(workers[0].terminated, false);
    if (!exits) {
      assert.equal(workers[0].unreferenced, true);
      workers[0].emit('exit', 0);
    }
  }
});

test('neural chunks retain Unicode offsets and bound context around artificial boundaries', () => {
  const engine = new NeuralGrammarEngine(directory, { ort: {}, Tokenizer: class {} });
  engine.limit = 10;
  engine.tokens = word => word === 'enormous' ? Array(20).fill(8) : [7];
  const text = '🙂 One two three. Four five six seven eight nine ten eleven twelve.';
  const chunks = engine.chunks(text);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].words.at(-1).word, '.');
  assert.equal(chunks[0].artificialEnd, false);
  assert.ok(chunks.some(chunk => chunk.artificialEnd));
  assert.ok(chunks.some(chunk => chunk.artificialStart));
  for (const chunk of chunks) {
    assert.ok(chunk.ids.length <= engine.limit);
    assert.equal(chunk.positions.length, chunk.words.length + 1);
    for (const word of chunk.words) assert.equal(text.slice(word.from, word.to), word.word);
  }
  const oversize = engine.chunks('one enormous two three.');
  assert.ok(oversize.length > 0);
  assert.equal(oversize.flatMap(chunk => chunk.words).some(word => word.word === 'enormous'), false);
});

test('neural edit guards preserve quoted voice, punctuation and clear auxiliary constraints', () => {
  const accepts = (text, original, replacement, tag) => {
    const from = text.indexOf(original);
    assert.ok(from >= 0);
    return allowedEdit(text, { word: original, from, to: from + original.length }, replacement, tag);
  };
  assert.equal(insideDialogue('“I had went,” she said.', 7), true);
  assert.equal(insideDialogue("She hadn't left.", 11), false);
  assert.equal(insideDialogue("The dogs' owner lost there key.", 20), false);
  assert.equal(accepts('“I had went,” she said.', 'went', 'gone', '$TRANSFORM_VERB_VBD_VBN'), false);
  assert.equal(accepts('He did not went home.', 'went', 'gone', '$TRANSFORM_VERB_VBD_VBN'), false);
  assert.equal(accepts('The shop has been closed since two days ago.', 'since', 'for', '$REPLACE_for'), false);
  assert.equal(accepts('She pointed to broken glass.', 'to', 'to the', '$APPEND_the'), false);
  assert.equal(accepts('The lamp, which it took hours to repair, glowed.', 'it', '', '$DELETE'), false);
  assert.equal(accepts('He left. She stayed.', '.', 'and', '$REPLACE_and'), false);
  assert.equal(accepts('The soldiers lost there way.', 'there', 'their', '$REPLACE_their'), true);
});

test('neural noun agreement uses known ambiguous forms and abstains instead of inventing words', () => {
  const engine = new NeuralGrammarEngine(directory, { ort: {}, Tokenizer: class {} });
  const singular = word => engine.decode(word, '$TRANSFORM_AGREEMENT_SINGULAR');
  const plural = word => engine.decode(word, '$TRANSFORM_AGREEMENT_PLURAL');
  for (const [one, many] of [
    ['movie', 'movies'], ['cookie', 'cookies'], ['zombie', 'zombies'], ['hero', 'heroes'], ['tomato', 'tomatoes'],
    ['scarf', 'scarves'], ['story', 'stories'], ['shoe', 'shoes'], ['curve', 'curves'], ['bus', 'buses'],
    ['house', 'houses'], ['beach', 'beaches'], ['ache', 'aches'], ['class', 'classes'], ['mousse', 'mousses'],
    ['prize', 'prizes'], ['quiz', 'quizzes'], ['cat', 'cats'], ['box', 'boxes'], ['dish', 'dishes'], ['child', 'children']
  ]) {
    assert.equal(singular(many), one, many);
    assert.equal(plural(one), many, one);
  }
  assert.equal(singular('MOVIES'), 'MOVIE');
  assert.equal(singular('Stories'), 'Story');
  for (const word of ['fantazies', 'dracoes', 'zorves', 'floruses', 'unclasses', 'blenches', 'frazzes']) {
    assert.equal(singular(word), null, 'Unknown ambiguous form: ' + word);
  }
  for (const word of ['species', 'series', 'sheep', 'deer', 'news', 'information']) {
    assert.equal(singular(word), null, word);
    assert.equal(plural(word), null, word);
  }
});

test('bundled native neural worker supplies a contextual correction with exact UTF-16 ranges', {
  skip: !fs.existsSync(path.join(directory, 'model.onnx')), timeout: 30000
}, async () => {
  const checker = new NeuralGrammar(directory);
  const texts = [
    'The soldiers lost there way.',
    '🙂 The soldiers lost there way.',
    'I would rather wait then rush in.',
    '“I had already ate half the bread.”',
    'The lamp, which it took me hours to repair, finally worked.',
    'Only one movies remained.',
    'Only one zombies remained.',
    'There is one heroes here.'
  ];
  try {
    const results = await checker.check({ language: 'en-US', texts });
    assert.ok(results[0].some(hint => hint.original === 'there' && hint.replacement === 'their'));
    assert.ok(results[1].some(hint => hint.original === 'there' && hint.replacement === 'their'));
    assert.ok(results[2].some(hint => hint.original === 'then' && hint.replacement === 'than'));
    assert.deepEqual(results[3], []);
    assert.deepEqual(results[4], []);
    assert.ok(results[5].some(hint => hint.original === 'movies' && hint.replacement === 'movie'));
    assert.ok(results[6].some(hint => hint.original === 'zombies' && hint.replacement === 'zombie'));
    assert.ok(results[7].some(hint => hint.original === 'heroes' && hint.replacement === 'hero'));
    for (const [index, hints] of results.entries()) for (const hint of hints) {
      assert.equal(texts[index].slice(hint.from, hint.to), hint.original);
      assert.ok(hint.from >= 0 && hint.to > hint.from && hint.to <= texts[index].length);
      assert.ok(hint.rule.startsWith('neural:'));
      assert.equal(hint.category, 'grammar');
      assert.ok(hint.alternatives.includes(hint.replacement));
    }
  } finally { assert.equal(await checker.stop(), true); }
});

test('native neural shutdown exits during initialization and active inference', {
  skip: !fs.existsSync(path.join(directory, 'model.onnx')), timeout: 30000
}, async () => {
  for (const warm of [false, true]) {
    const checker = new NeuralGrammar(directory);
    if (warm) await checker.check({ language: 'en-US', texts: ['The soldiers lost there way.'] });
    const checking = checker.check({ language: 'en-US', texts: ['The winding road crossed the quiet valley. '.repeat(80)] });
    const rejected = assert.rejects(checking, /stopped/);
    await sleep(warm ? 10 : 500);
    assert.equal(await checker.stop({ permanent: true }), true);
    await rejected;
    assert.equal(checker.workers.size, 0);
  }
});
