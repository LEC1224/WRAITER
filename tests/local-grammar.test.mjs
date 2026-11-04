import test from 'node:test';
import assert from 'node:assert/strict';
import { grammarHints, documentGrammar } from '../src/local-grammar.js';
import { editorialSchema } from '../electron/editor-schema.mjs';

test('local grammar identifies exact ranges and pronunciation exceptions without network calls', () => {
  const text = 'She could of seen an university and a honest man. The the door.';
  const hints = grammarHints(text);
  assert.deepEqual(hints.map(h => [text.slice(h.from, h.to), h.replacement]), [['could of', 'could have'], ['an', 'a'], ['a', 'an'], ['The the', 'The']]);
  assert.equal(grammarHints('An hour, a university, an umbrella, a one-off event.').length, 0);
  assert.equal(grammarHints(text, 'sv-SE').length, 0);
});
test('document hints preserve document positions across styled text and skip code', () => {
  const doc = editorialSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'honest', marks: [{ type: 'bold' }] }] }, { type: 'codeBlock', content: [{ type: 'text', text: 'the the' }] }] });
  const hints = documentGrammar(doc, 'en-US');
  assert.equal(hints.length, 1); assert.equal(doc.textBetween(hints[0].from, hints[0].to), 'a');
});
