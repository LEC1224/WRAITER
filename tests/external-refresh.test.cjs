const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceSession } = require('../electron/workspace-session.cjs');
const { DocumentStore } = require('../electron/core.cjs');

const project = (text, id = 'refresh-test') => ({ format: 'wraiter', version: 1, id, title: 'Refresh test', chapters: [{ id: 'chapter', title: 'Chapter', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }] });
async function fixture(t, format = 'txt') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-refresh-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('wraiter-refresh-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const data = path.join(directory, 'Profile'), folder = path.join(directory, 'Original folder');
  await fs.mkdir(folder);
  const target = path.join(folder, `Book.${format}`), original = project('Original file');
  await fs.writeFile(target, format === 'wraiter' ? JSON.stringify(original) : 'Original file');
  const session = new WorkspaceSession(data); await session.boot();
  const opening = await session.open(target);
  if (opening.import) await session.bind(original, { openToken: opening.openToken });
  return { directory, data, folder, target, original, session };
}

test('refresh reads native file bytes instead of recovery-only sidecar content', async t => {
  const { session, original, target } = await fixture(t);
  const draft = project('Unsaved sidecar edit');
  await session.active.files.persist(draft, null);
  assert.equal(await fs.readFile(target, 'utf8'), 'Original file');
  const pending = await session.reload(draft);
  assert.equal(pending.import, true);
  assert.equal(Buffer.from(pending.bytes).toString(), 'Original file');
  const loaded = await session.bind(original, { openToken: pending.openToken });
  assert.deepEqual(JSON.parse(await fs.readFile(loaded.preservedPath, 'utf8')), draft);
  assert.equal((await session.active.files.sourceStatus()).state, 'unchanged');
});

test('status detects edits, deletion, restoration and subsequent saves without changing the draft', async t => {
  const { session, target, original } = await fixture(t);
  const files = session.active.files;
  assert.equal((await files.sourceStatus()).state, 'unchanged');
  await fs.writeFile(target, 'Externally changed');
  assert.equal((await files.sourceStatus()).state, 'changed');
  assert.deepEqual(session.active.store.project, original);
  await fs.unlink(target);
  assert.equal((await files.sourceStatus()).state, 'missing');
  await fs.writeFile(target, 'Original file');
  assert.equal((await files.sourceStatus()).state, 'unchanged');
  await files.persist(project('Saved edit'), { format: 'txt', data: 'Saved edit' });
  assert.equal((await files.sourceStatus()).state, 'unchanged');
});

test('renamed parent folders reconnect native and WRAITER files and persist the new path across restart', async t => {
  for (const format of ['txt', 'wraiter']) {
    const { session, data, folder, target, directory, original } = await fixture(t, format);
    const count = session.entries.length, before = session.activeId, draft = project('Local draft to keep');
    session.rememberView({ chapterId: 'chapter', scrollTop: 123 });
    const renamed = path.join(directory, 'Renamed å folder');
    await fs.rename(folder, renamed);
    assert.equal((await session.active.files.sourceStatus()).state, 'missing');
    const moved = path.join(renamed, path.basename(target));
    await fs.writeFile(moved, format === 'wraiter' ? JSON.stringify(project('Edited elsewhere')) : 'Edited elsewhere');
    let loaded = await session.reload(draft, moved);
    if (loaded.import) loaded = await session.bind(project('Edited elsewhere'), { openToken: loaded.openToken });
    assert.equal(session.entries.length, count);
    assert.notEqual(session.activeId, before);
    assert.equal(loaded.path, moved);
    assert.equal(session.active.view.scrollTop, 123);
    assert.notEqual(loaded.project.id, original.id);
    assert.deepEqual(JSON.parse(await fs.readFile(loaded.preservedPath, 'utf8')), draft);
    await session.active.files.persist({ ...loaded.project, notes: 'Private note after refresh' }, format === 'txt' ? { format, data: 'Edited elsewhere' } : null);
    await session.checkpoint();
    assert.equal((await new WorkspaceSession(data).boot()).path, moved);
    await assert.rejects(fs.stat(folder), { code: 'ENOENT' });
  }
});

test('failed refresh retains recovery and retries reject stale import tokens and racing disk changes', async t => {
  const { session, data, target } = await fixture(t);
  const before = session.activeId, draft = project('Local recovery');
  await assert.rejects(session.reload(draft, path.join(data, 'missing.txt')), { code: 'ENOENT' });
  assert.equal(session.activeId, before);
  assert.deepEqual((await new DocumentStore(session.active.store.directory).boot()).project, draft);
  const first = await session.reload(draft);
  const second = await session.reload(draft);
  await assert.rejects(session.bind(project('Old import'), { openToken: first.openToken }), /Reopen/);
  await fs.writeFile(target, 'Changed during import');
  await assert.rejects(session.bind(project('Stale read'), { openToken: second.openToken }), /changed while opening/);
  assert.equal(session.activeId, before);
  assert.deepEqual(session.active.store.project, draft);
  const third = await session.reload(draft);
  const loaded = await session.bind(project('Changed during import'), { openToken: third.openToken });
  assert.equal((await session.active.files.sourceStatus(true)).state, 'unchanged');
  assert.match(JSON.stringify(loaded.project), /Changed during import/);
});

test('reconnecting rejects a file already open in another tab and invalid selected files', async t => {
  const { session, directory } = await fixture(t, 'wraiter');
  const originalId = session.activeId, original = session.active.store.project;
  const other = path.join(directory, 'Other.wraiter');
  await fs.writeFile(other, JSON.stringify(project('Other file', 'other')));
  await session.open(other);
  await session.activate(originalId);
  await assert.rejects(session.reload(original, other), /already open in another tab/);
  assert.equal(session.activeId, originalId);
  const invalid = path.join(directory, 'Broken.wraiter');
  await fs.writeFile(invalid, '{broken');
  await assert.rejects(session.reload(original, invalid));
  assert.equal(session.activeId, originalId);
  assert.deepEqual(session.active.store.project, original);
});
