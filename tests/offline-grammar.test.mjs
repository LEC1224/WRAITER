import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LocalLinter, Dialect } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { configureHarper, analyzeHarper } from '../src/offline-grammar-analysis.js';

const require = createRequire(import.meta.url), nspell = require('nspell');
const aff = await readFile(new URL('../node_modules/dictionary-en/index.aff', import.meta.url));
const dic = await readFile(new URL('../node_modules/dictionary-en/index.dic', import.meta.url));
const dictionary = nspell(aff, dic);
const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
await linter.setup();
await configureHarper(linter);
after(async () => linter.dispose?.());

test('bundled checker returns exact UTF-16 ranges after multiple emoji', async () => {
  const text = '🙂 She went home. 🤝 She should have went to see her freind.';
  const hints = await analyzeHarper(linter, text, dictionary);
  const byOriginal = original => hints.find(hint => hint.original === original);
  for (const [original, replacement] of [['went', 'gone'], ['freind', 'friend']]) {
    const hint = byOriginal(original); assert.ok(hint, original);
    assert.equal(hint.replacement, replacement); assert.equal(hint.from, text.lastIndexOf(original));
    assert.equal(text.slice(hint.from, hint.to), original);
  }
  assert.equal(byOriginal('freind').category, 'spelling');
  assert.equal(byOriginal('went').category, 'grammar');
});

test('contextual checks catch auxiliary and word-choice errors with applicable replacements', async () => {
  for (const [text, original, replacement] of [
    ['I did not spoke to him.', 'spoke', 'speak'],
    ["He'd wrote a book.", 'wrote', 'written'],
    ['The current is much stronger then yesterday.', 'then', 'than'],
    ['I would like to ask for advise on this topic.', 'advise', 'advice'],
    ["The dragon curled it's tail.", "it's", 'its'],
  ]) {
    const hints = await analyzeHarper(linter, text, dictionary);
    assert.ok(hints.some(hint => hint.category === 'grammar' && hint.original === original && hint.replacement === replacement), `${text}: ${JSON.stringify(hints)}`);
  }
});

test('fiction-friendly rules leave valid repetitions, ambiguous articles and dialogue alone', async () => {
  for (const text of [
    'She had had enough. I know that that is true. What it is is a mystery.',
    'He gave her her book. They can can peaches. It was very very good.',
    'She could of course help. An historic event. A URL.',
    '“I ain’t gonna do it,” she said. “No, no!”',
    'He did not found a religious order.', 'The welcome they extended to us was wonderful.',
    'I had to unpair it and re-pair it.', 'Didn’t checkout work as expected?',
    'The words are there, their, and they’re.',
    'An existing box was ready. The deprecations will be removed.',
    'The SPAs were built worldwide. Otherwise she would stay.',
    'She found out the answer. It was worth while waiting.',
    'I heard of their being together and of its being too late.',
    'Their conduct has been kind. I trust they will arrive.',
    'If I were to leave, the room would be empty.',
    'Every one of the travelers waved. He hopped down and ate.',
    'She left, for while he waited he felt cold. They remembered the road.',
    'Some three years later, her confidant arrived. The event was on the very morning of the wedding.',
    'She used her self-control. He was acting as was his wont.',
    'The task was to effect a rescue. The guests, one of whom had left, returned.',
    '“If you think it’s time to go, I will,” she said. The affect of the witness was flat.',
    'They hoped to effect change. The account ran from cause to effect.',
    'I had no idea of its being late. I heard of their being in town.',
    'Then she heard him speak. He was much more tired than she had expected.'
  ]) {
    const hints = await analyzeHarper(linter, text, dictionary);
    assert.deepEqual(hints.filter(hint => hint.category === 'grammar'), [], text);
  }
});

test('spell checker offers alternatives rather than turning an unknown word into a split phrase', async () => {
  const hints = await analyzeHarper(linter, 'She waitted for her freind. He recieved a reminiscient note.', dictionary);
  const waited = hints.find(hint => hint.original === 'waitted');
  assert.equal(waited.category, 'spelling'); assert.ok(waited.alternatives.includes('waited'));
  assert.ok(!waited.alternatives.includes('wait ted'));
  assert.equal(hints.find(hint => hint.original === 'recieved')?.replacement, 'received');
  assert.equal(hints.find(hint => hint.original === 'reminiscient')?.replacement, 'reminiscent');
});

test('personal names can be accepted without accepting unrelated misspellings', async () => {
  const text = 'Eldrak helped his freind.';
  const before = await analyzeHarper(linter, text, dictionary);
  assert.ok(before.some(hint => hint.original === 'Eldrak'));
  const after = await analyzeHarper(linter, text, dictionary, ['Eldrak']);
  assert.ok(!after.some(hint => hint.original === 'Eldrak'));
  assert.ok(after.some(hint => hint.original === 'freind'));
});

test('bundled English dictionaries recognize ordinary inflections', async () => {
  for (const word of ['university', 'universities', 'dragon', 'dragons', 'whispering', 'whispered', 'serendipitous']) assert.equal(dictionary.correct(word), true, word);
  assert.equal(dictionary.correct('freind'), false);
});

test('US and UK spelling use their respective bundled dictionaries', async () => {
  const britishDictionary = nspell(await readFile(new URL('../node_modules/dictionary-en-gb/index.aff', import.meta.url)), await readFile(new URL('../node_modules/dictionary-en-gb/index.dic', import.meta.url)));
  const british = new LocalLinter({ binary: binaryInlined, dialect: Dialect.British });
  await british.setup(); await configureHarper(british);
  try {
    const text = 'The colour of the color was unusual.';
    const usHints = await analyzeHarper(linter, text, dictionary);
    const gbHints = await analyzeHarper(british, text, britishDictionary);
    assert.ok(usHints.some(hint => hint.original === 'colour' && hint.alternatives.includes('color')));
    assert.ok(!usHints.some(hint => hint.original === 'color' && hint.category === 'spelling'));
    assert.ok(gbHints.some(hint => hint.original === 'color' && hint.alternatives.includes('colour')));
    assert.ok(!gbHints.some(hint => hint.original === 'colour' && hint.category === 'spelling'));
  } finally { await british.dispose?.(); }
});

test('Australian and Canadian dictionaries retain regional spellings', async () => {
  for (const [name, dialect] of [['au', Dialect.Australian], ['ca', Dialect.Canadian]]) {
    const dict = nspell(await readFile(new URL(`../node_modules/dictionary-en-${name}/index.aff`, import.meta.url)), await readFile(new URL(`../node_modules/dictionary-en-${name}/index.dic`, import.meta.url)));
    const regional = new LocalLinter({ binary: binaryInlined, dialect });
    await regional.setup(); await configureHarper(regional);
    try {
      const hints = await analyzeHarper(regional, 'The color and colour were unusual.', dict);
      assert.ok(hints.some(hint => hint.original === 'color' && hint.alternatives.includes('colour')), name);
      assert.ok(!hints.some(hint => hint.original === 'colour' && hint.category === 'spelling'), name);
      assert.equal(dict.correct('travelling'), true, name);
      if (name === 'ca') { assert.equal(dict.correct('organize'), true); assert.equal(dict.correct('organise'), false); }
    } finally { await regional.dispose?.(); }
  }
});

test('invalid, stale, or unsafe findings are discarded without guessing an occurrence', async () => {
  const fake = {
    async organizedLints() { return { DidPast: [
      { get_problem_text: () => 'walk', span: () => ({ start: 0, end: 4 }), suggestions: () => [{ kind: () => 0, get_replacement_text: () => 'walks' }], message: () => 'agreement' },
      { get_problem_text: () => 'walk', span: () => ({ start: 3, end: 7 }), suggestions: () => [{ kind: () => 0, get_replacement_text: () => 'walks\nsecret' }], message: () => 'agreement' }
    ] }; }
  };
  const hints = await analyzeHarper(fake, '🙂 walk', dictionary);
  assert.equal(hints.length, 1); assert.equal(hints[0].original, 'walk');
  assert.deepEqual(hints[0].alternatives, []); assert.equal(hints[0].replacement, null);
});
