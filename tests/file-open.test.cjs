const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { documentArguments } = require('../electron/file-open.cjs');

test('Explorer arguments accept spaces, Unicode, and uppercase extensions', () => {
  const directory = path.resolve('Books & drafts');
  const target = path.join(directory, 'Ännu en story.WRAITER');
  assert.deepEqual(documentArguments(['WRAITER.exe', target], directory), [target]);
  assert.deepEqual(documentArguments(['WRAITER.exe', `"${target}"`], directory), [target]);
});

test('relative shell arguments resolve against the launching process directory', () => {
  const directory = path.resolve('Other folder');
  assert.deepEqual(documentArguments(['WRAITER.exe', 'My story.wraiter', '..' + path.sep + 'Second.wraiter'], directory), [path.join(directory, 'My story.wraiter'), path.resolve(directory, '..', 'Second.wraiter')]);
});

test('development entry points and Electron switches are not manuscripts', () => {
  const directory = path.resolve('Documents');
  assert.deepEqual(documentArguments(['electron.exe', 'application.wraiter', '--inspect=9222', '--user-data-dir=ignored.wraiter', '--updated', 'story.txt', 'real.wraiter'], directory, true), [path.join(directory, 'real.wraiter')]);
  assert.deepEqual(documentArguments(['WRAITER.exe', '--updated', '', null, 'bad\0.wraiter'], directory), []);
});

test('multiple requests retain their order and duplicate paths are coalesced', () => {
  const directory = path.resolve('Documents');
  const expected = [path.join(directory, 'First.wraiter'), path.join(directory, 'Second.wraiter')];
  assert.deepEqual(documentArguments(['WRAITER.exe', ...expected, 'First.wraiter'], directory), expected);
  if (process.platform === 'win32') assert.deepEqual(documentArguments(['WRAITER.exe', expected[0], expected[0].toUpperCase()], directory), [expected[0]]);
});
