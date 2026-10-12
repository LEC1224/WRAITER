const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DocumentStore, hash } = require('../electron/core.cjs');
const { DocumentFiles } = require('../electron/document-files.cjs');
const draft = (text = 'Original synthetic text.', sequence = 1) => ({ format: 'wraiter', version: 1, id: 'native-snapshot-test', title: 'Synthetic document', historySequence: sequence, chapters: [{ id: 'one', title: 'Chapter', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }], references: [], notes: 'Private note.', style: '', snapshots: [] });
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-native-snapshot-'));
  t.after(async () => { const resolved = await fs.realpath(directory); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-native-snapshot-')); await fs.rm(resolved, { recursive: true, force: true }); });
  const userData = path.join(directory, 'User data'), store = new DocumentStore(userData), files = new DocumentFiles(store, userData), target = path.join(directory, 'Synthetic.txt');
  const project = draft(); await fs.writeFile(target, 'Original synthetic text.');
  const opened = await files.open(target); await files.bind(project, { openToken: opened.openToken });
  return { directory, userData, store, files, target, project, sidecar: files.sidecar(target) };
}
const readState = async f => JSON.parse(await fs.readFile(f.sidecar, 'utf8'));

test('identical native autosaves reuse flushed state and reopen with private notes and history intact', async t => {
  const f = await fixture(t), original = await fs.readFile(f.target), state = await fs.readFile(f.sidecar), rename = fs.rename;
  let stateReplacements = 0, sourceReplacements = 0;
  t.mock.method(fs, 'rename', async (from, to) => { if (to === f.sidecar) stateReplacements++; if (to === f.target) sourceReplacements++; return rename(from, to); });
  for (let index = 0; index < 5; index++) await f.files.persist(structuredClone(f.project), null);
  assert.equal(stateReplacements, 0); assert.equal(sourceReplacements, 0); assert.deepEqual(await fs.readFile(f.sidecar), state); assert.deepEqual(await fs.readFile(f.target), original);
  const store = new DocumentStore(f.userData), files = new DocumentFiles(store, f.userData), reopened = await files.open(f.target);
  assert.ok(!reopened.import); assert.equal(reopened.project.notes, 'Private note.'); assert.equal(reopened.project.historySequence, 1);
  await files.persist(structuredClone(reopened.project), null); assert.equal(stateReplacements, 1, 'a new process first establishes its own flushed state');
  await files.persist(structuredClone(reopened.project), null); assert.equal(stateReplacements, 1);
});

test('native history, notes, fidelity and source changes each save their complete new state', async t => {
  const f = await fixture(t), rename = fs.rename; let replacements = 0;
  t.mock.method(fs, 'rename', async (from, to) => { if (to === f.sidecar) replacements++; return rename(from, to); });
  const history = draft(undefined, 2); await f.files.persist(history, null); assert.equal(replacements, 1); assert.equal((await readState(f)).project.historySequence, 2);
  const notes = { ...history, notes: 'New private note.' }; await f.files.persist(notes, null); assert.equal(replacements, 2); assert.equal((await readState(f)).project.notes, notes.notes);
  f.files.binding.fidelity = { warnings: ['Synthetic fidelity information.'] }; await f.files.persist(structuredClone(notes), null); assert.equal(replacements, 3); assert.deepEqual((await readState(f)).binding.fidelity, f.files.binding.fidelity);
  const changed = { ...draft('A new source version.', 3), notes: notes.notes }; await f.files.persist(changed, { format: 'txt', data: 'A new source version.' });
  assert.equal(replacements, 4); assert.equal(await fs.readFile(f.target, 'utf8'), 'A new source version.'); assert.equal((await readState(f)).sourceHash, hash(await fs.readFile(f.target)));
  assert.equal((await readState(f)).project.notes, notes.notes); assert.equal((await readState(f)).project.historySequence, 3);
});

test('deleted, corrupt or externally replaced native state is repaired on an identical autosave', async t => {
  const f = await fixture(t);
  for (const alteration of ['delete', 'corrupt', 'other state']) {
    if (alteration === 'delete') await fs.unlink(f.sidecar);
    else await fs.writeFile(f.sidecar, alteration === 'corrupt' ? '{ broken' : JSON.stringify({ project: { ...f.project, notes: 'External metadata.' }, sourceHash: f.store.expectedHash, binding: f.files.binding }));
    await f.files.persist(structuredClone(f.project), null);
    const reopened = await new DocumentFiles(new DocumentStore(f.userData), f.userData).open(f.target);
    assert.ok(!reopened.import); assert.equal(reopened.project.notes, f.project.notes); assert.equal(reopened.project.historySequence, 1);
  }
});

test('an optional native-state read failure falls back to a flushed replacement', async t => {
  const f = await fixture(t), open = fs.open, rename = fs.rename; let blocked = false, replacements = 0;
  t.mock.method(fs, 'open', async (file, flags, ...args) => {
    if (file === f.sidecar && flags === 'r' && !blocked) { blocked = true; throw Object.assign(new Error('Synthetic read lock'), { code: 'EPERM' }); }
    return open(file, flags, ...args);
  });
  t.mock.method(fs, 'rename', async (from, to) => { if (to === f.sidecar) replacements++; return rename(from, to); });
  await f.files.persist(structuredClone(f.project), null); assert.ok(blocked); assert.equal(replacements, 1); assert.deepEqual((await readState(f)).project, f.project);
});

test('failed native-state flushing retains the preceding file and a later retry saves all private changes', async t => {
  const f = await fixture(t), preceding = await fs.readFile(f.sidecar), open = fs.open;
  const mock = t.mock.method(fs, 'open', async (file, flags, ...args) => {
    const handle = await open(file, flags, ...args);
    if (file.startsWith(f.sidecar + '.') && file.endsWith('.tmp') && flags === 'r+') handle.sync = async () => { throw Object.assign(new Error('Synthetic failed flush'), { code: 'EIO' }); };
    return handle;
  });
  const changed = { ...draft(undefined, 2), notes: 'A newer private note.' };
  await assert.rejects(f.files.persist(changed, null), { code: 'EIO' }); assert.deepEqual(await fs.readFile(f.sidecar), preceding);
  assert.equal((await new DocumentStore(f.userData).boot()).project.notes, changed.notes, 'the independent recovery already protects the staged private edit');
  mock.mock.restore(); await f.files.persist(structuredClone(changed), null);
  const reopened = await new DocumentFiles(new DocumentStore(f.userData), f.userData).open(f.target); assert.equal(reopened.project.notes, changed.notes); assert.equal(reopened.project.historySequence, 2);
  assert.ok((await fs.readdir(path.dirname(f.sidecar))).every(name => !name.endsWith('.tmp')));
});

test('changing native destinations establishes a fresh snapshot at each bound path', async t => {
  const f = await fixture(t), destination = path.join(f.directory, 'A copy.txt'), chosen = await f.files.authorizeTarget(destination), rename = fs.rename;
  const replacements = new Map();
  t.mock.method(fs, 'rename', async (from, to) => { replacements.set(to, (replacements.get(to) || 0) + 1); return rename(from, to); });
  await f.files.persist(structuredClone(f.project), { format: 'txt', data: 'Original synthetic text.' }, { token: chosen.token });
  assert.equal(replacements.get(f.files.sidecar(destination)), 1); assert.equal((await f.files.readSidecar(destination)).binding.path, destination);
  await f.files.persist(structuredClone(f.project), null); assert.equal(replacements.get(f.files.sidecar(destination)), 1);
  await f.files.open(f.target); await f.files.persist(structuredClone(f.project), null); assert.equal(replacements.get(f.sidecar), 1, 'the bounded cache must prove its current destination');
  assert.equal((await readState(f)).binding.path, f.target); assert.equal(await fs.readFile(destination, 'utf8'), 'Original synthetic text.');
});

test('an unchanged native autosave still detects an external source edit before reusing private state', async t => {
  const f = await fixture(t), preceding = await fs.readFile(f.sidecar); await fs.writeFile(f.target, 'External editor text.');
  await assert.rejects(f.files.persist(structuredClone(f.project), null), /changed outside WRAITER/);
  assert.equal(await fs.readFile(f.target, 'utf8'), 'External editor text.'); assert.deepEqual(await fs.readFile(f.sidecar), preceding);
  assert.equal((await new DocumentStore(f.userData).boot()).project.notes, f.project.notes);
});
