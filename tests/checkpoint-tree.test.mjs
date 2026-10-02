import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpointTree, checkpointGraph, currentCheckpointPath } from '../src/checkpoint-tree.js';

test('version tree preserves both paths after returning to an earlier checkpoint', () => {
  const entries = [
    { revision: 'first-path-end', parentRevision: 'first-path', date: '2026-01-04T00:00:00Z' },
    { revision: 'new-path', parentRevision: 'crossroad', date: '2026-01-05T00:00:00Z' },
    { revision: 'crossroad', parentRevision: 'start', date: '2026-01-02T00:00:00Z' },
    { revision: 'first-path', parentRevision: 'crossroad', date: '2026-01-03T00:00:00Z' },
    { revision: 'start', parentRevision: '', date: '2026-01-01T00:00:00Z' }
  ];
  const rows = checkpointTree(entries, 'new-path');
  assert.deepEqual(rows.map(row => row.item.revision), ['start', 'crossroad', 'first-path', 'first-path-end', 'new-path']);
  assert.deepEqual(rows.filter(row => row.onCurrentPath).map(row => row.item.revision), ['start', 'crossroad', 'new-path']);
  assert.equal(rows.find(row => row.item.revision === 'new-path').forked, true);
  assert.equal(rows.find(row => row.item.revision === 'new-path').depth, 1);
  assert.equal(rows.find(row => row.item.revision === 'first-path-end').onCurrentPath, false);
  assert.deepEqual(currentCheckpointPath(entries, 'new-path').map(row => row.item.revision), ['new-path', 'crossroad', 'start']);
  const graph = checkpointGraph(entries, 'new-path');
  assert.equal(graph.rows.length, entries.length);
  assert.equal(graph.rows.find(row => row.item.revision === 'first-path-end').parentRevision, 'first-path');
  assert.equal(graph.rows.find(row => row.item.revision === 'new-path').parentRevision, 'crossroad');
  assert.equal(graph.rows.find(row => row.item.revision === 'new-path').lane, graph.rows.find(row => row.item.revision === 'crossroad').lane);
  assert.notEqual(graph.rows.find(row => row.item.revision === 'first-path').lane, graph.rows.find(row => row.item.revision === 'new-path').lane);
});

test('current path ignores unrelated branches and missing parents', () => {
  const entries = [
    { revision: 'other', parentRevision: 'root' },
    { revision: 'latest', parentRevision: 'middle' },
    { revision: 'root', parentRevision: 'missing' },
    { revision: 'middle', parentRevision: 'root' }
  ];
  assert.deepEqual(currentCheckpointPath(entries, 'latest').map(row => row.item.revision), ['latest', 'middle', 'root']);
  assert.deepEqual(currentCheckpointPath(entries, 'absent'), []);
});
