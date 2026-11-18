import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutHistory, zoomCamera, fitCamera, searchHistory } from '../src/history-map.js';
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

test('scene names can change without moving a version or either end of a merge', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ revision: 'v' + i, parentRevision: i ? 'v' + (i - 1) : null, title: 'Save ' + i, date: '2026-01-01' }));
  entries.push({ revision: 'other', parentRevision: 'v2', title: 'Harbour ending', date: '2026-01-02' });
  entries[9].parentRevisions = ['v8', 'other'];
  entries[5].passage = { excerpts: [{ quote: 'Inez asks the ferryman for directions.' }] };
  const sequence = entries.slice(3, 8).map(e => e.revision);
  const history = { entries, headRevision: 'v11', passages: [{ key: 'ferry', title: 'The river', revisions: sequence }] };
  const map = layoutHistory(history);
  const named = layoutHistory(history, { ferry: [{ end: 2, title: 'Inez rows' }, { end: 5, title: 'She asks for directions' }] });
  assert.equal(named.points.size, entries.length); assert.equal(named.sceneOf.size, entries.length);
  assert.deepEqual([...map.points.values()], [...named.points.values()]);
  assert.ok(named.points.get('other').y !== named.points.get('v3').y);
  assert.ok(named.edges.some(e => e.merge && e.from.item.revision === 'other' && e.to.item.revision === 'v9'));
  for (const e of named.edges) assert.ok(e.to.x > e.from.x);
  assert.equal(searchHistory(map, 'ferryman directions')[0].point.item.revision, 'v5');
  assert.equal(searchHistory(named, 'asks for directions')[0].scene.title, 'She asks for directions');
});

test('wheel zoom preserves the world coordinate under the pointer and fit includes the complete graph', () => {
  const bounds = { left: 0, top: 0, right: 18000, bottom: 600 };
  const camera = fitCamera(bounds, 700, 360), anchor = { x: 134, y: 209 };
  const close = zoomCamera(camera, 1.67, anchor, 0.01);
  for (const axis of ['x', 'y']) assert.ok(Math.abs((anchor[axis] - close[axis]) / close.k - (anchor[axis] - camera[axis]) / camera.k) < 1e-8);
  assert.ok(camera.x > 0 && camera.x + bounds.right * camera.k < 700);
  assert.ok(camera.y > 0 && camera.y + bounds.bottom * camera.k < 360);
  assert.equal(zoomCamera(close, 9999, anchor, .01).k, 6);
});
