import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { findTextMatches } from '../src/search.js';
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} }, marks: { bold: {} } });
test('search finds a phrase across bold/plain text nodes', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('The '), schema.text('quiet', [schema.marks.bold.create()]), schema.text(' hours.')])]);
  assert.deepEqual(findTextMatches(doc, 'quiet hours'), [{ from: 5, to: 16 }]);
});
test('search treats punctuation as literal and reports original Unicode positions', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('ÅÄÖ [a.*] İ next NEXT')])]);
  assert.deepEqual(findTextMatches(doc, '[a.*]'), [{ from: 5, to: 10 }]);
  assert.equal(findTextMatches(doc, 'next').length, 2);
  for (const match of findTextMatches(doc, 'next')) assert.equal(doc.textBetween(match.from, match.to).toLowerCase(), 'next');
});
