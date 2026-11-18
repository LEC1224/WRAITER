import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpointTree, checkpointGraph, currentCheckpointPath, checkpointWindows, projectCheckpointWindows } from '../src/checkpoint-tree.js';

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

test('semantic zoom preserves junctions, both merge edges and every original revision', () => {
  const entries = Array.from({ length: 42 }, (_, index) => ({ revision: 'v' + index, parentRevision: index ? 'v' + (index - 1) : null, title: 'Draft ' + index, date: '2026-01-01' }));
  entries.push({ revision: 'alternate', parentRevision: 'v5', date: '2026-01-02' });
  entries[31].parentRevisions = ['v30', 'alternate'];
  const graph = checkpointGraph(entries.reverse(), 'v41');
  const windows = checkpointWindows(graph.rows, 0, Date.parse('2026-01-02'));
  assert.ok(windows.length);
  const overview = projectCheckpointWindows(graph.rows, windows, {}, new Set(), '');
  assert.ok(overview.length < graph.rows.length);
  assert.deepEqual(new Set(overview.flatMap(row => row.group?.members.map(member => member.item.revision) || row.item.revision)), new Set(entries.map(item => item.revision)));
  for (const id of ['v0', 'v5', 'alternate', 'v30', 'v31', 'v41']) assert.ok(overview.some(row => row.item.revision === id && !row.group));
  assert.deepEqual(overview.find(row => row.item.revision === 'v31').parentRevisions, ['v30', 'alternate']);
  for (const row of overview) for (const parent of row.parentRevisions) assert.ok(overview.find(item => item.item.revision === parent).row < row.row);
  const range = windows.find(item => item.members.length >= 4), first = range.members[0].item;
  const plans = { [range.key]: [{ end: 2, title: 'First scene' }, { end: range.members.length, title: 'Second scene' }] };
  assert.ok(projectCheckpointWindows(graph.rows, windows, plans, new Set(), '').some(row => row.group?.title === 'Second scene'));
  assert.ok(projectCheckpointWindows(graph.rows, windows, plans, new Set([first.revision]), '').some(row => row.item.revision === first.revision && !row.group));
  assert.ok(projectCheckpointWindows(graph.rows, windows, {}, new Set(), first.title.toLowerCase()).some(row => row.item.revision === first.revision && !row.group));
  assert.equal(checkpointWindows(graph.rows, 2).length, 0);
});
