import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { revisionTransaction } from '../src/revisions.js';
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' }, hardBreak: { inline: true, group: 'inline' } }, marks: { bold: {}, italic: {} } });
const text = (value, mark) => schema.text(value, mark ? [schema.marks[mark].create()] : []);
const para = (...nodes) => schema.node('paragraph', null, nodes);
const stateFor = (...paragraphs) => EditorState.create({ doc: schema.node('doc', null, paragraphs), plugins: [history()] });
test('a correction preserves unchanged styled spans and supports atomic undo', () => {
  const original = stateFor(para(text('She '), text('quietly', 'italic'), text(' opend the door.')));
  const tr = revisionTransaction(original, 1, original.doc.content.size - 1, 'She quietly opened the door.');
  assert.ok(tr);
  const updated = original.apply(tr);
  assert.equal(updated.doc.textContent, 'She quietly opened the door.');
  let marked = '';
  updated.doc.descendants(node => { if (node.isText && node.marks.some(m => m.type.name === 'italic')) marked += node.text; });
  assert.equal(marked, 'quietly');
  let restored;
  assert.equal(undo(updated, transaction => { restored = updated.apply(transaction); }), true);
  assert.deepEqual(restored.doc.toJSON(), original.doc.toJSON());
});
test('multi-paragraph correction keeps paragraph and mark structure', () => {
  const original = stateFor(para(text('A quiet nite.')), para(text('A ', 'bold'), text('new beginning.')));
  const tr = revisionTransaction(original, 1, original.doc.content.size - 1, 'A quiet night.\nA new beginning.');
  assert.ok(tr);
  const updated = original.apply(tr);
  assert.equal(updated.doc.childCount, 2);
  assert.equal(updated.doc.child(1).firstChild.marks[0].type.name, 'bold');
});
test('changes outside a selection survive an accepted revision', () => {
  const original = stateFor(para(text('Before. A typo. After.')));
  const updated = original.apply(revisionTransaction(original, 9, 16, 'A correction.'));
  assert.equal(updated.doc.textContent, 'Before. A correction. After.');
});
test('paragraph restructuring requires explicit simplified-formatting path', () => {
  const original = stateFor(para(text('First paragraph.')), para(text('Second paragraph.')));
  assert.equal(revisionTransaction(original, 1, original.doc.content.size - 1, 'One paragraph.'), null);
});
test('hard breaks cannot accidentally become incorrect text positions', () => {
  const original = stateFor(para(text('A'), schema.node('hardBreak'), text('B')));
  assert.equal(revisionTransaction(original, 1, original.doc.content.size - 1, 'A\nC'), null);
});
