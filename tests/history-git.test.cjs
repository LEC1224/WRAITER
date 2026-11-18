const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { GitHistory, contentFingerprint, shouldCheckpoint } = require('../electron/git-history.cjs');

function manuscript() {
  return { format: 'wraiter', version: 1, id: 'atomic-history-git', title: 'History test', chapters: [{ id: 'opening', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The exact same text.' }] }] } }], references: [], notes: '', snapshots: [], historySequence: 2 };
}

test('Git fingerprint excludes editing-history cursors and save bindings while retaining manuscript changes', () => {
  const initial = manuscript(), savedAgain = { ...initial, historySequence: 6, updatedAt: 'later', snapshots: [{ id: 'named version' }], chats: [{ id: 'chat', title: 'Question', messages: [{ id: 'message', role: 'user', text: 'Hello' }] }], activeChatId: 'chat', nativeBinding: { path: 'D:/Books/Book.docx' }, fileBinding: { format: 'docx' }, binding: { hash: 'new file checksum' } };
  assert.equal(contentFingerprint(initial), contentFingerprint(savedAgain));
  assert.notEqual(contentFingerprint(initial), contentFingerprint({ ...initial, notes: 'A real note changed.' }));
  assert.notEqual(contentFingerprint(initial), contentFingerprint({ ...initial, documentStyle: { fontFamily: 'Arial', fontSize: 14 } }));
  const changed = structuredClone(initial); changed.chapters[0].content.content[0].content[0].text = 'Different manuscript text.';
  assert.notEqual(contentFingerprint(initial), contentFingerprint(changed));
});

test('undo then redo does not create a duplicate automatic Git checkpoint, including after restart', async t => {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-history-git-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-history-git-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const first = manuscript(), history = new GitHistory(directory);
  assert.equal((await history.record(first, 'First checkpoint')).committed, true);
  const undoneAndRedone = { ...first, historySequence: 4, updatedAt: new Date().toISOString() };
  assert.equal((await history.record(undoneAndRedone, 'Automatic checkpoint')).committed, false);
  const restarted = new GitHistory(directory);
  assert.equal((await restarted.record({ ...undoneAndRedone, historySequence: 6 }, 'Automatic checkpoint')).committed, false);
  assert.equal((await restarted.list(first.id)).entries.length, 1);
  assert.equal((await restarted.record(undoneAndRedone, 'Explicit named checkpoint', true)).committed, true);
  assert.equal((await restarted.list(first.id)).entries.length, 2);
});

test('automatic versions wait for writing progress but capture paragraph and chapter changes', () => {
  const initial = manuscript();
  const withText = text => ({ ...initial, chapters: [{ ...initial.chapters[0], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }] });
  assert.equal(shouldCheckpoint(initial, withText('The exact same text. One word')), false);
  assert.equal(shouldCheckpoint(initial, withText('The exact same text. ' + Array.from({ length: 40 }, (_, index) => `word${index}`).join(' '))), true);
  const paragraph = structuredClone(initial);
  paragraph.chapters[0].content.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'New paragraph.' }] });
  assert.equal(shouldCheckpoint(initial, paragraph), true);
  const chapter = structuredClone(initial);
  chapter.chapters.push({ id: 'new-chapter', title: 'Chapter 2', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Beginning.' }] }] } });
  assert.equal(shouldCheckpoint(initial, chapter), true);
});

test('restoring a revision forks a durable Git branch and retains both descendants', async t => {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-history-branches-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-history-branches-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const history = new GitHistory(directory), first = manuscript();
  const root = await history.record(first, 'Opening');
  const firstPath = { ...first, notes: 'First path' };
  const originalTip = await history.record(firstPath, 'First path');
  assert.equal((await history.activateRevision(first.id, root.revision)).revision, root.revision);
  const atFork = await history.list(first.id);
  assert.equal(atFork.headRevision, root.revision);
  assert.equal(atFork.entries.length, 2);
  const alternateTip = await history.record({ ...first, notes: 'Alternate path' }, 'Alternate path');
  assert.notEqual(alternateTip.revision, originalTip.revision);
  const tree = await history.list(first.id);
  assert.equal(tree.entries.length, 3);
  assert.equal(tree.headRevision, alternateTip.revision);
  assert.equal(tree.entries.find(entry => entry.revision === originalTip.revision).parentRevision, root.revision);
  assert.equal(tree.entries.find(entry => entry.revision === alternateTip.revision).parentRevision, root.revision);
  assert.equal(tree.branches.length, 2);
  assert.equal((await history.revision(first.id, originalTip.revision)).notes, 'First path');
  assert.equal((await history.revision(first.id, alternateTip.revision)).notes, 'Alternate path');
  await history.updateLabel(first.id, alternateTip.revision, { title: 'Explored another path', summary: 'Revised the manuscript notes.', location: 'Manuscript notes' });
  const restarted = new GitHistory(directory), saved = await restarted.list(first.id);
  assert.equal(saved.headRevision, alternateTip.revision);
  assert.equal(saved.entries.length, 3);
  assert.equal(saved.entries.find(entry => entry.revision === alternateTip.revision).title, 'Explored another path');
  assert.equal(saved.entries.find(entry => entry.revision === alternateTip.revision).summary, 'Revised the manuscript notes.');
  await fs.writeFile(path.join(saved.repository, 'checkpoint-labels.json'), '{unreadable');
  const withoutLabels = await restarted.list(first.id);
  assert.equal(withoutLabels.available, true);
  assert.equal(withoutLabels.entries.length, 3);
  assert.match(withoutLabels.error, /labels could not be read/);
});

test('an automatic checkpoint calls the summary hook without blocking the commit', async t => {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-history-hook-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-history-hook-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  let notified;
  const history = new GitHistory(directory, { onCheckpoint: payload => { notified = payload; } }), first = manuscript();
  await history.record(first, 'Opening');
  const tiny = { ...first, chapters: [{ ...first.chapters[0], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The exact same text. Added' }] }] } }] };
  assert.equal((await history.record(tiny, 'Automatic checkpoint', false, { automatic: true })).belowThreshold, true);
  assert.equal(notified, undefined);
  const substantial = { ...first, chapters: [{ ...first.chapters[0], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The exact same text. ' + Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ') }] }] } }] };
  const result = await history.record(substantial, 'Automatic checkpoint', false, { automatic: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.committed, true);
  assert.equal(notified.revision, result.revision);
  assert.equal(notified.before.chapters[0].content.content[0].content[0].text, 'The exact same text.');
  assert.equal(notified.after.chapters[0].content.content[0].content[0].text, substantial.chapters[0].content.content[0].content[0].text);
});

test('reviewed merge keeps the live target and source as real Git parents and rejects stale previews', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-git-merge-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const git = new GitHistory(dir), base = manuscript();
  const root = await git.record(base, 'Root');
  const source = await git.record({ ...base, subtitle: 'The crossing' }, 'Crossing');
  await git.activateRevision(base.id, root.revision);
  const target = { ...base, notes: 'New path' };
  const old = await git.prepareMerge(base.id, source.revision);
  await git.record(target, 'Other path');
  await assert.rejects(git.commitMerge(target, target, old, 'Merge', null), /changed/);
  const review = await git.prepareMerge(base.id, source.revision);
  assert.equal(review.baseRevision, root.revision);
  const live = { ...target, title: 'Unsaved title' }, next = { ...live, subtitle: 'The crossing' };
  const result = await git.commitMerge(live, next, review, 'Merge crossing', null);
  const saved = await new GitHistory(dir).list(base.id);
  assert.equal(saved.headRevision, result.revision);
  assert.deepEqual(saved.entries.find(item => item.revision === result.revision).parentRevisions, result.parentRevisions);
  assert.equal(result.parentRevisions[1], source.revision);
  assert.equal((await git.revision(base.id, result.parentRevisions[0])).title, 'Unsaved title');
  assert.deepEqual(await git.revision(base.id, result.revision), next);
  await assert.rejects(git.prepareMerge(base.id, source.revision), /already included/);
});

test('interrupted merges follow the durable edit journal on restart', async t => {
  for (const durable of [false, true]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-merge-recovery-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const git = new GitHistory(dir), base = manuscript();
    const root = await git.record(base, 'Root'), source = await git.record({ ...base, notes: 'Incoming' }, 'Incoming');
    await git.activateRevision(base.id, root.revision);
    const target = { ...base, subtitle: 'Local' };
    const first = await git.record(target, 'Target'), preview = await git.prepareMerge(base.id, source.revision);
    const event = { sequence: 12, entry: { id: 'merge-edit' } };
    await assert.rejects(git.commitMerge(target, { ...target, notes: 'Incoming' }, preview, 'Merge', event, async () => { throw Error('Interrupted'); }), /Interrupted/);
    const recovered = new GitHistory(dir, { hasMergeEvent: async (id, value) => { assert.equal(id, base.id); assert.deepEqual(value, { id: 'merge-edit', sequence: 12 }); return durable; } });
    const tree = await recovered.list(base.id);
    if (durable) assert.deepEqual(tree.entries.find(row => row.revision === tree.headRevision).parentRevisions, [first.revision, source.revision]);
    else assert.equal(tree.headRevision, first.revision);
    assert.equal((await recovered.record(await recovered.revision(base.id, tree.headRevision))).committed, false);
  }
});
