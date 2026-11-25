import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { documentSnapshot } from '../src/document-snapshot.js';
import { associateHistoryContent, createHistory, recordTransaction, applyHistory } from '../src/history.js';

test('incremental editor snapshots match the native JSON across rich edits and remain valid for history', () => {
  const initial = schema.nodeFromJSON({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A heading' }] },
    { type: 'paragraph', attrs: { textAlign: 'center', firstLineIndent: 9 }, content: [{ type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'and plain' }, { type: 'hardBreak' }, { type: 'text', text: 'a second line' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A list item', marks: [{ type: 'italic' }] }] }] }] },
    { type: 'paragraph' }
  ] });
  let state = EditorState.create({ schema, doc: initial });
  const beforeContent = associateHistoryContent(documentSnapshot(state.doc), state.doc);
  assert.deepEqual(beforeContent, state.doc.toJSON());
  const frozenBefore = JSON.stringify(beforeContent);
  const before = { id: 'snapshot-test', chapters: [{ id: 'one', title: 'One', content: beforeContent }] };
  const journal = createHistory(before);
  const tr = state.tr.insertText('New ', 1);
  state = state.apply(tr);
  const afterContent = associateHistoryContent(documentSnapshot(state.doc), state.doc);
  assert.deepEqual(afterContent, state.doc.toJSON());
  assert.equal(JSON.stringify(beforeContent), frozenBefore, 'An earlier saved snapshot changed after typing');
  const after = { ...before, chapters: [{ ...before.chapters[0], content: afterContent }] };
  const updated = recordTransaction(journal, { chapterId: 'one', transaction: tr, beforeProject: before, afterProject: after });
  const undone = applyHistory(after, updated, 'undo', schema);
  assert.deepEqual(undone.project.chapters[0].content, initial.toJSON());
  const redone = applyHistory(undone.project, undone.journal, 'redo', schema);
  assert.deepEqual(redone.project.chapters[0].content, state.doc.toJSON());

  const later = state.tr.setSelection(TextSelection.create(state.doc, 2, 5)).addMark(2, 5, schema.marks.italic.create());
  state = state.apply(later);
  assert.deepEqual(documentSnapshot(state.doc), state.doc.toJSON());
  assert.deepEqual(JSON.parse(JSON.stringify(documentSnapshot(state.doc))), JSON.parse(JSON.stringify(state.doc.toJSON())));
  assert.equal(JSON.stringify(beforeContent), frozenBefore, 'Formatting changed an earlier saved snapshot');
});
