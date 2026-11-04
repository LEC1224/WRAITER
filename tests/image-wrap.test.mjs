import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { editorialSchema } from '../electron/editor-schema.mjs';
const require = createRequire(import.meta.url);
const { validateProject } = require('../electron/core.cjs');

test('wrapped images preserve their position in the shared schema and native projects', () => {
  const attrs = { src: 'data:image/png;base64,YQ==', wrap: 'left' };
  const image = editorialSchema.nodes.image.create(attrs);
  assert.equal(image.attrs.wrap, 'left');
  const html = image.type.spec.toDOM(image);
  assert.equal(html[1]['data-image-wrap'], 'left');
  assert.match(html[1].style, /float:left/);
  const project = { format: 'wraiter', version: 1, id: 'test', title: 'Test', chapters: [{ id: 'one', title: 'One', content: { type: 'doc', content: [{ type: 'image', attrs }] } }] };
  assert.doesNotThrow(() => validateProject(project));
  project.chapters[0].content.content[0].attrs.wrap = 'center';
  assert.throws(() => validateProject(project), /image wrapping/i);
});

test('cell colours survive the shared schema and render as HTML attributes', () => {
  const cell = editorialSchema.nodes.tableCell.create({ cellBackground: '#ffeecc', cellBorder: '#334455' }, [editorialSchema.nodes.paragraph.create()]);
  const dom = cell.type.spec.toDOM(cell);
  assert.equal(dom[1]['data-cell-background'], '#ffeecc');
  assert.equal(dom[1]['data-cell-border'], '#334455');
  assert.match(dom[1].style, /background-color:\s*#ffeecc/);
  assert.match(dom[1].style, /border:\s*1px solid #334455/);
});
