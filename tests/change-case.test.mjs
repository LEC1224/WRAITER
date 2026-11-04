import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { changeCaseTransaction } from '../src/change-case.js';

function selected(content, from, to) {
  const doc = schema.nodeFromJSON({ type: 'doc', content });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) });
}

test('uppercase handles Unicode expansion while keeping per-run marks and selected range', () => {
  const state = selected([{ type: 'paragraph', content: [
    { type: 'text', text: 'aß', marks: [{ type: 'bold' }, { type: 'commentAnchor', attrs: { id: 'bookmark' } }] },
    { type: 'text', text: 'cD', marks: [{ type: 'italic' }] }
  ] }], 2, 4);
  const transaction = changeCaseTransaction(state, 'upper');
  assert.equal(transaction.doc.textContent, 'aSSCD');
  assert.equal(transaction.selection.from, 2); assert.equal(transaction.selection.to, 5);
  assert.ok(transaction.doc.resolve(2).marks().some(mark => mark.type.name === 'commentAnchor'));
  assert.equal(transaction.doc.firstChild.lastChild.marks[0].type.name, 'italic');
  assert.equal(transaction.getMeta('historyLabel'), 'Change text case');
});

test('title and sentence casing carry boundaries across formatted runs', () => {
  const content = [{ type: 'paragraph', content: [
    { type: 'text', text: 'hEL', marks: [{ type: 'bold' }] },
    { type: 'text', text: 'LO wÖRLD. i AM here!' }
  ] }];
  const state = selected(content, 1, 23);
  assert.equal(changeCaseTransaction(state, 'title').doc.textContent, 'Hello Wörld. I Am Here!');
  assert.equal(changeCaseTransaction(state, 'sentence').doc.textContent, 'Hello wörld. I am here!');
});

test('empty selection cannot change case and unchanged text needs no transaction', () => {
  const state = selected([{ type: 'paragraph', content: [{ type: 'text', text: 'lower' }] }], 1, 6);
  assert.equal(changeCaseTransaction(state, 'lower'), null);
  assert.throws(() => changeCaseTransaction(EditorState.create({ schema, doc: state.doc }), 'upper'), /Select text/);
});
