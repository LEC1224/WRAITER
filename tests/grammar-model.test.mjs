import test from 'node:test';
import assert from 'node:assert/strict';
import { generateGrammarCandidates, candidateFeatures, scoreGrammarCandidate } from '../src/grammar-model.js';
import { learnedGrammarHints } from '../src/learned-grammar.js';

test('generates indexed candidates with reusable features and preserves case', () => {
  const text = '🐉 She HAVE gone. They has went. Many advice.';
  const candidates = generateGrammarCandidates(text);
  assert.deepEqual(candidates.map(({ original, replacement, category }) => [original, replacement, category]), [
    ['HAVE', 'HAS', 'agreement'], ['has', 'have', 'agreement'], ['went', 'gone', 'participle'], ['Many', 'Much', 'countability']
  ]);
  for (const candidate of candidates) {
    assert.equal(text.slice(candidate.from, candidate.to), candidate.original);
    assert.deepEqual(candidate.features, candidateFeatures(text, candidate));
  }
});

test('does not cross punctuation or embedded objects and scores sparse models', () => {
  assert.deepEqual(generateGrammarCandidates('She. have\ufffcwent'), []);
  const [candidate] = generateGrammarCandidates('She have a book.');
  const probability = scoreGrammarCandidate(candidate, { bias: -1, weights: { 'category=agreement': 2 } });
  assert.ok(Math.abs(probability - 1 / (1 + Math.exp(-1))) < 1e-12);
  assert.equal(scoreGrammarCandidate(candidate, { bias: -1000 }), 0);
});

test('generates constrained noun agreement and noun-number corrections', () => {
  const candidates = generateGrammarCandidates('The keys to the cabinet is missing. Several useful informations arrived. Many small book fell.');
  assert.deepEqual(candidates.map(({ original, replacement, category }) => [original, replacement, category]), [
    ['is', 'are', 'noun-agreement'], ['informations', 'pieces of information', 'mass-noun'], ['book', 'books', 'quantified-noun']
  ]);
  assert.ok(candidates[0].features.includes('has-preposition=true'));
  assert.deepEqual(generateGrammarCandidates('The keys, which she found, is missing. She said: "Many a book".'), []);
});

test('handles bounded adverbs, contractions and ambiguous infinitival contexts', () => {
  const text = 'She hasn’t yet went. He did not ever ate. I want to quickly walked. We returned to burned wood.';
  const candidates = generateGrammarCandidates(text);
  assert.deepEqual(candidates.map(({ original, replacement }) => [original, replacement]), [['went', 'gone'], ['ate', 'eat'], ['walked', 'walk'], ['burned', 'burn']]);
  assert.ok(candidates[3].features.includes('context-auxiliary=to'));
  assert.deepEqual(generateGrammarCandidates('She has, after all, went.'), []);
  const [dialogue] = generateGrammarCandidates('“She has never went,” he said.');
  assert.ok(dialogue.features.includes('in-dialogue=true'));
});


test('ignores words that match inherited JavaScript object names', () => {
  assert.deepEqual(generateGrammarCandidates('It constructor. They had constructor. From here to constructor.'), []);
});

test('trained scoring keeps a clear error in narration and leaves the same voice in dialogue alone', () => {
  const sentence = 'The lanterns by the gate was about to go out.';
  const hints = learnedGrammarHints(sentence, 'en-US');
  assert.deepEqual(hints.map(hint => [hint.original, hint.replacement, hint.rule]), [['was', 'were', 'learned:noun-agreement']]);
  assert.deepEqual(learnedGrammarHints('“' + sentence + '”', 'en-US'), []);
  assert.deepEqual(learnedGrammarHints(sentence, 'sv-SE'), []);
});
