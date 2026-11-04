import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTabStops, regularTabInterval } from '../src/tabs.js';
import { editorialSchema } from '../electron/editor-schema.mjs';

test('tab stops are bounded, ordered and preserve exact office positions', () => {
  assert.deepEqual(parseTabStops('90, 36, 144, 90'), [36,90,144]);
  assert.equal(regularTabInterval([36,72,108]), 36);
  assert.equal(regularTabInterval([36,90,144]), null);
  assert.throws(() => parseTabStops('-1, 72'));
  const doc = editorialSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { tabStops: [36,90,144] }, content: [{ type: 'text', text: 'a\tb' }] }] });
  assert.deepEqual(doc.toJSON().content[0].attrs.tabStops, [36,90,144]);
});
