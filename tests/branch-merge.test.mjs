import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDrafts } from '../src/branch-merge.js';
const chapter = (id, ...texts) => ({ id, title: id, content: { type: 'doc', content: texts.map(text => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'italic' }] }] })) } });
const project = (...chapters) => ({ id: 'story', chapters });
const text = result => result.project.chapters[0].content.content.map(p => p.content[0].text);

test('a common ancestor combines independent rich-text edits, insertions, chapter order and metadata', () => {
  const original = project(chapter('Gate', 'Bright lamps at night.', 'Closing.'), chapter('End', 'Fin.'));
  const ours = { ...project(chapter('Gate', 'Blue lamps at night.', 'Closing.'), chapter('River', 'Cold'), original.chapters[1]), chats: ['private'], notes: 'Current notes' };
  const theirs = { ...project(chapter('Gate', 'Bright lamps at dawn.', 'Closing.', 'Afterwards.'), chapter('Wood', 'Dark'), original.chapters[1]), chats: ['other'], subtitle: 'Source subtitle' };
  const merged = mergeDrafts(original, ours, theirs);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(text(merged), ['Blue lamps at dawn.', 'Closing.', 'Afterwards.']);
  assert.deepEqual(merged.project.chapters.map(c => c.id), ['Gate', 'River', 'Wood', 'End']);
  assert.deepEqual(merged.project.chapters[0].content.content[0].content[0].marks, [{ type: 'italic' }]);
  assert.deepEqual(merged.project.chats, ['private']);
  assert.equal(merged.project.notes, 'Current notes');
  assert.equal(merged.project.subtitle, 'Source subtitle');
});
test('resolving an overlapping edit retains nonconflicting edits around it', () => {
  const original = project(chapter('One', 'She saw red.', 'Old opening.', 'Old ending.'));
  const ours = project(chapter('One', 'She saw blue.', 'New opening.', 'Old ending.'));
  const theirs = project(chapter('One', 'She saw gold.', 'Old opening.', 'New ending.'));
  const preview = mergeDrafts(original, ours, theirs);
  assert.ok(preview.conflicts.length);
  const result = mergeDrafts(original, ours, theirs, Object.fromEntries(preview.conflicts.map(conflict => [conflict.id, 'incoming'])));
  assert.deepEqual(text(result), ['She saw gold.', 'New opening.', 'New ending.']);
});
test('delete/edit decisions retain the chosen chapter and opposing deletions never leave an empty manuscript', () => {
  const a = chapter('A', 'A'), b = chapter('B', 'B'), base = project(a, b);
  const ours = project(a), theirs = project(a, chapter('B', 'Edited'));
  const review = mergeDrafts(base, ours, theirs);
  assert.equal(review.conflicts.length, 1);
  assert.equal(mergeDrafts(base, ours, theirs, { [review.conflicts[0].id]: 'incoming' }).project.chapters[1].content.content[0].content[0].text, 'Edited');
  assert.ok(mergeDrafts(base, ours, project(b)).conflicts.length);
});
test('independent removals that would leave an invalid rich-text document require a choice', () => {
  const base = project(chapter('One', 'First.', 'Last.'));
  const ours = project(chapter('One', 'First.')), theirs = project(chapter('One', 'Last.'));
  const review = mergeDrafts(base, ours, theirs);
  assert.equal(review.conflicts.length, 1);
  assert.deepEqual(text(mergeDrafts(base, ours, theirs, { [review.conflicts[0].id]: 'incoming' })), ['Last.']);
});
