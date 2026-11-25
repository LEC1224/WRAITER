import test from 'node:test';
import assert from 'node:assert/strict';
import { grammarHints, documentGrammar, localDecorationWindow, splitOfflinePassage } from '../src/local-grammar.js';
import { editorialSchema } from '../electron/editor-schema.mjs';

test('local grammar identifies exact ranges and pronunciation exceptions without network calls', () => {
  const text = 'She could of seen an university and a honest man. The the door.';
  const hints = grammarHints(text);
  assert.deepEqual(hints.map(h => [text.slice(h.from, h.to), h.replacement]), [['could of', 'could have'], ['an', 'a'], ['a', 'an'], ['The the', 'The']]);
  assert.equal(grammarHints('An hour, a university, an umbrella, a one-off event.').length, 0);
  assert.equal(grammarHints(text, 'sv-SE').length, 0);
});
test('document hints preserve document positions across styled text and skip code', () => {
  const doc = editorialSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'honest', marks: [{ type: 'bold' }] }] }, { type: 'codeBlock', content: [{ type: 'text', text: 'the the' }] }] });
  const hints = documentGrammar(doc, 'en-US');
  assert.equal(hints.length, 1); assert.equal(doc.textBetween(hints[0].from, hints[0].to), 'a');
});

test('valid grammar and deliberate emphasis are not classified as accidental repeated words', () => {
  for (const text of [
    'She had had enough.', 'He has had enough.', 'I know that that is true.',
    'What it is is a mystery.', 'What that was was never clear.',
    'I do do the washing.', 'They can can peaches.', 'He gave her her book.',
    'I take it it will be ready.', 'Is this this year’s winner?',
    'We put it in in the morning.', 'The show went on on Monday.',
    'What are you going for for lunch?', 'It was very very good.',
    'No no, please stay.', 'Yes yes, I understand.', 'I was not not listening.',
    'They ran far far away.', 'The door opened slowly slowly.',
    'A co-worker-worker is not a repeated word.', 'The theatre was empty.'
  ]) assert.deepEqual(grammarHints(text), [], text);
  const text = 'The the door and and the window. Because because she left.';
  assert.deepEqual(grammarHints(text).map(h => [text.slice(h.from, h.to), h.replacement]), [['The the', 'The'], ['and and', 'and'], ['Because because', 'Because']]);
});

test('article checks respect pronunciation exceptions and abstain for initials, labels, names and dialect variants', () => {
  for (const text of [
    'An MRI scan, a URL, an SQL query, a SQL query, an HTML page.',
    'An html page, a sql query, an sql query, an http request.',
    'An FBI agent saw a UFO. An X-ray showed a fracture.',
    'A university, a union, a unicycle, a unique story, a unit, a united team, a unified plan.',
    'A unanimous vote, a useful tool, a useless tool, a user, a usual event.',
    'A ubiquitous sight, a uranium mine, a utopia, an urban street, an utter mess.',
    'A euphemism, a eulogy, a eucalyptus tree, a ewe, a one-off event.',
    'An umbrella, an unidentified object, an unusual visit, an unhelpful reply, an unresolved problem.',
    'An honest person, an honorary title, an heirloom, an hour.',
    'An onerous task, an onion, an uncle, an urgent matter.',
    'An historic event, a historic event, an herb, a herb, a homage, an homage.',
    'A Ewan, a European, an American, an F, a B, an 8, a 1, a yttrium atom.',
    'Her “a” and “an” examples were quoted.', 'A u-shaped bend.'
  ]) assert.deepEqual(grammarHints(text), [], text);
  const text = 'A apple and an banana met a honest man with an university degree and a x-ray.';
  assert.deepEqual(grammarHints(text).map(h => [text.slice(h.from, h.to), h.replacement]), [['A', 'An'], ['an', 'a'], ['a', 'an'], ['an', 'a'], ['a', 'an']]);
});

test('modal of corrections require a following participle, leaving adverbial phrases and unfinished prose alone', () => {
  for (const text of ['She could of course help.', 'He would of course leave.', 'It must of necessity be short.', 'She could of', 'We could\nof gone.', 'could_of gone', 'could-of gone']) assert.deepEqual(grammarHints(text), [], text);
  const text = 'He could of left, would of waited, should of been ready and MIGHT OF SEEN it.';
  assert.deepEqual(grammarHints(text).map(h => [text.slice(h.from, h.to), h.replacement]), [['could of', 'could have'], ['would of', 'would have'], ['should of', 'should have'], ['MIGHT OF', 'MIGHT HAVE']]);
});

test('Unicode words, emoji offsets, paragraph boundaries and overlapping findings retain exact ranges', () => {
  const text = '🙂 A elephant. café café. an_apple. the\nthe. an an banana.';
  const hints = grammarHints(text);
  assert.deepEqual(hints.map(h => [h.from, text.slice(h.from, h.to), h.replacement]), [[3, 'A', 'An'], [45, 'an an', 'an']]);
});

test('pending revisions cannot create false local grammar hints from concatenated old and new wording', () => {
  const doc = editorialSchema.nodeFromJSON({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'the ', marks: [{ type: 'trackedChange', attrs: { id: 'delete-one', kind: 'delete' } }] }, { type: 'text', text: 'the door' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'The the window.' }] }
  ] });
  const hints = documentGrammar(doc, 'en-US');
  assert.equal(hints.length, 1); assert.equal(doc.textBetween(hints[0].from, hints[0].to), 'The the');
  assert.equal(documentGrammar(doc, 'sv-SE').length, 0);
  assert.equal(documentGrammar(doc, 'en-US').length, 1, 'Cached findings are scoped to the checking language');
});

test('offline agreement and tense checks keep exact corrections and respect subjunctives', () => {
  const text = '🙂 The dogs is tired. The dragon are awake. These is old. There is many stars. She did not went home. He said that the child were afraid.';
  assert.deepEqual(grammarHints(text).map(hint => [text.slice(hint.from, hint.to), hint.replacement]), [
    ['is', 'are'], ['are', 'is'], ['is', 'are'], ['is', 'are'], ['went', 'go'], ['were', 'was']
  ]);
  for (const valid of [
    'If the dragon were awake, it would see us.', 'I wish that the child were here.',
    'If she were here, she could help.', 'If only the dragon were here.',
    'There is many a story about the forest.', 'These are old. The dogs are tired.',
    'She did not go home.', 'She told me that the child was afraid.',
    'The things that are here belong to her.', 'The thing I told you was a secret.',
    'He did not found a religious order.', 'The root a and the variable b are equal.',
    'Pictures like this are popular.', 'There is two miles to go.', 'There is ten dollars left.',
    'One of the books is missing.', 'The color of the dragons is red.',
    'If each of the children were here, we could begin.', 'She would rather stay, then leave.',
    'The branches on it were green.', 'The leaves beneath it were dry.',
    'You and I are ready.', 'The guests who received it are leaving.', 'I wish with all my heart she were here.',
    'Anybody need not wait.', 'All the world are welcome.',
    'It is essential that everyone know the path.', 'Everybody say hello.', 'Everyone run.'
  ]) assert.deepEqual(grammarHints(valid), [], valid);
});

test('singular quantifiers and comparison phrases have conservative agreement checks', () => {
  const text = 'Each of the children have a blanket. Everyone know the path. The information are old. She would rather stay then leave. I could hard hear her. There are much people. One of the book is missing. Me went home.';
  assert.deepEqual(grammarHints(text).map(hint => [hint.original, hint.replacement]), [['have', 'has'], ['know', 'knows'], ['are', 'is'], ['then', 'than'], ['hard', 'hardly'], ['much', 'many'], ['book', 'books'], ['Me', 'I']]);
  for (const valid of ['There is much water.', 'She knows how much people care.', 'One of the books is missing.', 'To me went the prize.']) assert.deepEqual(grammarHints(valid), [], valid);
});

test('built-in and passive built corrections avoid the ordinary verb and noun', () => {
  const text = 'The build-in shelf was build with stone. The tower is build on rock.';
  assert.deepEqual(grammarHints(text).map(hint => [hint.original, hint.replacement]), [['build-in', 'built-in'], ['build', 'built'], ['build', 'built']]);
  assert.deepEqual(grammarHints('The shelf is build-in.').map(hint => hint.replacement), ['built-in']);
  for (const valid of ['They build in the forest.', 'The build is ready.', 'Please build on this idea.', 'This is build automation.']) assert.deepEqual(grammarHints(valid), [], valid);
});

test('contextual word-choice and number checks leave valid alternatives alone', () => {
  const text = "Who is coat is hanging there? The two woman spoke quietly. She took a brake from her work. He could not bare the pain any longer. He past the house. The quite stream flowed.";
  assert.deepEqual(grammarHints(text).map(hint => [hint.original, hint.replacement]), [['Who is', 'Whose'], ['woman', 'women'], ['brake', 'break'], ['bare', 'bear'], ['past', 'passed'], ['quite', 'quiet']]);
  for (const valid of ['Whose coat is hanging there?', 'The two women spoke.', 'She took a brake from the bicycle.', 'She could not bare the pain to her mother.', 'He is past the house.', 'The quiet stream flowed.', 'It was quite a view.']) assert.deepEqual(grammarHints(valid), [], valid);
});

test('contraction and infinitive rules retain possessive gerunds and noun uses', () => {
  const text = 'Their going to walk home. Their going to meet a friend. He wants go home.';
  assert.deepEqual(grammarHints(text).map(hint => [hint.original, hint.replacement]), [['Their', "They're"], ['Their', "They're"], ['go', 'to go']]);
  for (const valid of ['I heard about their going to walk.', 'I appreciated their going to help.', 'Their going to walk was unexpected.', 'Their going to walk early surprised me.', 'She wants work.', 'They are going to walk.']) {
    assert.deepEqual(grammarHints(valid), [], valid);
  }
});

test('contextual rules catch participles, number and word confusions without changing valid noun uses', () => {
  const text = 'The windows have been broke by the wind. Its raining outside. Your standing on my foot. Him and I went home. That dogs are running. There were many dog in the garden. She picked up three stone from the path. The rope was to loose to hold. The path was longer then she expected.';
  assert.deepEqual(grammarHints(text).map(hint => [hint.original, hint.replacement]), [
    ['broke', 'broken'], ['Its', "It's"], ['Your', "You're"], ['Him', 'He'], ['That', 'Those'], ['dog', 'dogs'], ['stone', 'stones'], ['to loose', 'too loose'], ['then', 'than']
  ]);
  for (const valid of [
    'Its raining caused a flood.', 'She was broke by Tuesday.', 'He weighs three stone.',
    'Many dog owners gathered.', 'The key was to loose the arrow.', 'She ate longer, then she left.',
    'Your going to walk was unexpected.', 'Your standing on my foot hurt.', 'I heard about their going to the village today.',
    'He and I went home.', 'Those dogs are running.', 'It was too loose to hold.'
  ]) assert.deepEqual(grammarHints(valid), [], valid);
});

test('long passages split at safe UTF-16 positions and never join across inline atoms', () => {
  const source = `${'A long sentence ends here. '.repeat(400)}🙂 ${'word '.repeat(900)}\ufffcafter the atom.`;
  const chunks = splitOfflinePassage(source);
  assert.ok(chunks.length > 2);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 3500);
    assert.equal(source.slice(chunk.from, chunk.from + chunk.text.length), chunk.text);
    assert.ok(!chunk.text.includes('\ufffc'));
    assert.ok(!/[\uD800-\uDBFF]$/u.test(chunk.text));
    assert.ok(!/^[\uDC00-\uDFFF]/u.test(chunk.text));
  }
  assert.equal(chunks.map(chunk => chunk.text).join(''), source.replaceAll('\ufffc', ''));
});

test('large numbers of hints follow the current editing or scrolling position', () => {
  const hints = Array.from({ length: 2000 }, (_, index) => ({ from: index * 10, to: index * 10 + 3 }));
  assert.equal(localDecorationWindow(hints, 0).length, 1000);
  assert.equal(localDecorationWindow(hints, 0)[0], hints[0]);
  assert.equal(localDecorationWindow(hints, 19999).at(-1), hints.at(-1));
  assert.ok(localDecorationWindow(hints, 10000).includes(hints[1000]));
});
