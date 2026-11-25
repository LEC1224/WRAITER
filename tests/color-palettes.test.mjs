import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOUR_PRESETS, RECENT_COLOUR_LIMIT, normalizePalette, paletteStorageKey, readPalette, updatePalette, writePalette } from '../src/color-palettes.js';

test('stored palettes reject malformed values, normalize hex case, and exclude selected colours from history', () => {
  for (const malformed of [null, undefined, false, 42, 'palette', [], { locked: {}, recent: '#123456' }]) {
    assert.deepEqual(normalizePalette(malformed, 'text'), { locked: [], recent: [] });
  }
  assert.deepEqual(normalizePalette({
    locked: ['#ABCDEF', '#abcdef', '#000000', '#fff', 'red', null, 123],
    recent: ['#ABCDEF', '#FFFFFF', '#123456', '#123456', '#abcdef00', '#GGGGGG', '#0a0B0c', {}, ' #123456']
  }, 'text'), { locked: ['#abcdef'], recent: ['#123456', '#0a0b0c'] });
});

test('each picker excludes only its own defaults and keeps its custom palette independent', () => {
  for (const kind of ['text', 'highlight']) {
    const own = COLOUR_PRESETS[kind].map(([, colour]) => colour);
    const other = COLOUR_PRESETS[kind === 'text' ? 'highlight' : 'text'][0][1];
    assert.deepEqual(normalizePalette({ locked: own, recent: [...own, other] }, kind), { locked: [], recent: [other] });
    for (const colour of own) {
      assert.deepEqual(updatePalette(null, kind, 'remember', colour), { locked: [], recent: [] });
      assert.deepEqual(updatePalette(null, kind, 'lock', colour), { locked: [], recent: [] });
    }
  }
  assert.notEqual(paletteStorageKey('text'), paletteStorageKey('highlight'));
});

test('history keeps twelve unique custom choices in recency order without mutating prior state', () => {
  const colours = Array.from({ length: 14 }, (_, index) => '#' + (0x102030 + index).toString(16));
  let palette = Object.freeze({ locked: Object.freeze(['#abcdef']), recent: Object.freeze([]) });
  for (const colour of colours) {
    const previous = palette, snapshot = structuredClone(previous);
    palette = updatePalette(previous, 'text', 'remember', colour);
    assert.deepEqual(previous, snapshot);
    Object.freeze(palette.locked); Object.freeze(palette.recent); Object.freeze(palette);
  }
  assert.equal(palette.recent.length, RECENT_COLOUR_LIMIT);
  assert.deepEqual(palette.recent, colours.slice(-12).reverse());
  const chosen = palette.recent[5], moved = updatePalette(palette, 'text', 'remember', chosen.toUpperCase());
  assert.deepEqual(moved.recent, [chosen, ...palette.recent.filter(colour => colour !== chosen)]);
  assert.deepEqual(updatePalette(palette, 'text', 'remember', '#ABCDEF'), palette);
});

test('locking promotes a history choice and unlocking returns it to newest history without duplicating it', () => {
  const source = Object.freeze({ locked: Object.freeze(['#123456']), recent: Object.freeze(['#abcdef', '#fedcba']) });
  const locked = updatePalette(source, 'text', 'lock', '#ABCDEF');
  assert.deepEqual(locked, { locked: ['#123456', '#abcdef'], recent: ['#fedcba'] });
  assert.deepEqual(source, { locked: ['#123456'], recent: ['#abcdef', '#fedcba'] });
  assert.deepEqual(updatePalette(locked, 'text', 'lock', '#abcdef'), locked);
  assert.deepEqual(updatePalette(locked, 'text', 'remember', '#abcdef'), locked);
  assert.deepEqual(updatePalette(locked, 'text', 'unlock', '#abcdef'), { locked: ['#123456'], recent: ['#abcdef', '#fedcba'] });
  for (const [action, colour] of [['lock', '#010203'], ['unlock', '#fedcba'], ['remember', 'invalid'], ['unknown', '#010203']]) {
    assert.deepEqual(updatePalette(locked, 'text', action, colour), locked);
  }
  const recent = Array.from({ length: 12 }, (_, index) => '#' + (0x102030 + index).toString(16));
  assert.deepEqual(updatePalette({ locked: ['#abcdef'], recent }, 'text', 'unlock', '#abcdef'), { locked: [], recent: ['#abcdef', ...recent.slice(0, 11)] });
});

test('preference loading and saving handle absent, corrupt, or unavailable storage safely', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    } });
    assert.deepEqual(readPalette('text'), { locked: [], recent: [] });
    values.set(paletteStorageKey('text'), '{broken JSON');
    assert.deepEqual(readPalette('text'), { locked: [], recent: [] });
    values.set(paletteStorageKey('text'), '{"locked":"#123456","recent":false}');
    assert.deepEqual(readPalette('text'), { locked: [], recent: [] });
    writePalette('text', { locked: ['#ABCDEF', '#000000'], recent: ['#abcdef', '#123456', '#ffffff'] });
    writePalette('highlight', { locked: [], recent: ['#000000'] });
    assert.deepEqual(readPalette('text'), { locked: ['#abcdef'], recent: ['#123456'] });
    assert.deepEqual(readPalette('highlight'), { locked: [], recent: ['#000000'] });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
    assert.deepEqual(readPalette('text'), { locked: [], recent: [] });
    assert.doesNotThrow(() => writePalette('highlight', { locked: [], recent: ['#123456'] }));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
