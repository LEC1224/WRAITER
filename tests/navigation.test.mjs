import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { paragraphLocations, currentParagraphNumber, paragraphPreview } from '../src/navigation.js';

const p = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
test('paragraph destinations follow margin order through headings, lists, quotes, tables and code', () => {
  const doc = schema.node('doc', null, [
    schema.node('heading', { level: 2 }, schema.text('A heading')), p('Plain 😊 text'), p(''),
    schema.node('bulletList', null, [schema.node('listItem', null, [p('List A'), p('List B')]), schema.node('listItem', null, p('List C'))]),
    schema.node('blockquote', null, p('A quote')),
    schema.node('table', null, schema.node('tableRow', null, [schema.node('tableHeader', null, p('Header')), schema.node('tableCell', null, p('Cell'))])),
    schema.node('horizontalRule'), schema.node('image', { src: 'data:image/png;base64,AA==' }), schema.node('codeBlock', null, schema.text('Code\nnext line'))
  ]);
  doc.check();
  const paragraphs = paragraphLocations(doc);
  assert.deepEqual(paragraphs.map(item => item.node.textContent), ['A heading', 'Plain 😊 text', '', 'List A', 'List B', 'List C', 'A quote', 'Header', 'Cell', 'Code\nnext line']);
  for (const [index, paragraph] of paragraphs.entries()) {
    assert.equal(TextSelection.create(doc, paragraph.from).$from.parent, paragraph.node);
    assert.equal(currentParagraphNumber(doc, paragraph.from), index + 1);
    assert.equal(currentParagraphNumber(doc, paragraph.to), index + 1);
  }
  assert.equal(currentParagraphNumber(doc, 0), 1);
  assert.equal(currentParagraphNumber(doc, doc.content.size), 10);
});

test('paragraph locations refresh after splitting, deleting and replacing an immutable document', () => {
  const doc = schema.node('doc', null, [p('First paragraph'), p('Second paragraph')]);
  const before = paragraphLocations(doc);
  assert.equal(paragraphLocations(doc), before);
  const state = EditorState.create({ schema, doc });
  const split = state.apply(state.tr.split(7));
  assert.equal(paragraphLocations(split.doc).length, 3);
  assert.deepEqual(paragraphLocations(split.doc).map(item => item.node.textContent), ['First ', 'paragraph', 'Second paragraph']);
  const deleted = split.apply(split.tr.delete(0, split.doc.firstChild.nodeSize));
  assert.equal(paragraphLocations(deleted.doc).length, 2);
  assert.equal(paragraphLocations(deleted.doc)[0].from, 1);
  // A fresh chapter must never inherit cached positions from another tree.
  const other = schema.node('doc', null, p('Only paragraph'));
  assert.equal(paragraphLocations(other).length, 1);
  assert.notEqual(paragraphLocations(other), before);
  assert.equal(paragraphLocations(doc).length, 2);
  assert.equal(currentParagraphNumber(null), 0);
});

test('paragraph previews preserve public wording, Unicode and line breaks without exposing anchor IDs', () => {
  const paragraph = schema.node('paragraph', null, [schema.text('A 😊 ', [schema.marks.commentAnchor.create({ id: 'private-note-id' })]), schema.node('hardBreak'), schema.text(' end')]);
  const location = { node: paragraph };
  assert.equal(paragraphPreview(location), 'A 😊 end');
  assert.equal(paragraphPreview(location, 3), 'A 😊…');
  assert.equal(paragraphPreview({ node: p('') }), '(Empty paragraph)');
  assert.equal(paragraphPreview(null), '');
});
