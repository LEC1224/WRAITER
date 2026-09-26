import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { documentWordCount, updateWordCount } from '../src/word-count.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' }
  }
});
const paragraph = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const state = (...blocks) => EditorState.create({ schema, doc: schema.node('doc', null, blocks) });
function check(before, transaction) {
  assert.equal(updateWordCount(documentWordCount(before.doc), transaction), documentWordCount(transaction.doc));
}

test('incremental word counts stay exact for typing, deleting, splitting and joining blocks', () => {
  let current = state(paragraph('One careful sentence.'), paragraph('A second line.'));
  for (const make of [
    value => value.tr.insertText('ly', 4),
    value => value.tr.insertText(' new words ', 5),
    value => value.tr.delete(2, 8),
    value => value.tr.split(6),
    value => value.tr.join(value.doc.child(0).nodeSize)
  ]) {
    const transaction = make(current); check(current, transaction); current = current.apply(transaction);
  }
});

test('incremental word counts handle multi-step and nested replacements', () => {
  const before = state(paragraph('Alpha beta'), schema.node('blockquote', null, [paragraph('Nested words here')]), paragraph('Omega'));
  const transaction = before.tr.insertText(' bright', 6).insertText(' ending', before.doc.content.size - 1).delete(1, 3);
  check(before, transaction);
});
