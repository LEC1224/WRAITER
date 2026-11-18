const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSections } = require('../electron/checkpoint-ranges.cjs');

test('AI chapter groupings must partition the entire requested range', () => {
  const groups = [{ end: 2, title: 'Arriving at the gate', summary: 'Revised the arrival.' }, { end: 6, title: 'Leaving town', summary: 'Added the departure.' }];
  const raw = JSON.stringify({ sections: groups });
  assert.deepEqual(parseSections(JSON.stringify({ completion: raw }), 6), groups);
  assert.throws(() => parseSections(raw, 7));
  assert.throws(() => parseSections(raw, 5));
  assert.throws(() => parseSections(JSON.stringify({ sections: groups.reverse() }), 6));
});
