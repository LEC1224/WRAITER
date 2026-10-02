import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { AllSelection, EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { editorialSchema } from '../electron/editor-schema.mjs';
import { captureFormatting, formattingTransaction } from '../src/format-painter.js';
import { createHistory, recordTransaction, applyHistory, HISTORY_SELECTION_META } from '../src/history.js';

const schema = new Schema({ nodes: editorialSchema.spec.nodes, marks: editorialSchema.spec.marks.update('commentAnchor', {
  attrs: { id: {} }, inclusive: false, excludes: ''
}) });
const mark = (name, attrs) => schema.marks[name].create(attrs);
const text = (value, marks = []) => schema.text(value, marks);
const paragraph = (value = '', attrs = {}, marks = []) => schema.node('paragraph', attrs, value ? text(value, marks) : undefined);
const document = (...content) => schema.node('doc', null, content);
function stateAt(doc, from = 1, to = from) { return EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) }); }
function positionOf(doc, value) {
  let found;
  doc.descendants((node, position) => { if (found == null && node.isText && node.text.includes(value)) found = position + node.text.indexOf(value); });
  assert.notEqual(found, undefined, `Missing test text: ${value}`);
  return found;
}
function markedCharacters(doc, name) {
  const result = [];
  doc.descendants((node, position) => { if (node.isText) for (let offset = 0; offset < node.text.length; offset++) result.push({ at: position + offset, text: node.text[offset], marks: node.marks.filter(item => item.type.name === name).map(item => ({ ...item.attrs })) }); });
  return result;
}
const sourceFormat = () => captureFormatting(stateAt(document(schema.node('heading', {
  level: 2, textAlign: 'center', lineHeight: 2, spaceAfter: 16, firstLineIndent: 18, pageBreakBefore: true
}, text('Source', [mark('bold'), mark('underline'), mark('strike'), mark('textStyle', { fontFamily: 'Georgia', fontSize: '18pt', color: '#123456', backgroundColor: '#aabbcc' }), mark('highlight', { color: '#ffaa99' }), mark('link', { href: 'https://source.example/' }), mark('commentAnchor', { id: 'source-comment' })]))), 1, 7));

test('format copy uses selection start and excludes source text, links, comments and page breaks', () => {
  const doc = document(schema.node('paragraph', null, [text('plain '), text('bold', [mark('bold')])]));
  const buffer = captureFormatting(stateAt(doc, 1, 11), { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 });
  assert.deepEqual(buffer.marks, [{ type: 'textStyle', attrs: { fontFamily: 'Cambria', fontSize: '12pt' } }]);
  assert.equal(buffer.paragraph.type, 'paragraph');
  assert.equal(buffer.paragraph.attrs.lineHeight, 1.5);
  assert.equal(buffer.sample, 'Formatting at selection start');
  const rich = sourceFormat();
  assert.deepEqual(rich.marks.map(item => item.type).sort(), ['bold', 'highlight', 'strike', 'textStyle', 'underline']);
  assert.equal(rich.paragraph.attrs.level, 2);
  assert.equal(Object.hasOwn(rich.paragraph.attrs, 'pageBreakBefore'), false);
  assert.equal(JSON.stringify(rich).includes('source-comment'), false);
  assert.equal(JSON.stringify(rich).includes('source.example'), false);
  assert.equal(JSON.stringify(rich).includes('Source'), false);
});

test('plain heading formatting keeps the heading size and spacing instead of inserting body defaults', () => {
  const doc = document(schema.node('heading', { level: 2 }, text('Heading')));
  const buffer = captureFormatting(stateAt(doc, 1, 8), { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 });
  assert.deepEqual(buffer.marks, [{ type: 'textStyle', attrs: { fontFamily: 'Cambria' } }]);
  assert.equal(buffer.paragraph.attrs.lineHeight, null);
  const changed = formattingTransaction(stateAt(document(paragraph('Target')), 1, 7), buffer).doc.firstChild;
  assert.equal(changed.type.name, 'heading');
  assert.equal(changed.attrs.level, 2);
  assert.equal(changed.attrs.lineHeight, null);
  assert.equal(changed.firstChild.marks.find(item => item.type.name === 'textStyle').attrs.fontSize, null);
});

test('selection paste replaces visual formatting while retaining words, target links and overlapping comments', () => {
  const doc = document(paragraph('Before '), paragraph('target', { pageBreakBefore: true }, [
    mark('italic'), mark('textStyle', { fontFamily: 'Arial', color: '#abcdef' }),
    mark('link', { href: 'https://target.example/' }), mark('commentAnchor', { id: 'target-comment-one' }), mark('commentAnchor', { id: 'target-comment-two' })
  ]), paragraph('After'));
  const start = positionOf(doc, 'target'), state = stateAt(doc, start, start + 6), transaction = formattingTransaction(state, sourceFormat());
  const changed = transaction.doc.child(1);
  assert.equal(transaction.doc.textContent, doc.textContent);
  assert.equal(changed.type.name, 'heading');
  assert.equal(changed.attrs.level, 2);
  assert.equal(changed.attrs.pageBreakBefore, true);
  assert.equal(changed.attrs.textAlign, 'center');
  assert.equal(changed.attrs.spaceAfter, 16);
  assert.equal(changed.attrs.firstLineIndent, 18);
  assert.deepEqual(markedCharacters(transaction.doc, 'link'), markedCharacters(doc, 'link'));
  assert.deepEqual(markedCharacters(transaction.doc, 'commentAnchor'), markedCharacters(doc, 'commentAnchor'));
  assert.ok(changed.firstChild.marks.some(item => item.type.name === 'bold'));
  assert.ok(changed.firstChild.marks.some(item => item.type.name === 'underline'));
  assert.ok(changed.firstChild.marks.some(item => item.type.name === 'strike'));
  assert.equal(changed.firstChild.marks.some(item => item.type.name === 'italic'), false);
  assert.equal(changed.firstChild.marks.find(item => item.type.name === 'textStyle').attrs.fontFamily, 'Georgia');
  assert.equal(changed.firstChild.marks.find(item => item.type.name === 'highlight').attrs.color, '#ffaa99');
  assert.deepEqual(transaction.doc.firstChild.toJSON(), doc.firstChild.toJSON());
  assert.deepEqual(transaction.doc.lastChild.toJSON(), doc.lastChild.toJSON());
  transaction.doc.check();
});

test('caret paste formats its complete paragraph, resets a heading to Normal, and preserves manual page breaks', () => {
  const normal = captureFormatting(stateAt(document(paragraph('Plain'))));
  const doc = document(paragraph('Other', {}, [mark('bold')]), schema.node('heading', { level: 3, textAlign: 'right', pageBreakBefore: true }, text('Whole target paragraph', [mark('bold'), mark('italic'), mark('highlight', { color: '#fff29b' })])), paragraph('Last'));
  const state = stateAt(doc, positionOf(doc, 'target') + 2), transaction = formattingTransaction(state, normal);
  assert.equal(transaction.doc.child(1).type.name, 'paragraph');
  assert.equal(transaction.doc.child(1).attrs.textAlign, null);
  assert.equal(transaction.doc.child(1).attrs.pageBreakBefore, true);
  assert.equal(transaction.doc.child(1).firstChild.marks.length, 0);
  assert.deepEqual(transaction.doc.firstChild.toJSON(), doc.firstChild.toJSON());
  assert.equal(transaction.selection.from, state.selection.from);
  assert.deepEqual(transaction.storedMarks, []);
  assert.equal(transaction.doc.textContent, doc.textContent);
});

test('character formatting affects only selected text even when the source has fewer marks', () => {
  const buffer = captureFormatting(stateAt(document(paragraph('Italic', {}, [mark('italic')]))));
  const doc = document(paragraph('left middle right', {}, [mark('bold'), mark('highlight', { color: '#ff0000' }), mark('commentAnchor', { id: 'keep' })]));
  const start = positionOf(doc, 'middle'), transaction = formattingTransaction(stateAt(doc, start, start + 6), buffer);
  assert.deepEqual(transaction.doc.firstChild.content.content.map(node => [node.text, node.marks.map(item => item.type.name)]), [
    ['left ', ['bold', 'highlight', 'commentAnchor']], ['middle', ['italic', 'commentAnchor']], [' right', ['bold', 'highlight', 'commentAnchor']]
  ]);
  assert.deepEqual(markedCharacters(transaction.doc, 'commentAnchor'), markedCharacters(doc, 'commentAnchor'));
});

test('a heading source retains list and table structure instead of converting list items', () => {
  const list = schema.node('bulletList', null, [schema.node('listItem', null, paragraph('List target'))]);
  const table = schema.node('table', null, [schema.node('tableRow', null, [schema.node('tableCell', null, paragraph('Cell target'))])]);
  const doc = document(list, table), state = EditorState.create({ schema, doc, selection: new AllSelection(doc) });
  const transaction = formattingTransaction(state, sourceFormat());
  assert.equal(transaction.doc.firstChild.type.name, 'bulletList');
  assert.equal(transaction.doc.firstChild.firstChild.type.name, 'listItem');
  assert.equal(transaction.doc.firstChild.firstChild.firstChild.type.name, 'paragraph');
  assert.equal(transaction.doc.firstChild.firstChild.firstChild.attrs.textAlign, 'center');
  assert.equal(transaction.doc.lastChild.firstChild.firstChild.type.name, 'tableCell');
  assert.equal(transaction.doc.lastChild.firstChild.firstChild.firstChild.type.name, 'heading');
  assert.equal(transaction.doc.textContent, doc.textContent);
  assert.equal(transaction.doc.firstChild.firstChild.firstChild.attrs.pageBreakBefore, null);
  transaction.doc.check();
});

test('formatting into an empty paragraph supplies typing marks without importing IDs', () => {
  const doc = document(paragraph()), state = stateAt(doc), transaction = formattingTransaction(state, sourceFormat());
  assert.equal(transaction.doc.firstChild.type.name, 'heading');
  assert.equal(transaction.doc.firstChild.attrs.pageBreakBefore, null);
  assert.ok(transaction.storedMarks.some(item => item.type.name === 'bold'));
  assert.equal(transaction.storedMarks.some(item => ['link', 'commentAnchor'].includes(item.type.name)), false);
  const after = state.apply(transaction), typed = after.tr.insertText('New words');
  assert.equal(typed.doc.textContent, 'New words');
  assert.ok(typed.doc.firstChild.firstChild.marks.some(item => item.type.name === 'bold'));
  typed.doc.check();
});

test('format paste is one persistent undo entry across character and paragraph changes', () => {
  const doc = document(paragraph('Target paragraph', { pageBreakBefore: true }, [mark('italic'), mark('link', { href: 'https://keep.example/' })]));
  const state = stateAt(doc, 1, doc.firstChild.content.size + 1), transaction = formattingTransaction(state, sourceFormat()).setMeta(HISTORY_SELECTION_META, state.selection.toJSON());
  const before = { id: 'format-project', title: 'Format test', chapters: [{ id: 'chapter-one', title: 'Chapter one', content: doc.toJSON() }], documentStyle: { fontFamily: 'Cambria', fontSize: 12 }, notes: '' };
  const after = { ...before, chapters: [{ ...before.chapters[0], content: transaction.doc.toJSON() }] };
  const journal = recordTransaction(createHistory(before), { beforeProject: before, afterProject: after, chapterId: 'chapter-one', transaction });
  assert.equal(journal.entries.length, 1);
  const persisted = createHistory(after, JSON.parse(JSON.stringify({ events: journal.events })));
  const undone = applyHistory(after, persisted, 'undo', schema);
  assert.deepEqual(undone.project.chapters[0].content, before.chapters[0].content);
  const redone = applyHistory(undone.project, undone.journal, 'redo', schema);
  assert.deepEqual(redone.project.chapters[0].content, after.chapters[0].content);
});

test('image selections and invalid buffers cannot copy or apply source content', () => {
  const doc = document(schema.node('image', { src: 'data:image/png;base64,AA==' }), paragraph('Text'));
  const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 0) });
  assert.equal(captureFormatting(state), null);
  assert.equal(formattingTransaction(state, sourceFormat()), null);
  const textState = stateAt(document(paragraph('Text')));
  assert.equal(formattingTransaction(textState, { marks: [], paragraph: { type: 'image' } }), null);
  const malicious = { marks: [{ type: 'link', attrs: { href: 'https://source.example/' } }, { type: 'commentAnchor', attrs: { id: 'foreign-id' } }], paragraph: { type: 'paragraph', attrs: { pageBreakBefore: true } } };
  const safe = formattingTransaction(textState, malicious);
  assert.equal(safe.doc.firstChild.attrs.pageBreakBefore, null);
  assert.equal(safe.doc.firstChild.firstChild.marks.length, 0);
  assert.equal(safe.doc.textContent, 'Text');
});
