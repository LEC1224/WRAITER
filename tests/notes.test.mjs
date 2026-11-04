import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection, NodeSelection, AllSelection } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { captureNoteTarget, applyNote } from '../src/notes.js';

function editorFor(doc, selection) {
  const editor = { state: EditorState.create({ schema, doc, selection }), isDestroyed: false, commands: { focus() {} } };
  editor.view = { dispatch(tr) { editor.state = editor.state.apply(tr); } };
  return editor;
}
test('note insertion preserves selected prose and its formatting', () => {
  const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, [schema.text('one '), schema.text('two', [schema.marks.bold.create()]), schema.text(' three')])]);
  const editor = editorFor(doc, TextSelection.create(doc, 5, 8));
  assert.equal(applyNote(captureNoteTarget(editor), { kind: 'footnote', text: '  A note\nSecond line  ' }), true);
  assert.equal(editor.state.doc.textContent, 'one two three');
  const paragraph = editor.state.doc.firstChild;
  assert.equal(paragraph.child(1).marks[0].type.name, 'bold');
  assert.equal(paragraph.child(2).type.name, 'note');
  assert.equal(paragraph.child(2).attrs.text, '  A note\nSecond line  ');
});
test('editing a selected note changes only that note and refuses stale targets', () => {
  const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, [schema.text('Before'), schema.nodes.note.create({ kind: 'footnote', text: 'Original' }), schema.text('After')])]);
  const editor = editorFor(doc, NodeSelection.create(doc, 7)), target = captureNoteTarget(editor);
  assert.equal(applyNote(target, { kind: 'endnote', text: 'Edited' }), true);
  assert.equal(editor.state.doc.textContent, 'BeforeAfter');
  assert.equal(editor.state.doc.firstChild.child(1).attrs.kind, 'endnote');
  assert.equal(applyNote(target, { kind: 'footnote', text: 'Stale' }), false);
});

test('a select-all range inserts at the last text position without replacing the document', () => {
  const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('Keep all prose'))]);
  const editor = editorFor(doc, new AllSelection(doc));
  assert.equal(applyNote(captureNoteTarget(editor), { kind: 'footnote', text: 'A note' }), true);
  assert.equal(editor.state.doc.textContent, 'Keep all prose');
  assert.equal(editor.state.doc.firstChild.lastChild.type.name, 'note');
  editor.state.doc.check();
});
