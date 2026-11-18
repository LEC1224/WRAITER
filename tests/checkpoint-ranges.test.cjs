const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSections, describeRange } = require('../electron/checkpoint-ranges.cjs');
const { GitHistory } = require('../electron/git-history.cjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('AI chapter groupings must partition the entire requested range', () => {
  const groups = [{ end: 2, title: 'Arriving at the gate', summary: 'Revised the arrival.' }, { end: 6, title: 'Leaving town', summary: 'Added the departure.' }];
  const raw = JSON.stringify({ sections: groups });
  assert.deepEqual(parseSections(JSON.stringify({ completion: raw }), 6), groups);
  assert.throws(() => parseSections(raw, 7));
  assert.throws(() => parseSections(raw, 5));
  assert.throws(() => parseSections(JSON.stringify({ sections: groups.reverse() }), 6));
});

test('older unlabeled Git checkpoints supply excerpt evidence and reuse the stored AI group', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-range-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = new GitHistory(directory), book = text => ({ format: 'wraiter', version: 1, id: 'story', title: 'The ferry', chapters: [{ id: 'opening', title: 'Departure', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }] });
  await history.record(book('The wharf.'), 'First');
  const first = await history.record(book('The empty wharf.'), 'Saved manuscript');
  const last = await history.record(book('The boat reached the wharf.'), 'Saved manuscript');
  const revisions = [first.revision, last.revision], sections = [{ end: 2, title: 'Arrival', summary: 'Wrote the arrival at the wharf.' }];
  const generated = await describeRange(history, book('Now'), revisions, describe => describe({}, '', { generateCheckpoint: async (_settings, _key, prompt) => {
    assert.match(prompt.user, /boat reached/);
    return JSON.stringify({ sections });
  } }));
  assert.deepEqual(generated, sections);
  assert.deepEqual(await describeRange(new GitHistory(directory), book('Now'), revisions, () => assert.fail('generated a cached summary twice')), sections);
});
