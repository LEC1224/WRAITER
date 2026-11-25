import test from 'node:test';
import assert from 'node:assert/strict';
import { passageQueue } from '../src/grammar-passage-queue.js';

test('closing a pane removes queued work while live panes resume in order after a backend failure', async () => {
  const enqueue = passageQueue(), calls = [], obsolete = new AbortController();
  let rejectFirst;
  const first = enqueue(null, () => new Promise((_resolve, reject) => { calls.push('first'); rejectFirst = reject; }));
  const skipped = enqueue(obsolete.signal, () => calls.push('closed'));
  const second = enqueue(null, () => calls.push('second'));
  const third = enqueue(null, () => calls.push('third'));
  obsolete.abort(); await assert.rejects(skipped, { name: 'AbortError' });
  assert.deepEqual(calls, ['first']);
  rejectFirst(new Error('Backend stopped'));
  await assert.rejects(first, /Backend stopped/); await Promise.all([second, third]);
  assert.deepEqual(calls, ['first', 'second', 'third']);
});
