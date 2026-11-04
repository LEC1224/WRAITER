import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { chapterSplitPlan, splitChapterAtCursor } from '../src/chapter-split.js';
import { reconcileCommentChapters, commentRanges } from '../src/comments.js';
import { normalizeHistoryProject, createHistory, recordProjectChange, applyHistory } from '../src/history.js';

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const p = (value = '', marks) => ({ type: 'paragraph', ...(value ? { content: [text(value, marks)] } : {}) });
const h = value => ({ type: 'heading', attrs: { level: 2 }, content: [text(value)] });
function fixture(blocks) {
  return normalizeHistoryProject({ id: 'split-project', title: 'Synthetic manuscript', notes: 'Private notes',
    chapters: [
      { id: 'earlier', title: 'Earlier', content: { type: 'doc', content: [p('Earlier chapter.')] } },
      { id: 'one', title: 'Opening', status: 'Revising', content: { type: 'doc', content: blocks } },
      { id: 'later', title: 'Later', content: { type: 'doc', content: [p('Later chapter.')] } }
    ] }, schema);
}
function stateAt(project, find, offset = 0) {
  const doc = schema.nodeFromJSON(project.chapters[1].content);
  let at;
  doc.descendants((node, pos) => { if (at === undefined && node.isTextblock && node.textContent === find) at = pos + 1 + offset; });
  assert.notEqual(at, undefined, `Missing block: ${find}`);
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, at) });
}
const contents = project => project.chapters.map(chapter => schema.nodeFromJSON(chapter.content).textContent);

test('split inside a formatted heading promotes its entire title and inserts immediately after the source', () => {
  const source = fixture([p('The old ending.'), h('The Taste Test'), p('The new opening.'), p('More prose.')]);
  const saved = structuredClone(source), state = stateAt(source, 'The Taste Test', 14);
  const result = splitChapterAtCursor(source, 'one', state, 'new-chapter');
  assert.equal(JSON.stringify(source), JSON.stringify(saved));
  assert.deepEqual(result.project.chapters.map(chapter => chapter.id), ['earlier', 'one', 'new-chapter', 'later']);
  assert.deepEqual(contents(result.project), ['Earlier chapter.', 'The old ending.', 'The new opening.More prose.', 'Later chapter.']);
  assert.equal(result.title, 'The Taste Test');
  assert.equal(result.project.chapters[2].status, 'Revising');
  assert.strictEqual(result.project.chapters[3], source.chapters[2]);
  assert.equal(result.project.notes, source.notes);
  assert.deepEqual(result.selection, { type: 'text', anchor: 1, head: 1 });
});

test('title detection works inside any part of a heading and immediately beside it', () => {
  const source = fixture([p('Before.'), p(), h('The Taste Test'), p(), p('After.')]);
  const doc = schema.nodeFromJSON(source.chapters[1].content), positions = [];
  doc.forEach((node, pos) => {
    if (node.type.name === 'heading') for (const offset of [0, 4, node.content.size]) positions.push(pos + 1 + offset);
    if (node.type.name === 'paragraph' && !node.content.size) positions.push(pos + 1);
    if (node.textContent === 'Before.') positions.push(pos + 1 + node.content.size);
    if (node.textContent === 'After.') positions.push(pos + 1);
  });
  for (const at of positions) {
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, at) });
    const plan = chapterSplitPlan(state);
    assert.equal(plan?.title, 'The Taste Test', `Cursor ${at}`);
    assert.equal(plan.before.textContent, 'Before.');
    assert.equal(plan.after.textContent, 'After.');
  }
});

test('a prose cursor splits exactly there, retaining marks, attributes, images and later blocks', () => {
  const mark = { type: 'italic' }, anchor = { type: 'commentAnchor', attrs: { id: 'split-note' } };
  const paragraph = { ...p('AlphaBeta', [mark, anchor]), attrs: { textAlign: 'right', lineHeight: '2' } };
  const source = fixture([h('Distant heading'), p('An intervening paragraph.'), paragraph,
    { type: 'image', attrs: { src: 'data:image/png;base64,aGVsbG8=', alt: 'Synthetic image' } }, p('Final text.')]);
  source.comments = [{ id: 'split-note', chapterId: 'one', text: 'Keep this note', quote: 'AlphaBeta' }];
  const result = splitChapterAtCursor(source, 'one', stateAt(source, 'AlphaBeta', 5), 'new-chapter');
  assert.equal(result.title, 'Chapter 3');
  const left = schema.nodeFromJSON(result.project.chapters[1].content), right = schema.nodeFromJSON(result.project.chapters[2].content);
  assert.ok(left.textContent.endsWith('Alpha')); assert.ok(right.textContent.startsWith('Beta'));
  assert.equal(left.lastChild.attrs.textAlign, 'right'); assert.equal(right.firstChild.attrs.lineHeight, '2');
  assert.equal(right.child(1).type.name, 'image'); assert.equal(right.child(1).attrs.alt, 'Synthetic image');
  assert.ok(right.firstChild.firstChild.marks.some(mark => mark.type.name === 'italic'));
  assert.equal(commentRanges(result.project.chapters[1].content, 'split-note').length, 1);
  assert.equal(commentRanges(result.project.chapters[2].content, 'split-note').length, 1);
  left.check(); right.check();
});

test('a heading behind ordinary prose is not consumed when splitting inside that prose', () => {
  const source = fixture([p('Before.'), h('A heading'), p('After the heading.')]);
  const result = splitChapterAtCursor(source, 'one', stateAt(source, 'After the heading.', 6), 'new-chapter');
  assert.equal(result.title, 'Chapter 3');
  assert.equal(contents(result.project)[1], 'Before.A headingAfter ');
  assert.equal(contents(result.project)[2], 'the heading.');
});

test('ordinary paragraph boundaries move whole paragraphs without extra empty paragraphs', () => {
  const source = fixture([p('First.'), p('Second.'), p('Third.')]);
  for (const state of [stateAt(source, 'First.', 6), stateAt(source, 'Second.')]) {
    const result = splitChapterAtCursor(source, 'one', state, 'new-chapter');
    assert.equal(result.project.chapters[1].content.content.length, 1);
    assert.equal(result.project.chapters[2].content.content.length, 2);
    assert.equal(contents(result.project)[1], 'First.');
    assert.equal(contents(result.project)[2], 'Second.Third.');
  }
});

test('nested lists, blockquotes and table cells remain valid when divided inside text', () => {
  const wrappers = [
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('AlphaBeta')] }, { type: 'listItem', content: [p('Next item.')] }] },
    { type: 'blockquote', content: [p('AlphaBeta'), p('Next quote.')] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('AlphaBeta')] }] }] }
  ];
  for (const wrapper of wrappers) {
    const source = fixture([p('Before.'), wrapper, p('After.')]);
    const plan = chapterSplitPlan(stateAt(source, 'AlphaBeta', 5));
    assert.ok(plan.before.textContent.endsWith('Alpha'));
    assert.ok(plan.after.textContent.startsWith('Beta'));
    assert.equal(plan.before.lastChild.type.name, wrapper.type);
    assert.equal(plan.after.firstChild.type.name, wrapper.type);
    plan.before.check(); plan.after.check();
  }
});

test('moved passage comments change chapters and commented headings retain their anchors', () => {
  const anchor = { type: 'commentAnchor', attrs: { id: 'heading-note' } };
  const source = fixture([p('Before.'), { ...h('Commented title'), content: [text('Commented title', [anchor])] }, p('After.')]);
  source.comments = [{ id: 'heading-note', chapterId: 'one', text: 'A note on the title', quote: 'Commented title' }];
  const result = splitChapterAtCursor(source, 'one', stateAt(source, 'Commented title', 5), 'new-chapter');
  const project = reconcileCommentChapters(result.project, schema);
  assert.equal(result.title, 'Commented title');
  assert.equal(project.chapters[2].content.content[0].type, 'heading');
  assert.equal(project.comments[0].chapterId, 'new-chapter');
  assert.equal(commentRanges(project.chapters[2].content, 'heading-note').length, 1);
});

test('empty chapters, start/end cursors and selected text cannot create a meaningless split', () => {
  for (const blocks of [[p()], [p('Only text.')], [h('Only title')]]) {
    const source = fixture(blocks), doc = schema.nodeFromJSON(source.chapters[1].content);
    for (const at of [1, doc.content.size - 1]) {
      assert.equal(chapterSplitPlan(EditorState.create({ schema, doc, selection: TextSelection.create(doc, at) })), null);
    }
  }
  const source = fixture([p('Before.'), h('Title'), p('After.')]), state = stateAt(source, 'Title');
  assert.equal(chapterSplitPlan(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 3)))), null);
  assert.equal(chapterSplitPlan(state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))), null);
});

test('one persistent undo/redo restores chapter order, headings, comments and the right cursor', () => {
  const source = fixture([p('Before.'), h('New title'), p('After.', [{ type: 'commentAnchor', attrs: { id: 'moved-note' } }])]);
  source.comments = [{ id: 'moved-note', chapterId: 'one', text: 'Keep me', quote: 'After.' }];
  const state = stateAt(source, 'New title', 4), result = splitChapterAtCursor(source, 'one', state, 'new-chapter');
  const next = reconcileCommentChapters(result.project, schema);
  const history = recordProjectChange(createHistory(source), source, next, {
    label: 'Divide chapter', chapterId: 'one', chapterIdAfter: result.chapterId,
    selectionBefore: state.selection.toJSON(), selectionAfter: result.selection
  });
  // Rehydrate the journal as a reopened manuscript would.
  const loaded = createHistory(next, { events: JSON.parse(JSON.stringify(history.events)) });
  const undone = applyHistory(next, loaded, 'undo', schema);
  assert.deepEqual(structuredClone(undone.project.chapters), structuredClone(source.chapters));
  assert.deepEqual(undone.project.comments, source.comments);
  assert.equal(undone.chapterId, 'one'); assert.deepEqual(undone.selection, state.selection.toJSON());
  const redone = applyHistory(undone.project, undone.journal, 'redo', schema);
  assert.deepEqual(structuredClone(redone.project.chapters), structuredClone(next.chapters));
  assert.deepEqual(redone.project.comments, next.comments);
  assert.equal(redone.chapterId, 'new-chapter'); assert.deepEqual(redone.selection, result.selection);
});
