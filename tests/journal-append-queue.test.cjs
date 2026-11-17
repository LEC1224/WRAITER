const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EditJournal } = require('../electron/edit-journal.cjs');
const { JournalAppendQueue } = require('../electron/journal-append-queue.cjs');

const event = sequence => ({ sequence, label: 'Edit ' + sequence });
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
async function fixture(t, intercept) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-journal-queue-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const journal = new EditJournal(directory), writes = [];
  let previous = Promise.resolve();
  function serial(action) {
    queue.barrier();
    const next = previous.then(action);
    previous = next.catch(() => {});
    return next;
  }
  const queue = new JournalAppendQueue(serial, async (id, events, expected) => {
    writes.push([id, Array.isArray(events) ? events.map(item => item?.sequence) : events]);
    await intercept?.(id, events, expected);
    return journal.append(id, events, expected);
  });
  return { queue, journal, serial, writes };
}

test('typing is submitted immediately, then waiting writes share durability and respect FIFO barriers', async t => {
  const started = gate(), storage = gate(), acks = [];
  const { queue, journal, serial, writes } = await fixture(t, async () => {
    started.release(); await storage.promise;
  });
  const first = queue.append('one', [event(1)]).then(result => { acks.push(result.sequence); return result; });
  await started.promise;
  const source = [event(2)];
  const second = queue.append('one', source);
  source[0].label = 'Later mutation';
  const third = queue.append('one', [event(3)]);
  const save = serial(async () => { assert.equal((await journal.read('one')).totalEvents, 3); });
  const fourth = queue.append('one', [event(4)]);
  const different = queue.append('two', [event(1)]);
  const fifth = queue.append('one', [event(5)]);
  assert.deepEqual(acks, []);
  assert.deepEqual(writes, [['one', [1]]]);
  storage.release();
  for (const [promise, sequence] of [[first, 1], [second, 2], [third, 3], [fourth, 4], [different, 1], [fifth, 5]]) {
    assert.deepEqual(await promise, { sequence });
  }
  await save;
  assert.deepEqual(writes, [['one', [1]], ['one', [2, 3]], ['one', [4]], ['two', [1]], ['one', [5]]]);
  assert.equal((await journal.read('one')).events[1].label, event(2).label);
});

test('duplicates, conflicts, malformed events, bulk payloads and sequence gaps retain individual outcomes', async t => {
  const { queue, journal } = await fixture(t);
  await queue.append('one', [event(1), event(2), event(3)]);
  const calls = [
    queue.append('one', [event(1)]), queue.append('one', [{ sequence: 2, label: 'Conflict' }]),
    queue.append('one', [event(3)]), queue.append('one', [event(4)]),
    queue.append('one', [null]), queue.append('one', [event(6)]), queue.append('one', [event(7)]),
    queue.append('one', [event(4), event(5)]), queue.append('one', [])
  ];
  const outcomes = await Promise.allSettled(calls);
  assert.deepEqual(outcomes.map(result => result.value?.sequence ?? result.reason.message), [
    3, 'An earlier history record cannot be overwritten.', 3, 4, 'Invalid editing history event.',
    'Editing history is missing an earlier event.', 'Editing history is missing an earlier event.', 5, 5
  ]);
  assert.deepEqual((await journal.read('one')).events, Array.from({ length: 5 }, (_, i) => event(i + 1)));
});

test('a shared I/O failure rejects each pending acknowledgement and a retry can recover the full journal', async t => {
  let fail = true;
  const { queue, journal } = await fixture(t, async (_id, events) => {
    if (fail && events.length > 1) { fail = false; throw Object.assign(new Error('Disk unavailable'), { code: 'EIO' }); }
  });
  const first = queue.append('one', [event(1)]), second = queue.append('one', [event(2)]);
  const outcomes = await Promise.allSettled([first, second]);
  assert.deepEqual(outcomes.map(item => item.reason?.code), ['EIO', 'EIO']);
  assert.equal((await journal.read('one')).totalEvents, 0);
  assert.deepEqual(await Promise.all([queue.append('one', [event(1)]), queue.append('one', [event(2)])]), [{ sequence: 1 }, { sequence: 2 }]);
  assert.deepEqual((await journal.read('one')).events, [event(1), event(2)]);
});

test('an fsync failure after writing bytes withholds both receipts and a retry never duplicates those records', async t => {
  const { queue, journal } = await fixture(t);
  const open = fs.open.bind(fs), target = journal.filename('one');
  let failureInjected = false, syncAttempts = 0;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (args[0] === target) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        syncAttempts++;
        if (!failureInjected) {
          failureInjected = true;
          throw Object.assign(new Error('Durability failure'), { code: 'EIO' });
        }
        return sync();
      };
    }
    return handle;
  });
  const first = queue.append('one', [event(1)]), second = queue.append('one', [event(2)]);
  const outcomes = await Promise.allSettled([first, second]);
  assert.deepEqual(outcomes.map(outcome => outcome.reason?.code), ['EIO', 'EIO']);
  assert.deepEqual(await queue.append('one', [event(1), event(2)]), { sequence: 2 });
  assert.ok(syncAttempts >= 2);
  assert.deepEqual((await journal.read('one')).events, [event(1), event(2)]);
});
