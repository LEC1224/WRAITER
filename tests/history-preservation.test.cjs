const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EditJournal } = require('../electron/edit-journal.cjs');
const historyHelpers = import('../src/history.js');

function document() {
  return { format: 'wraiter', version: 1, id: 'preservation-manuscript', title: 'Current document', notes: 'Current author notes', language: 'en-GB', chapters: [{ id: 'chapter-one', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The saved document must remain exact. Åäö.' }] }] } }], references: [], snapshots: [], historySequence: 1 };
}
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-history-preserve-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-history-preserve-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const journal = new EditJournal(directory), project = document(), { createHistory } = await historyHelpers;
  const initial = createHistory(project).events[0];
  const earlier = createHistory({ ...project, title: 'Earlier document', notes: 'Earlier notes' }).events[0];
  const oldBytes = Buffer.from(JSON.stringify(earlier) + '\n');
  await fs.mkdir(journal.directory, { recursive: true });
  await fs.writeFile(journal.filename(project.id), oldBytes);
  return { directory, journal, project, initial, earlier, oldBytes, target: journal.filename(project.id) };
}
async function preservedFiles(journal) {
  return (await fs.readdir(journal.directory)).filter(name => name.includes('.preserved-')).map(name => path.join(journal.directory, name));
}
const denied = message => Object.assign(new Error(message), { code: 'EACCES' });

test('restart preserves exact corrupt journal bytes and the current snapshot before installing only the new init', async t => {
  const { directory, journal, project, initial, oldBytes, target } = await fixture(t);
  const corrupt = Buffer.concat([oldBytes, Buffer.from('{broken json}\nremaining journal bytes'), Buffer.from([0xff, 0x00, 0x7b])]);
  await fs.writeFile(target, corrupt);
  const originalProject = JSON.stringify(project), originalInitial = JSON.stringify(initial);
  const result = await journal.restart(project, initial, 'Corrupt history: preserve the current document');
  assert.equal(result.sequence, 1); assert.equal(path.dirname(result.preservedPath), journal.directory);
  assert.deepEqual(await fs.readFile(result.preservedPath), corrupt);
  const snapshot = JSON.parse(await fs.readFile(`${result.preservedPath}.snapshot.json`, 'utf8'));
  assert.deepEqual(snapshot.project, project);
  assert.equal(snapshot.reason, 'Corrupt history: preserve the current document');
  assert.equal(snapshot.previousJournal, result.preservedPath);
  assert.ok(Number.isFinite(Date.parse(snapshot.timestamp)));
  assert.equal(await fs.readFile(target, 'utf8'), JSON.stringify(initial) + '\n');
  assert.deepEqual((await journal.read(project.id)).events, [initial]);
  assert.deepEqual((await new EditJournal(directory).read(project.id)).events, [initial]);
  assert.equal(JSON.stringify(project), originalProject); assert.equal(JSON.stringify(initial), originalInitial);
});

test('restarted history accepts future edits and survives a fresh backend instance', async t => {
  const { directory, journal, project, initial } = await fixture(t);
  await journal.read(project.id); // Populate the previous lineage cache first.
  await journal.restart(project, initial, 'A different document revision was saved');
  const { createHistory, recordProjectChange } = await historyHelpers;
  const next = { ...project, title: 'An edit after repair' };
  const nextJournal = recordProjectChange(createHistory(project, { events: [initial] }), project, next, { label: 'Rename document' });
  assert.equal((await journal.append(project.id, [nextJournal.events[1]])).sequence, 2);
  assert.deepEqual((await new EditJournal(directory).read(project.id)).events, JSON.parse(JSON.stringify(nextJournal.events)));
});

test('a missing old ledger still preserves the supplied document snapshot before starting history', async t => {
  const { journal, project, initial, target } = await fixture(t);
  await fs.unlink(target);
  const result = await journal.restart(project, initial, 'The old journal is missing');
  assert.match(result.preservedPath, /\.snapshot\.json$/);
  const snapshot = JSON.parse(await fs.readFile(result.preservedPath, 'utf8'));
  assert.deepEqual(snapshot.project, project); assert.equal(snapshot.previousJournal, null);
  assert.deepEqual((await journal.read(project.id)).events, [initial]);
});

test('archive failure leaves the original journal and cached lineage intact', async t => {
  const { journal, project, initial, oldBytes, target, earlier } = await fixture(t);
  await journal.read(project.id);
  const copy = fs.copyFile;
  fs.copyFile = async (source, destination, flags) => { if (source === target) throw denied('Archive storage unavailable'); return copy(source, destination, flags); };
  try { await assert.rejects(journal.restart(project, initial, 'Test archive failure'), /Archive storage unavailable/); }
  finally { fs.copyFile = copy; }
  assert.deepEqual(await fs.readFile(target), oldBytes);
  assert.deepEqual((await journal.read(project.id)).events, [earlier]);
  assert.deepEqual(await preservedFiles(journal), []);
});

test('snapshot preservation failure keeps the original ledger and its exact archived copy', async t => {
  const { journal, project, initial, oldBytes, target, earlier } = await fixture(t);
  await journal.read(project.id);
  const rename = fs.rename;
  fs.rename = async (source, destination) => { if (destination.endsWith('.snapshot.json')) throw denied('Snapshot storage unavailable'); return rename(source, destination); };
  try { await assert.rejects(journal.restart(project, initial, 'Test snapshot failure'), /Snapshot storage unavailable/); }
  finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(target), oldBytes);
  assert.deepEqual((await journal.read(project.id)).events, [earlier]);
  const archives = await preservedFiles(journal);
  assert.equal(archives.length, 1); assert.deepEqual(await fs.readFile(archives[0]), oldBytes);
});

test('new baseline installation failure retains old ledger, old cache, archive and document snapshot', async t => {
  const { journal, project, initial, oldBytes, target, earlier } = await fixture(t);
  await journal.read(project.id);
  const rename = fs.rename;
  fs.rename = async (source, destination) => { if (destination === target) throw denied('Baseline installation unavailable'); return rename(source, destination); };
  try { await assert.rejects(journal.restart(project, initial, 'Test baseline failure'), /Baseline installation unavailable/); }
  finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(target), oldBytes);
  assert.deepEqual((await journal.read(project.id)).events, [earlier]);
  const files = await preservedFiles(journal), archive = files.find(file => !file.endsWith('.snapshot.json'));
  assert.equal(files.length, 2); assert.deepEqual(await fs.readFile(archive), oldBytes);
  assert.deepEqual(JSON.parse(await fs.readFile(`${archive}.snapshot.json`, 'utf8')).project, project);
});

test('invalid manuscript identifiers and replacement baselines never touch an existing ledger', async t => {
  const { journal, project, initial, oldBytes, target } = await fixture(t);
  for (const id of ['', ' ', 'x'.repeat(201), 7, null]) await assert.rejects(journal.restart({ ...project, id }, { ...initial, projectId: id }), /Invalid document identifier/);
  const invalid = [null, { ...initial, kind: 'edit' }, { ...initial, version: 9 }, { ...initial, sequence: 2 }, { ...initial, projectId: 'another-document' }, { ...initial, fingerprint: 42 }, { ...initial, fingerprint: '' }, { ...initial, timestamp: 'invalid date' }];
  for (const baseline of invalid) await assert.rejects(journal.restart(project, baseline), /Invalid replacement history baseline/);
  assert.deepEqual(await fs.readFile(target), oldBytes);
  assert.deepEqual(await preservedFiles(journal), []);
});
