const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { GitHistory } = require('../electron/git-history.cjs');
const { StoryHistory, readSections } = require('../electron/story-history.cjs');
const { passageDelta, makePassages } = require('../electron/story-passages.cjs');

const text = (name, lines) => 'Book\n\n# ' + name + '\n' + lines.join('\n') + '\n';
const book = lines => ({ format: 'wraiter', version: 1, id: 'ferry', title: 'The ferry', chapters: [{ id: 'opening', title: 'Chapter 1',
  content: { type: 'doc', content: lines.map(line => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) } }] });

test('index locates small edits, disjoint and deleted passages, and a chapter rename', () => {
  const a = ['Inez rowed past the pier.', 'The rope snapped.', 'A lamp in the window.', 'The captain rang the bel.'];
  const b = ['Inez rowed past the pier.', 'The mast snapped.', 'A lamp in the window.', 'The captain rang the bell.'];
  const delta = passageDelta(text('One', a), text('One', b));
  assert.deepEqual(new Set(delta.excerpts.map(f => f.paragraph)), new Set([1, 3]));
  const bell = delta.excerpts.find(f => f.paragraph === 3);
  assert.match(bell.quote, /rang the bell/); assert.match(bell.previous, /lamp/); assert.match(bell.original, /rang the bel/);
  const removed = passageDelta(text('One', a), text('One', a.filter((_, i) => i !== 1)));
  assert.ok(removed.excerpts[0].removed); assert.equal(removed.excerpts[0].quote, a[1]);
  assert.equal(passageDelta(text('One', a), text('Crossing', a)).purpose, 'Renamed One to Crossing');
});

test('scene boundaries retain actual branch points, named versions, recent versions and both merge parents', () => {
  const entries = Array.from({ length: 23 }, (_, i) => ({ revision: 'v' + i, parentRevision: i ? 'v' + (i - 1) : null, message: 'Automatic checkpoint',
    passage: { excerpts: [{ chapter: 'Crossing', paragraph: i < 9 ? i : 50 + i, quote: 'Inez counts the lamps.' }] } }));
  entries[4].message = 'Keep this ending';
  entries.push({ ...entries[6], revision: 'other', parentRevision: 'v5' });
  entries[17].parentRevisions = ['v16', 'other'];
  const groups = makePassages(entries.reverse(), 'v22');
  const ids = groups.flatMap(g => g.revisions);
  assert.equal(ids.length, entries.length); assert.equal(new Set(ids).size, entries.length);
  for (const id of ['v0','v4','v5','other','v16','v17','v20','v21','v22']) assert.deepEqual(groups.find(g => g.revisions.includes(id)).revisions, [id]);
  assert.ok(groups.some(g => g.revisions.length > 3));
  assert.notEqual(groups.find(g => g.revisions.includes('v8')), groups.find(g => g.revisions.includes('v9')));
});

test('AI partitions are grounded in the supplied markers and generic titles are rejected', () => {
  const starts = new Map([['A', 1], ['B', 4], ['C', 9]]);
  const names = [{ startsAt: 'A', title: 'Inez mends the sail', summary: 'She stitches the torn edge.' }, { startsAt: 'C', title: 'The ferry leaves', summary: 'The boat sets out.' }];
  const parse = parts => readSections(JSON.stringify({ completion: JSON.stringify({ sections: parts }) }), 15, starts);
  assert.deepEqual(parse(names).map(s => s.end), [8, 15]);
  assert.deepEqual(readSections(JSON.stringify(names), 15, starts), parse(names));
  assert.deepEqual(readSections(JSON.stringify({ completion: '```json\n' + JSON.stringify(names) + '\n```' }), 15, starts), parse(names));
  for (const invalid of [[names[1]], [{ ...names[0], title: 'Revisions to Chapter 3' }], [names[0], { ...names[1], startsAt: 'D' }], [names[0], names[0]]]) assert.throws(() => parse(invalid));
});

test('existing Git labels never hide the prose, intermediate and Unicode changes survive, and cached names work offline', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-scenes-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const git = new GitHistory(dir), index = new StoryHistory(git), base = 'Zoë waited at the pier. 🛶';
  await git.record(book([base]), 'New manuscript');
  const versions = [];
  for (const line of ['An oar fell.', 'Zoë asks the ferryman for directions.', '“West,” the ferryman replies.', 'Waves wash over the pier.', 'Zoë turns back.', 'The rope comes loose.', 'The boat drifts.', 'All is quiet.']) {
    const saved = await git.record(book([base, line]), 'Automatic checkpoint');
    versions.push(saved.revision);
    await git.updateLabel('ferry', saved.revision, { title: 'Revised Chapter 1', summary: 'Revised text in Chapter 1.', location: 'Chapter 1' });
  }
  const h = await index.list('ferry'), group = h.passages.find(g => g.revisions.includes(versions[1]));
  assert.ok(group.revisions.length >= 3);
  assert.equal(h.entries.find(e => e.revision === versions[1]).displayTitle, 'Zoë asks the ferryman for directions.');
  let requests = 0;
  const generate = describe => describe({}, '', { generateStructured: async (_s, _k, prompt) => {
    requests++; assert.match(prompt.user, /Zoë asks the ferryman for directions/); assert.match(prompt.user, /pier\. 🛶/);
    return JSON.stringify({ sections: [{ startsAt: 'A', title: 'Zoë asks the ferryman for directions', summary: 'The ferryman points her west.' }] });
  } });
  const [a, b] = await Promise.all([index.describe(book([base]), group.key, generate), index.describe(book([base]), group.key, generate)]);
  assert.equal(requests, 1); assert.deepEqual(a, b); assert.equal(a.status, 'ready');
  const cached = new StoryHistory(git);
  const originalRun = git.run.bind(git);
  git.run = async (d, args, input) => { assert.notEqual(args[0], 'cat-file', 'already indexed snapshots should not be read again'); return originalRun(d, args, input); };
  const again = await cached.list('ferry');
  assert.deepEqual(again.passages.find(g => g.key === group.key).sections, a.sections);
  assert.deepEqual(await cached.describe(book([base]), group.key, () => assert.fail('called an offline model')), a);
});
