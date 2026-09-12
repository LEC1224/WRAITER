const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanResult } = require('../electron/core.cjs');
test('replacements retain selected boundary whitespace and discard embedded editing instructions', () => {
  assert.equal(cleanResult('afraid', 'rewrite', 35, { selection: ' rädd ' }), ' afraid ');
  assert.equal(cleanResult('Revision: This works. [make concise]', 'rewrite', 35, { selection: '  This sentence works. [make concise]\n' }), '  This works.\n');
  assert.equal(cleanResult('word', 'correct', 35, { selection: 'word ' }), 'word ');
});
test('continuation cleanup preserves intentional word spacing and dialogue punctuation', () => {
  assert.equal(cleanResult(' walked away from the door.', 'continue', 2), ' walked away');
  assert.equal(cleanResult('“Come in,” she said.', 'continue', 35), '“Come in,” she said.');
  assert.equal(cleanResult('<think>internal reasoning</think>\nSuggestion: more words', 'continue', 35), 'more words');
});
