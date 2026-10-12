const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DocumentStore, hash } = require('../electron/core.cjs');
const draft = (text = 'Original prose.', sequence = 1) => ({ format: 'wraiter', version: 1, id: 'recovery-snapshot-test', title: 'Synthetic draft', historySequence: sequence, chapters: [{ id: 'one', title: 'Chapter', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }], references: [], notes: '', style: '', snapshots: [] });
async function temporary(t) {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-snapshot-'));
  t.after(async () => { const resolved = await fs.realpath(directory); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-snapshot-')); await fs.rm(resolved, { recursive: true, force: true }); });
  return directory;
}
const recovered = async store => JSON.parse(await fs.readFile(store.recoveryPath, 'utf8'));

test('identical cloned autosaves avoid duplicate recovery replacements and retain their preceding backups', async t => {
  const directory = await temporary(t), originalRename = fs.rename; let replacements = 0;
  t.mock.method(fs, 'rename', async (from, to) => { if (path.basename(to) === 'recovery.json') replacements++; return originalRename(from, to); });
  for (const named of [false, true]) {
    const store = new DocumentStore(path.join(directory, named ? 'Named' : 'Untitled'));
    await store.persist(draft(), named ? path.join(directory, 'Draft.wraiter') : null);
    await store.persist(draft('A newer revision.', 2));
    const latest = await fs.readFile(store.recoveryPath), backup = await fs.readFile(`${store.recoveryPath}.bak`);
    replacements = 0;
    for (let index = 0; index < 5; index++) await store.persist(structuredClone(draft('A newer revision.', 2)));
    assert.equal(replacements, 0);
    assert.deepEqual(await fs.readFile(store.recoveryPath), latest); assert.deepEqual(await fs.readFile(`${store.recoveryPath}.bak`), backup);
    assert.equal((await recovered(store)).project.historySequence, 2);
    if (named) assert.match(await fs.readFile(store.currentPath, 'utf8'), /A newer revision/);
  }
});

test('history-only changes, file binding and expected fingerprints each produce a durable new recovery snapshot', async t => {
  const directory = await temporary(t), store = new DocumentStore(directory), rename = fs.rename; let replacements = 0;
  t.mock.method(fs, 'rename', async (from, to) => { if (to === store.recoveryPath) replacements++; return rename(from, to); });
  await store.persist(draft()); replacements = 0;
  await store.persist(draft('Original prose.', 2)); assert.ok(replacements > 0); assert.equal((await recovered(store)).project.historySequence, 2);
  const target = path.join(directory, 'Named.wraiter'); replacements = 0;
  await store.persist(draft('Original prose.', 2), target); assert.ok(replacements > 0); assert.equal((await recovered(store)).path, target);
  const changedHash = hash('An external version'); replacements = 0;
  await store.writeRecovery(store.project, target, changedHash); assert.ok(replacements > 0); assert.equal((await recovered(store)).expectedHash, changedHash);
});

test('an identical autosave repairs deleted or externally altered recovery bytes instead of trusting its cache', async t => {
  const directory = await temporary(t), store = new DocumentStore(directory); await store.persist(draft());
  for (const alteration of ['delete', 'corrupt', 'different valid project']) {
    if (alteration === 'delete') await fs.unlink(store.recoveryPath);
    else await fs.writeFile(store.recoveryPath, alteration === 'corrupt' ? '{ broken' : JSON.stringify({ project: draft('External recovery text.'), path: null, expectedHash: null }));
    await store.persist(structuredClone(draft()));
    assert.match(JSON.stringify((await new DocumentStore(directory).boot()).project), /Original prose/);
    assert.equal((await recovered(store)).project.historySequence, 1);
  }
});

test('a failed optional recovery read falls back to the normal flushed writer', async t => {
  const directory = await temporary(t), store = new DocumentStore(directory); await store.persist(draft());
  const open = fs.open, rename = fs.rename; let blocked = false, replacements = 0;
  t.mock.method(fs, 'open', async (file, flags, ...args) => {
    if (file === store.recoveryPath && flags === 'r' && !blocked) { blocked = true; throw Object.assign(new Error('Synthetic reader lock'), { code: 'EPERM' }); }
    return open(file, flags, ...args);
  });
  t.mock.method(fs, 'rename', async (from, to) => { if (to === store.recoveryPath) replacements++; return rename(from, to); });
  await store.persist(structuredClone(draft())); assert.ok(blocked); assert.ok(replacements > 0); assert.match(JSON.stringify((await recovered(store)).project), /Original prose/);
});

test('a failed changed-snapshot write keeps the preceding state and can be retried successfully', async t => {
  const directory = await temporary(t), store = new DocumentStore(directory); await store.persist(draft());
  const rename = fs.rename;
  const mock = t.mock.method(fs, 'rename', async (from, to) => { if (to === store.recoveryPath) throw Object.assign(new Error('Synthetic full disk'), { code: 'ENOSPC' }); return rename(from, to); });
  await assert.rejects(store.persist(draft('Changed text.', 2)), { code: 'ENOSPC' });
  assert.match(JSON.stringify(store.project), /Original prose/); assert.match(JSON.stringify((await recovered(store)).project), /Original prose/);
  mock.mock.restore(); await store.persist(draft('Changed text.', 2));
  assert.match(JSON.stringify((await new DocumentStore(directory).boot()).project), /Changed text/);
  assert.ok((await fs.readdir(directory)).every(name => !name.endsWith('.tmp')));
});

test('a fresh process reestablishes a flushed recovery snapshot before applying the reuse shortcut', async t => {
  const directory = await temporary(t); await new DocumentStore(directory).persist(draft());
  const restarted = new DocumentStore(directory); await restarted.boot();
  const rename = fs.rename; let replacements = 0;
  t.mock.method(fs, 'rename', async (from, to) => { if (to === restarted.recoveryPath) replacements++; return rename(from, to); });
  await restarted.persist(structuredClone(draft())); assert.ok(replacements > 0);
  replacements = 0; await restarted.persist(structuredClone(draft())); assert.equal(replacements, 0);
});

test('a changed snapshot must finish flushing before it can replace the preceding recovery', async t => {
  const directory = await temporary(t), store = new DocumentStore(directory); await store.persist(draft());
  const open = fs.open;
  const mock = t.mock.method(fs, 'open', async (file, flags, ...args) => {
    const handle = await open(file, flags, ...args);
    if (file.startsWith(store.recoveryPath + '.') && file.endsWith('.tmp') && flags === 'r+') handle.sync = async () => { throw Object.assign(new Error('Synthetic flush failure'), { code: 'EIO' }); };
    return handle;
  });
  await assert.rejects(store.persist(draft('A changed durable snapshot.', 2)), { code: 'EIO' });
  assert.match(JSON.stringify((await recovered(store)).project), /Original prose/); assert.match(JSON.stringify(store.project), /Original prose/);
  mock.mock.restore(); await store.persist(draft('A changed durable snapshot.', 2));
  assert.match(JSON.stringify((await new DocumentStore(directory).boot()).project), /A changed durable snapshot/);
  assert.ok((await fs.readdir(directory)).every(name => !name.endsWith('.tmp')));
});
