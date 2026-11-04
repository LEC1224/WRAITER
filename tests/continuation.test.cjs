const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanContinuation, ContinuationError } = require('../electron/continuation.cjs');

function rejects(text, request, reason) {
  assert.throws(() => cleanContinuation(text, request), error => error instanceof ContinuationError && error.code === 'INVALID_CONTINUATION' && (!reason || error.reason === reason));
}

test('continuations retain leading spaces, paragraphs, dialogue, fragments, and one word', () => {
  for (const text of [
    ' walked away from the door.', '\n\n“Come in,” she said.\n\nThe door creaked.',
    '"Come in," she said.', '"Not yet.', 'Then—', 'Rain', '123', 'Ja.',
    '“Jag väntar här,” sade hon.', '「また明日」と彼女は言った。', 'مرحبا بالعالم',
    'Sage looked up.', 'Dolphin swam away.', 'The technique worked perfectly.',
    'The passage follows the river for miles.', 'This passage uses old stone to brace the ceiling.',
    '“Technique: use a smaller brush,” she read.', '"Analysis: this passage uses old masonry," he read.',
    "'Analysis: this passage uses old masonry,' he read.", '‘Analysis: this passage uses old masonry,’ he read.',
    '“I need to leave,” she said.', 'The user of the old machine reached for the switch.'
  ]) assert.equal(cleanContinuation(text), text);
});

test('reported metadata leak is cut off after usable story prose', () => {
  const prose = '“Wait here,” Mara said, glancing at the gathering clouds. “I will return soon.”';
  assert.equal(cleanContinuation(`${prose}TECHNIQUE: This passage uses a mix of narrative and dialogue to build tension.`), prose);
  assert.equal(cleanContinuation(`${prose}\n\nANALYSIS:\nI should preserve the viewpoint.`), prose);
  assert.equal(cleanContinuation(`${prose}\n\nAnalysis: I should preserve the viewpoint.`), prose);
  assert.equal(cleanContinuation(`${prose}\n\nThis continuation maintains the original viewpoint.`), prose);
  rejects('TECHNIQUE: This passage uses dialogue to establish character.');
});

test('dialogue state follows the cursor context when the next output closes an existing quotation', () => {
  const before = 'He whispered, "';
  const prose = 'Come in," she said.';
  assert.equal(cleanContinuation(`${prose} TECHNIQUE: This passage uses dialogue.`, { before }), prose);
  assert.equal(cleanContinuation('Analysis: this passage uses old masonry," he read.', { before }), 'Analysis: this passage uses old masonry," he read.');
});

test('status and command responses never become story autocomplete', () => {
  for (const text of ['complete', 'Complete.', 'continue', 'completed', 'done', 'Okay!', '**complete**', '_complete_', 'no continuation', 'null', '', '   ', '...', null, undefined]) rejects(text);
  assert.equal(cleanContinuation('Complete silence filled the room.'), 'Complete silence filled the room.');
  assert.equal(cleanContinuation('“Continue,” she said.'), '“Continue,” she said.');
  assert.equal(cleanContinuation('complete', { words: 1, before: 'The job was ' }), 'complete');
  assert.equal(cleanContinuation(' ready', { words: 1, before: 'The guard was' }), ' ready');
  rejects('complete', { words: 1 });
  rejects('complete', { words: 1, before: 'The job was done. ' });
  rejects('complete', { words: 35, before: 'The job was ' });
});

test('well-known continuation wrappers and fenced prose expose only their prose', () => {
  assert.equal(cleanContinuation('Suggestion: more words'), 'more words');
  assert.equal(cleanContinuation('Here is the continuation:\n“Come in,” she said.'), '“Come in,” she said.');
  assert.equal(cleanContinuation("Sure, here's a continuation of the story:\nThe rain began."), 'The rain began.');
  assert.equal(cleanContinuation('### Continuation\nThe rain began.'), 'The rain began.');
  assert.equal(cleanContinuation('```text\n  The rain began.\n\nA bell rang.\n```'), '  The rain began.\n\nA bell rang.');
  rejects('Here is the continuation.');
  rejects('```text\nThe rain began.');
});

test('closed thinking blocks are removed, while unfinished or orphaned thinking is rejected', () => {
  assert.equal(cleanContinuation('<think>internal reasoning</think>\nSuggestion: more words'), 'more words');
  assert.equal(cleanContinuation('<think>internal reasoning</think>one two three'), 'one two three');
  assert.equal(cleanContinuation(' walked <think>private</think>away.'), ' walked away.');
  assert.equal(cleanContinuation('<thinking>private</thinking>Fresh prose.'), 'Fresh prose.');
  for (const text of ['<think>private reasoning', 'Fresh prose.<think>unfinished', '</think>Fresh prose.', '<think>only reasoning</think>', '<think', '<think\nprivate reasoning']) rejects(text);
});

test('explicit chat protocol cannot enter a continuation', () => {
  const prose = '  The gate opened.';
  for (const token of ['<|im_start|>assistant', '<|eot_id|>', '<|start_header_id|>assistant<|end_header_id|>', '[INST]', '[/INST]', '<<SYS>>', '</s>', '<assistant>', '<analysis>', '[DONE]']) {
    assert.equal(cleanContinuation(`${prose}${token}private instructions`), prose);
    rejects(`${token}private instructions`);
  }
  assert.equal(cleanContinuation(`${prose}\nAssistant: Here is another response.`), prose);
  rejects('Assistant: Here is a continuation.');
  rejects('TEXT BEFORE CURSOR:\nThe gate opened.');
});

test('context echo detection rejects substantial echo-only output without deleting ordinary repetition', () => {
  const before = 'The last candle went dark. The room fell into silence.';
  rejects(before, { before });
  rejects('The room fell into silence.', { before });
  rejects('The room\n fell into silence.', { before });
  rejects(`${before} A bell rang.`, { before });
  assert.equal(cleanContinuation('silence.', { before }), 'silence.');
  assert.equal(cleanContinuation('The room filled with light.', { before }), 'The room filled with light.');
  assert.equal(cleanContinuation('Rain', { before: 'Rain' }), 'Rain');
});

test('copied manuscript paragraphs are rejected despite altered dialogue punctuation and fresh prose afterward', () => {
  const paragraph = 'Mara watched Rowan in disbelief, searching his face for a sign that he was joking. "You mean you want me... to cross the bridge for you?"';
  const before = `Earlier, the travelers had sheltered beneath a crooked pine.\n\n${paragraph}`;
  const echoed = "mara watched Rowan in disbelief; searching his face for a sign that he was joking. 'You mean you want me… to cross the bridge for you?'";
  rejects(echoed, { before }, 'echo');
  rejects(`${echoed}\n\nHe nodded and reached for his coat.`, { before }, 'echo');
  rejects(`The fire crackled.\n\n${echoed}\n\nHe nodded.`, { before }, 'echo');
  rejects('‘You mean you want me — to cross the bridge for you?’', { before }, 'echo');
  assert.equal(cleanContinuation('He nodded and reached for his coat.', { before }), 'He nodded and reached for his coat.');
});

test('internal repeated sentences, paragraphs and persistent short loops are rejected', () => {
  const sentence = 'The lantern flickered against the wall while rain battered the shutters.';
  rejects(`${sentence} ${sentence.toUpperCase()}`, {}, 'repetition');
  const paragraph = 'Mara shut the gate and listened for approaching footsteps. The lantern flickered against the wall while rain battered the shutters.';
  rejects(`${paragraph}\n\n${paragraph.replaceAll('.', '…')}`, {}, 'repetition');
  rejects('through the gate, '.repeat(6), {}, 'repetition');
  rejects('light '.repeat(12), {}, 'repetition');
  rejects('the lantern burned brightly. '.repeat(4), {}, 'repetition');
});

test('short refrains, dialogue callbacks and ordinary emphasis remain valid', () => {
  for (const text of [
    '“No, no, no!” she said.', 'The room was very, very quiet.',
    '“Let me go,” she said. “Let me go,” she said.',
    'Never again. Never again. Never again.',
    '“Bring me the key to the northern tower,” she said. He nodded, then repeated, “Bring me the key to the northern tower.”'
  ]) assert.equal(cleanContinuation(text), text);
  assert.equal(cleanContinuation('No, no, no, no.', { before: '“No, no, no, no.' }), 'No, no, no, no.');
});

test('large context and oversized responses have bounded comparison work', { timeout: 5000 }, () => {
  const tail = 'Rowan waited beneath the stone archway until the final bell sounded.';
  const before = `${'Earlier events filled the manuscript. '.repeat(55000)}\n\n${tail}`;
  rejects(tail.toUpperCase(), { before }, 'echo');
  rejects('the lantern burned brightly. '.repeat(150000), { before }, 'repetition');
  rejects('x'.repeat(4 * 1024 * 1024), { before }, 'oversized');
});
