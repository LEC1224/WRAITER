import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePanes, placePane, reconcilePanes, resizePair } from '../src/multitask.js';

test('splitting preserves neighbours and moving a visible document never duplicates it', () => {
  const original = [{ id: 'a', size: 1 }];
  const two = placePane(original, 'b', 'a', 'left');
  assert.deepEqual(two, [{ id: 'b', size: .5 }, { id: 'a', size: .5 }]);
  const three = placePane(two, 'c', 'a', 'right');
  assert.deepEqual(three.map(pane => pane.id), ['b', 'a', 'c']);
  assert.equal(three.reduce((sum, pane) => sum + pane.size, 0), 1);
  assert.deepEqual(placePane(three, 'b', 'c', 'right').map(pane => pane.id), ['a', 'c', 'b']);
  assert.equal(placePane(three, 'a', 'a', 'left'), three);
  assert.deepEqual(original, [{ id: 'a', size: 1 }]);
});

test('ordinary tab selection replaces the focused panel and closing tabs removes stale panels', () => {
  const panes = [{ id: 'a', size: .3 }, { id: 'b', size: .7 }];
  assert.deepEqual(reconcilePanes(panes, ['a', 'b', 'c'], 'c', 'b'), [{ id: 'a', size: .3 }, { id: 'c', size: .7 }]);
  assert.deepEqual(reconcilePanes(panes, ['a', 'b'], 'a', 'b'), panes);
  assert.deepEqual(reconcilePanes(panes, ['b'], 'b', 'a'), [{ id: 'b', size: 1 }]);
  assert.deepEqual(reconcilePanes(panes, ['c'], 'c', 'b'), [{ id: 'c', size: 1 }]);
});

test('closing and reopening alternating sides always assigns the full workspace', () => {
  let panes = [{ id: 'a', size: 1 }];
  for (let cycle = 0; cycle < 100; cycle++) {
    panes = placePane(panes, 'b', 'a', cycle % 2 ? 'left' : 'right');
    assert.equal(panes.reduce((sum, pane) => sum + pane.size, 0), 1);
    assert.deepEqual(panes.map(pane => pane.size), [.5, .5]);
    // Panel removal and closing its underlying tab must both refill the strip.
    panes = cycle % 2 ? reconcilePanes(panes, ['a'], 'a', 'b') : normalizePanes(panes.filter(pane => pane.id !== 'b'));
    assert.deepEqual(panes, [{ id: 'a', size: 1 }]);
  }
});

test('removing a resized pane retains the surviving proportions without leaving a gap', () => {
  const original = [{ id: 'a', size: .2 }, { id: 'b', size: .3 }, { id: 'c', size: .5 }];
  const remaining = reconcilePanes(original, ['a', 'c'], 'c', 'b');
  assert.ok(Math.abs(remaining[0].size / remaining[1].size - .4) < 1e-12);
  assert.equal(remaining.reduce((sum, pane) => sum + pane.size, 0), 1);
  assert.deepEqual(original.map(pane => pane.size), [.2, .3, .5]);
  const moved = placePane(remaining, 'c', 'a', 'left');
  assert.deepEqual(moved, [remaining[1], remaining[0]], 'Moving keeps each pane size instead of splitting the target');
  assert.deepEqual(normalizePanes([{ id: 'a', size: NaN }, { id: 'b', size: 0 }]), [{ id: 'a', size: .5 }, { id: 'b', size: .5 }]);
});

test('divider movement conserves the neighbouring pair and enforces readable minimums', () => {
  assert.deepEqual(resizePair(500, 400, 100), [600, 300]);
  assert.deepEqual(resizePair(500, 400, 9999), [660, 240]);
  assert.deepEqual(resizePair(500, 400, -9999), [240, 660]);
  assert.deepEqual(resizePair(150, 150, 40), [150, 150]);
});
