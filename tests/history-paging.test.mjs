import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EditJournal } from '../electron/edit-journal.cjs';
import { createHistory, loadDocumentHistory, recordProjectChange } from '../src/history.js';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-paged-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new EditJournal(directory);
}
const project = { id: 'paged-history', format: 'wraiter', version: 1, title: 'Opening', chapters: [{ id: 'one', title: 'One', content: { type: 'doc', content: [{ type: 'paragraph' }] } }] };

test('a paged UTF-8 journal retains a fixed snapshot across appends and rejects cursors after a restart', async t => {
  const store = await fixture(t), initial = createHistory(project).events[0];
  const events = [initial, ...Array.from({ length: 2200 }, (_, i) => ({ sequence: i + 2, sample: `Å🌲${i}`, padding: 'ö'.repeat(i === 800 ? 350000 : 200) }))];
  await fs.mkdir(store.directory, { recursive: true });
  await fs.writeFile(store.filename(project.id), events.map(e => JSON.stringify(e)).join('\r\n \r\n'));
  const first = await store.readPage(project.id);
  assert.ok(first.next > 0 && first.next < events.length);
  const snapshot = { totalEvents: first.totalEvents, generation: first.generation };
  await store.append(project.id, [{ sequence: events.length + 1 }]);
  const read = []; let pages = 0, page = first;
  for (;;) {
    const lines = page.text.split('\n').filter(line => line.trim());
    assert.ok(Buffer.byteLength(page.text) <= 512 * 1024 || lines.length === 1);
    read.push(...lines.map(line => JSON.parse(line))); pages++;
    if (page.next === snapshot.totalEvents) break;
    page = await store.readPage(project.id, page.next, snapshot);
  }
  assert.ok(pages >= 3);
  assert.deepEqual(read, events);
  assert.equal((await store.read(project.id, 0)).totalEvents, events.length + 1);
  await store.restart(project, initial, 'Replace test lineage');
  await assert.rejects(store.readPage(project.id, 0, snapshot), /changed/);
});

test('retrying a failed flush cannot acknowledge visible bytes until a flush succeeds', async t => {
  const store = await fixture(t), original = fs.open, target = store.filename(project.id);
  let fail = true, flushed = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    if (args[0] === target) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { if (fail) throw new Error('Failed flush'); await sync(); flushed = true; };
    }
    return handle;
  });
  const events = [createHistory(project).events[0]];
  await assert.rejects(store.append(project.id, events), /Failed flush/);
  await assert.rejects(store.read(project.id, 0), /Failed flush/);
  await assert.rejects(store.append(project.id, events), /Failed flush/);
  fail = false;
  assert.deepEqual(await store.append(project.id, events), { sequence: 1 });
  assert.equal(flushed, true);
  assert.equal((await fs.readFile(target, 'utf8')).trim().split('\n').length, 1);
});

test('tab history pages recover an uncheckpointed edit and retry transient reads without replacing the ledger', async () => {
  const before = createHistory(project), after = { ...project, title: 'Recovered title' };
  const journal = recordProjectChange(before, project, after);
  let attempts = 0;
  const page = from => ({ generation: 'original', totalEvents: 2, next: from + 1, text: JSON.stringify(journal.events[from]) + '\n' });
  const restored = await loadDocumentHistory({ ...project, historySequence: 1 }, { async loadEditHistoryPage(_id, from) {
    if (from === 1 && !attempts++) throw new Error('Temporary sharing violation');
    return page(from);
  } });
  assert.equal(attempts, 2); assert.equal(restored.requiresJournalReset, false);
  assert.equal(restored.recoveredEvents, 1); assert.equal(restored.project.title, after.title);
  assert.deepEqual(restored.journal.events, JSON.parse(JSON.stringify(journal.events)));
  const unavailable = { async loadEditHistoryPage(_id, from) { if (from) throw new Error('Read unavailable'); return page(from); } };
  await assert.rejects(loadDocumentHistory(project, unavailable), /Read unavailable/);
  for (const invalid of [{ next: 1, text: '' }, { next: 2, text: '' }, { generation: 'replaced' }, { totalEvents: 5 }]) {
    await assert.rejects(loadDocumentHistory(project, { async loadEditHistoryPage(_id, from) { return from ? { ...page(from), ...invalid } : page(from); } }), /changed|incomplete/);
  }
});
