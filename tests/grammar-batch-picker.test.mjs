import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrammarBatchPicker } from '../src/grammar-batch-picker.js';

test('each engine prioritizes the caret, retries unfinished passages and eventually covers every distinct chunk', () => {
  const chunk = text => ({ text, from: 0, status: 'waiting', deepStatus: 'waiting' });
  const blocks = Array.from({ length: 55 }, (_, i) => ({ pos: i * 2001, node: { nodeSize: 2001, chunks: [chunk(String(i).padEnd(1900, '.'))] } }));
  blocks[5].node = blocks[7].node;
  const expected = new Set(blocks.flatMap(({ node }) => node.chunks));
  const pick = createGrammarBatchPicker(blocks, node => node.chunks);
  const caret = blocks.at(-1).pos + 4;
  assert.deepEqual(pick(caret, true), []);
  const first = pick(caret);
  assert.equal(first[0], blocks.at(-1).node.chunks[0]);
  first.forEach(item => { item.status = 'pending'; });
  assert.ok(pick(caret).every(item => !first.includes(item)));
  first.forEach(item => { item.status = 'waiting'; });
  assert.deepEqual(pick(caret), first);
  for (const deep of [false, true]) {
    const completed = new Set();
    for (let i = 0; i <= expected.size; i++) {
      const batch = pick(caret, deep);
      if (!batch.length) break;
      assert.ok(batch.length <= (deep ? 2 : 16));
      assert.ok(batch.reduce((n, c) => n + c.text.length, 0) <= (deep ? 3500 : 12000));
      for (const item of batch) {
        assert.ok(!completed.has(item));
        completed.add(item); item[deep ? 'deepStatus' : 'status'] = 'done';
      }
    }
    assert.deepEqual(completed, expected);
  }
});
