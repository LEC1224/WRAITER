const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canDeleteFromPastVerbGroup, NeuralGrammarEngine } = require('../electron/neural-grammar-engine.cjs');

test('auxiliary deletion respects the form of its complement and existing verb chains', () => {
  const forms = new Map([['drawn:VBN_VB', 'draw'], ['read:VB_VBD', 'read']]);
  function deletionAllowed(before, auxiliary, after) {
    const tokens = text => text.split(/\s+/u).filter(Boolean);
    const left = tokens(before);
    const words = [...left, auxiliary, ...tokens(after)].map(word => ({ word }));
    return canDeleteFromPastVerbGroup(words, left.length, forms);
  }
  assert.equal(deletionAllowed('The architect', 'had', 'already drawn the plan'), false);
  assert.equal(deletionAllowed('The tenants', 'had', 'not yet left'), false);
  assert.equal(deletionAllowed('The room', 'was', 'recently repainted'), false);
  assert.equal(deletionAllowed('The gears', 'were', 'still spinning'), false);
  assert.equal(deletionAllowed('She', 'did', 'read it'), false);
  assert.equal(deletionAllowed('He has', 'had', 'painted shutters for years'), false);
  assert.equal(deletionAllowed('The gears were', 'were', 'spinning'), true);
  assert.equal(deletionAllowed('It was', 'had', 'broken'), true);
  assert.equal(deletionAllowed('It', 'had', ', the landlord explained , failed'), true,
    'The guard must not attach a verb across clause punctuation');
});

const directory = path.resolve(__dirname, '../build/neural-grammar');
test('real neural model preserves narrative perspective while catching verb errors', {
  skip: !fs.existsSync(path.join(directory, 'model.onnx')), timeout: 30000
}, async () => {
  const engine = new NeuralGrammarEngine(directory);
  try {
    const valid = [
      'A year ago we were two couriers who had happened upon a silver locket at an auction in Durham.',
      'The plane had already landed by dusk.',
      'I had had enough.'
    ];
    for (const sentence of valid) assert.deepEqual(await engine.check(sentence), [], sentence);
    for (const [text, original, replacement] of [
      ['We were were waiting at the station.', 'were ', ''],
      ['The window was had broken.', 'had ', ''],
      ['She had went home.', 'went', 'gone'],
    ]) {
      assert.ok((await engine.check(text)).some(hint =>
        hint.original === original && hint.replacement === replacement &&
        text.slice(hint.from, hint.to) === original), text);
    }
  } finally {
    await engine.close();
  }
});
