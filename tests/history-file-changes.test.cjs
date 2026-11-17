const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EditJournal } = require('../electron/edit-journal.cjs');

const id = 'shared-profile';
const line = (sequence, text) => JSON.stringify({ sequence, text }) + '\n';
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-journal-file-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-journal-file-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const store = new EditJournal(directory);
  await fs.mkdir(store.directory);
  return { store, target: store.filename(id) };
}
async function replace(target, data) {
  const incoming = target + '.incoming';
  await fs.writeFile(incoming, data); await fs.rename(incoming, target);
}
// Windows prevents renaming over these open handles. Another writer can
// still change their bytes, as can a sync service on a shared filesystem.
const changeOpenFile = process.platform === 'win32' ? fs.writeFile : replace;

test('a new journal appearing at a cached missing path forces an index retry', async t => {
  const { store, target } = await fixture(t), empty = await store.readPage(id);
  assert.equal(empty.totalEvents, 0);
  const data = line(1, 'New from disk');
  await fs.writeFile(target, data);
  await assert.rejects(store.readPage(id), { code: 'JOURNAL_CHANGED' });
  const present = await store.readPage(id);
  assert.equal(present.totalEvents, 1); assert.equal(present.text, data);
  assert.notEqual(present.generation, empty.generation);
});

test('same-size replacements, in-place changes and deletion invalidate cached journal offsets', async t => {
  const { store, target } = await fixture(t);
  const initial = line(1, 'first') + '   ' + line(2, 'second');
  const moved = '   ' + line(1, 'first') + line(2, 'second');
  await fs.writeFile(target, initial); const original = await store.readPage(id);
  await replace(target, moved);
  await assert.rejects(store.readPage(id, 1), { code: 'JOURNAL_CHANGED' });
  assert.equal((await store.readPage(id, 1)).text, line(2, 'second'));
  await assert.rejects(store.readPage(id, 1, original), /changed/);
  await fs.writeFile(target, initial); await fs.utimes(target, 100000, 100000);
  await assert.rejects(store.read(id, 0), { code: 'JOURNAL_CHANGED' });
  assert.equal((await store.readPage(id, 1)).text, '   ' + line(2, 'second'));
  await fs.unlink(target);
  await assert.rejects(store.append(id, [{ sequence: 3 }]), { code: 'JOURNAL_CHANGED' });
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  assert.equal((await store.readPage(id)).totalEvents, 0);
});

test('a file change during indexing is retryable even if the old contents include a bad record', async t => {
  const { store, target } = await fixture(t), open = fs.open;
  const next = line(1, 'Complete replacement');
  await fs.writeFile(target, line(1, 'x'.repeat(600000)) + '{broken old line}\n');
  let exchanged = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (args[0] === target && args[1] === 'r' && !exchanged) {
      const stream = handle.createReadStream.bind(handle);
      handle.createReadStream = async function* (options) {
        for await (const chunk of stream(options)) {
          yield chunk;
          if (!exchanged) { exchanged = true; await changeOpenFile(target, next); }
        }
      };
    }
    return handle;
  });
  await assert.rejects(store.readPage(id), { code: 'JOURNAL_CHANGED' });
  assert.equal((await store.readPage(id)).text, next);
});

test('interrupted-tail repair cannot truncate a replacement journal', async t => {
  const { store, target } = await fixture(t), open = fs.open;
  const next = line(1, 'A distinct first event') + line(2, 'Keep the complete second event');
  await fs.writeFile(target, line(1, 'Original') + '{partial');
  let exchanged = false;
  t.mock.method(fs, 'open', async (...args) => {
    if (!exchanged && args[0] === target && args[1] === 'r+') { exchanged = true; await replace(target, next); }
    return open(...args);
  });
  await assert.rejects(store.readPage(id), { code: 'JOURNAL_CHANGED' });
  assert.equal(await fs.readFile(target, 'utf8'), next);
  assert.equal((await store.readPage(id)).totalEvents, 2);
});

test('an externally changed file cannot acknowledge an appending journal’s event', async t => {
  const { store, target } = await fixture(t), open = fs.open;
  await store.append(id, [{ sequence: 1, text: 'Original' }]);
  const next = line(1, 'Replacement');
  let exchanged = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (args[0] === target && typeof args[1] === 'number') {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        if (!exchanged) { exchanged = true; await changeOpenFile(target, next); }
      };
    }
    return handle;
  });
  await assert.rejects(store.append(id, [{ sequence: 2, text: 'Old lineage' }]), { code: 'JOURNAL_CHANGED' });
  assert.equal(await fs.readFile(target, 'utf8'), next);
  assert.equal((await store.read(id, 0)).totalEvents, 1);
  await store.append(id, [{ sequence: 2, text: 'New lineage' }]);
  assert.equal((await store.read(id)).events[1].text, 'New lineage');
});
