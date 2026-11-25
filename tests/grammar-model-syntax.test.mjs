import test from 'node:test';
import assert from 'node:assert/strict';
import { syntaxCandidates } from '../src/grammar-model-syntax.js';
const tokenize = text => Array.from(text.matchAll(/[\p{L}]+(?:['’][\p{L}]+)*/gu), m => ({ word:m[0], lower:m[0].toLowerCase(), from:m.index, to:m.index+m[0].length }));
test('generates bounded syntax proposals with exact offsets', () => {
  const text = '🐉 She has gone two days ago. He asked me where was she.';
  const result = syntaxCandidates(text, tokenize(text));
  assert.deepEqual(result.map(c => [c.original, c.replacement, c.category]), [['has gone', 'went', 'perfect-finished-time'], ['was she', 'she was', 'indirect-question-order']]);
  for (const c of result) assert.equal(text.slice(c.from, c.to), c.original);
});
test('excludes since, embedded ago and directly quoted questions', () => {
  for (const text of ['It has been three years since she has gone two days ago.', 'She has seen the man who left two days ago.', 'He asked "where is she?"', 'He asked, where is she?']) assert.deepEqual(syntaxCandidates(text, tokenize(text)), []);
});
test('reorders short definite noun phrases but excludes direct and relative questions', () => {
  const text = 'He asked where was the far station. She wondered where were the old black dogs.';
  assert.deepEqual(syntaxCandidates(text, tokenize(text)).map(c => [c.original, c.replacement]), [['was the far station', 'the far station was'], ['were the old black dogs', 'the old black dogs were']]);
  for (const text of ['He asked, "Where was the station?"', 'Where was the station?', 'He asked where was the station that closed.', 'He asked where was the very far station.']) assert.deepEqual(syntaxCandidates(text, tokenize(text)), []);
});
test('protects subject WH, ambiguous been, prototype names and line boundaries', () => {
  for (const text of ['I asked who was the captain.', 'I knew what was the matter.', 'The people have been two days ago.', 'She has constructor two days ago.', 'She has\ngone two days ago.', 'He asked where\nwas she.']) assert.deepEqual(syntaxCandidates(text, tokenize(text)), []);
});
