import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { paragraphPositions, paragraphCovering } from '../src/grammar-positions.js';

test('indexed hint ranges agree with resolved ProseMirror positions around nested paragraphs and atoms', () => {
  const paragraph = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
  const doc = schema.node('doc', null, [paragraph('Opening.'), schema.node('blockquote', null, [
    paragraph('Inside.'), paragraph(''), schema.node('bulletList', null, [schema.node('listItem', null, [paragraph('A list item.')])])
  ]), schema.node('horizontalRule'), paragraph('Ending.')]);
  const blocks = paragraphPositions(doc);
  for (let from = 0; from < doc.content.size; from++) for (let to = from + 1; to <= doc.content.size; to++) {
    const a = doc.resolve(from), b = doc.resolve(to);
    const actual = paragraphCovering(blocks, from, to);
    if (a.parent.isTextblock && a.sameParent(b)) {
      assert.equal(actual?.node, a.parent); assert.equal(actual.start, a.start());
    } else assert.equal(actual, null);
  }
});
