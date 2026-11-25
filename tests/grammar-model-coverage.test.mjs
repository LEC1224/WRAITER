import test from 'node:test';
import assert from 'node:assert/strict';
import { generateGrammarCandidates } from '../src/grammar-model.js';

const proposals = text => generateGrammarCandidates(text).map(({ original, replacement }) => [original, replacement]);
const has = (text, original, replacement) => assert.ok(proposals(text).some(pair => pair[0] === original && pair[1] === replacement), text);

test('proposes local noun number, quantified head and inverted subject corrections', () => {
  has('My uncle have a spare key.', 'have', 'has');
  has('The weary soldiers has returned.', 'has', 'have');
  has('One of the bottles are cracked.', 'are', 'is');
  has('Outside were a small wooden box.', 'were', 'was');
  has('Those old journal belong in the library.', 'journal', 'journals');
  has('The keeper found three wolf near the gate.', 'wolf', 'wolves');
});

test('does not confuse coordinated or collective subjects with singular noun heads', () => {
  for (const text of [
    'My groom and my page sleep in the old wing.',
    'He and his family have gone home.',
    'My mother and my father live in the village.',
    'The crew were drinking in the tavern.',
    'The family have never met the captain.',
    'The fish is fresh.', 'The sheep was asleep.',
    'Outside were a chair and a small box.'
  ]) assert.deepEqual(proposals(text), [], text);
});

test('preserves noun compounds, elliptic quantities and ambiguous past read', () => {
  for (const text of [
    'The three young ladies set off together.', 'The remaining five set off together.',
    'Three fire-engines were parked in the square.', 'Two corner seats were still empty.',
    'Those day-to-day problems can wait.', 'Those old book covers were hand-painted.',
    'These stone walls have stood for centuries.', 'Two dozen eggs sat on the table.',
    'The clerk read the letter aloud yesterday.', 'When the White Rabbit read out the names, she listened.',
    'The door of my room swung slowly open.'
  ]) assert.deepEqual(proposals(text), [], text);
});

test('distinguishes clear homophone and pronoun contexts from possessive noun phrases', () => {
  has('Your welcome to join us.', 'Your', "You're");
  has('Please leave the lantern over their.', 'their', 'there');
  has('I would rather turn back then cross the marsh.', 'then', 'than');
  has('The travelers packed there blankets.', 'there', 'their');
  has('Her and Rowan crossed the bridge.', 'Her', 'She');
  has('Him was the first to arrive.', 'Him', 'He');
  for (const text of [
    'Her red coat was gone.', 'Her painted shutters were closed.',
    'Your right to remain silent is protected.', 'Your free will matters.',
    'Your early arrival surprised the captain.', 'Your welcome to the village was warm.',
    'Those horse blankets need washing.', 'Put the basket over their heads.'
  ]) assert.deepEqual(proposals(text), [], text);
});

test('manner proposals require a real predicate and preserve flat adverbs and attributive adjectives', () => {
  has('He answered the stranger careful.', 'careful', 'carefully');
  has('The old door closed sudden.', 'sudden', 'suddenly');
  has('She sang beautiful in the chapel.', 'beautiful', 'beautifully');
  for (const text of [
    'His answer to this sudden attack was calm.', 'She answered careful questions.',
    'The boy sang beautiful songs.', 'She looked beautiful by candlelight.',
    'He walked slow through the ashes.', 'The boy spoke quiet and low.'
  ]) assert.deepEqual(proposals(text), [], text);
});

test('coverage offsets remain exact after emoji and dialogue features ignore possessive apostrophes', () => {
  const text = '🐉 “The birds’ wings was wet,” she said. “Him was here.”';
  const candidate = generateGrammarCandidates(text).find(item => item.original === 'Him');
  assert.ok(candidate);
  assert.equal(text.slice(candidate.from, candidate.to), 'Him');
  assert.ok(candidate.features.includes('in-dialogue=true'));
});
