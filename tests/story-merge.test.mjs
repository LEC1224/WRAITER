import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingWriting, readStoryPlan, storyMergePrompt, integrateWriting, suggestStoryPlacements } from '../electron/story-merge.mjs';

const para = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks && { marks }) }] });
const chapter = (id, ...content) => ({ id, title: id, content: { type: 'doc', content } });
const book = (...chapters) => ({ id: 'book', title: 'The gate', chapters });
const base = book(chapter('Door', para('The latch clicked.')), chapter('End', para('They went home.')));
const target = book(base.chapters[0], chapter('Market', para('Ada bought an iron key.')), base.chapters[1]);
const source = book(base.chapters[0], chapter('Passage', para('She used a brass key.', [{ type: 'italic' }])), base.chapters[1]);
const placement = { id: 'Passage', kind: 'chapter', targetId: 'Market', afterBlock: 0, reason: 'The purchase precedes the locked gate.', continuity: 'Match the iron key bought at the market.', edits: [{ block: 0, before: 'a brass', after: 'an iron', reason: 'The key is iron.' }] };
const read = (plan, candidates = incomingWriting(base, target, source)) => readStoryPlan(JSON.stringify({ placements: [plan] }), target, candidates);
const allocate = (type, id) => type + '-' + id;

test('AI places a discarded chapter and applies only reviewed edits with rich formatting intact', () => {
  const candidates = incomingWriting(base, target, source), plan = read(placement);
  const merged = integrateWriting(target, source, candidates, plan, allocate);
  assert.deepEqual(merged.chapters.map(ch => ch.id), ['Door', 'Market', 'Passage', 'End']);
  const run = merged.chapters[2].content.content[0].content[0];
  assert.equal(run.text, 'She used an iron key.'); assert.equal(run.marks[0].type, 'italic');
  const custom = [{ ...plan[0], kind: 'passage', targetId: 'End', afterBlock: 0, edits: plan[0].edits.map(edit => ({ ...edit, enabled: false })) }];
  const inserted = integrateWriting(target, source, candidates, custom, allocate);
  assert.equal(inserted.chapters.length, target.chapters.length);
  assert.equal(inserted.chapters.at(-1).content.content[0].content[0].text, 'She used a brass key.');
  assert.equal(inserted.chapters.at(-1).content.content[1].content[0].text, 'They went home.');
  assert.equal(source.chapters[1].content.content[0].content[0].text, 'She used a brass key.');
});
test('a shared chapter contributes only incoming blocks, excluding inherited and already-applied edits', () => {
  const old = book(chapter('Entry', para('Same.'), para('Old.'), para('End.')));
  const live = book(chapter('Entry', para('Same.'), para('Changed.'), para('End.'), para('My ending.')));
  const alternate = book(chapter('Entry', para('Same.'), para('Changed.'), para('End.'), para('Their ending.')));
  const candidates = incomingWriting(old, live, alternate);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].blocks.map(block => block.content[0].text), ['Their ending.']);
});
test('invented anchors, quotes, duplicate edits and incomplete model output cannot change a draft', () => {
  for (const plan of [{ ...placement, targetId: 'absent' }, { ...placement, kind: 'passage', afterBlock: 12 }, { ...placement, id: 'wrong' }, { ...placement, edits: [{ ...placement.edits[0], before: 'gold' }] }, { ...placement, edits: [...placement.edits, ...placement.edits] }]) assert.throws(() => read(plan), /matched/);
  assert.throws(() => readStoryPlan('bad', target, []), /unreadable/);
});
test('the prompt carries bounded chronology evidence and only enabled reference material', () => {
  const candidates = incomingWriting(base, target, source);
  const draft = { ...target, references: [{ name: 'Canon', text: 'The iron key opens the gate.' }, { name: 'Private', text: 'OMIT THIS', enabled: false }] };
  const prompt = storyMergePrompt(draft, candidates);
  assert.match(prompt.user, /Ada bought an iron key/); assert.match(prompt.user, /opens the gate/); assert.doesNotMatch(prompt.user, /OMIT THIS/);
  assert.match(prompt.user, /She used a brass key/);
});

test('a malformed model plan gets one repair attempt and never becomes a partial merge', async () => {
  const candidates = incomingWriting(base, target, source), calls = [];
  const plan = await suggestStoryPlacements(target, candidates, async prompt => {
    calls.push(prompt);
    return calls.length === 1 ? 'bad' : JSON.stringify({ placements: [placement] });
  }, new AbortController().signal);
  assert.equal(calls.length, 2); assert.equal(plan.placements[0].targetId, 'Market');
  await assert.rejects(suggestStoryPlacements(target, candidates, async () => '{}', new AbortController().signal), /matched/);
});
