import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { moveItem, nextZoom, imageDimensions } from '../src/document-ux.js';
const require = createRequire(import.meta.url), { externalLink, droppedPath } = require('../electron/document-ux.cjs');
test('reordering preserves identities, handles either drop edge and ignores stale/no-op targets', () => {
  const items = ['a', 'b', 'c'].map(id => ({ id }));
  assert.deepEqual(moveItem(items, 'a', 'c', true).map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(items, 'c', 'a').map(item => item.id), ['c', 'a', 'b']);
  assert.equal(moveItem(items, 'missing', 'a'), items); assert.equal(moveItem(items, 'b', 'a', true), items);
  assert.equal(moveItem(items, 'a', 'a'), items); assert.equal(moveItem(items, 'a', 'c', true)[2], items[0]);
});
test('zoom steps share the percentage presets and respect bounds and custom percentages', () => {
  assert.equal(nextZoom(100, 1), 110); assert.equal(nextZoom(125, -1), 110); assert.equal(nextZoom(113, 1), 125);
  assert.equal(nextZoom(200, 1), 200); assert.equal(nextZoom(50, -1), 50);
});
test('office image sizes retain both edited dimensions and bound unsized pictures proportionally', () => {
  assert.deepEqual(imageDimensions({ width: 300, height: 200 }, 180, 90), { width: 300, height: 200 });
  assert.deepEqual(imageDimensions({ width: 1200, height: 600 }, 180, 90), { width: 1200, height: 600 });
  assert.deepEqual(imageDimensions({}, 2400, 1200), { width: 600, height: 300 });
});
test('external links allow web/mail links and reject file, script, credentials and malformed input', () => {
  assert.equal(externalLink('https://example.com/a?b=1'), 'https://example.com/a?b=1'); assert.equal(externalLink('mailto:writer@example.com'), 'mailto:writer@example.com');
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,a', 'https://', 'https://user:pass@example.com', 'mailto:', 'https://example.com\n']) assert.throws(() => externalLink(url));
});
test('dropped paths accept only absolute supported documents and text references', () => {
  const base = process.platform === 'win32' ? 'D:\\Documents\\' : '/tmp/';
  assert.equal(droppedPath(base + 'BOOK.DOCX'), base + 'BOOK.DOCX'); assert.equal(droppedPath(base + 'Notes.md', true), base + 'Notes.md');
  for (const value of ['relative.txt', base + 'run.exe', '', null]) assert.throws(() => droppedPath(value));
  assert.throws(() => droppedPath(base + 'Book.docx', true));
});
