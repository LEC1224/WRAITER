const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { GitHistory, contentFingerprint } = require('../electron/git-history.cjs');

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
