import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAdvancedOffline, checkOffline } from '../src/offline-grammar-client.js';

const settled = () => new Promise(resolve => setImmediate(resolve));
function replaceGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
}

test('closing several tabs withdraws queued spelling batches and cancels the active worker batch', async t => {
  let worker;
  const messages = [];
  class MockWorker {
    constructor() { worker = this; }
    postMessage(message) { messages.push(message); }
    terminate() {}
    reply(data) { this.onmessage({ data }); }
  }
  replaceGlobal(t, 'Worker', MockWorker);
  const first = new AbortController(), obsolete = new AbortController();
  const checking = checkOffline(['first tab'], 'en-US', 0, first.signal);
  await settled();
  const skipped = checkOffline(['closed tab'], 'en-US', 0, obsolete.signal);
  const current = checkOffline(['current tab'], 'en-US', 0);
  obsolete.abort();
  await assert.rejects(skipped, { name: 'AbortError' });
  first.abort();
  assert.deepEqual(messages.map(message => message.texts || message.cancel), [['first tab'], messages[0].id]);
  worker.reply({ id: messages[0].id, cancelled: true });
  await assert.rejects(checking, { name: 'AbortError' });
  await settled();
  assert.deepEqual(messages[2].texts, ['current tab']);
  worker.reply({ id: messages[2].id, results: [[]] });
  assert.deepEqual(await current, [[]]);
  assert.equal(messages.length, 3);
  worker.onerror({ message: 'Test worker closed' });
});

test('native grammar drains the active inference and sends only remaining live panes in order', async t => {
  const calls = [];
  replaceGlobal(t, 'window', { wraiter: { offlineGrammar: request => new Promise(resolve => calls.push({ request, resolve })) } });
  const first = new AbortController(), hidden = new AbortController();
  const checking = checkAdvancedOffline(['old document'], 'en-US', first.signal);
  await settled();
  const skipped = checkAdvancedOffline(['closed document'], 'en-US', hidden.signal);
  const visible = checkAdvancedOffline(['visible document'], 'sv-SE');
  const otherPane = checkAdvancedOffline(['other pane'], 'en-GB');
  hidden.abort(); first.abort();
  await assert.rejects(skipped, { name: 'AbortError' });
  assert.equal(calls.length, 1);
  calls[0].resolve([[]]); await assert.rejects(checking, { name: 'AbortError' });
  await settled(); assert.deepEqual(calls[1].request, { texts: ['visible document'], language: 'sv-SE' });
  calls[1].resolve([[]]); assert.deepEqual(await visible, [[]]);
  await settled(); assert.deepEqual(calls[2].request, { texts: ['other pane'], language: 'en-GB' });
  calls[2].resolve([[]]); assert.deepEqual(await otherPane, [[]]);
  assert.equal(calls.length, 3);
});
