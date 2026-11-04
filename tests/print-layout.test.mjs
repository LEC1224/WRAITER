import test from 'node:test';
import assert from 'node:assert/strict';
import { printLayoutCSS, normalizePrintLayout, pageDimensions } from '../src/print-layout.js';
import { newProject, snapshot } from '../src/document.js';
import { templateFromProject, projectFromTemplate } from '../src/templates.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { validateProject } = require('../electron/core.cjs'), { contentHash } = require('../electron/document-files.cjs');

test('page setup generates safe, bounded page and running text CSS', () => {
  const css = printLayoutCSS({ printLayout: { size: 'Letter', orientation: 'landscape', top: -100, right: 500, bottom: 22, left: 22, header: '</style><script>bad</script>', footer: 'Page {page} of {pages}' } });
  assert.match(css, /size:letter landscape/);
  assert.match(css, /margin:8mm 60mm 22mm 22mm/);
  assert(!css.includes('</style>'));
  assert.match(css, /counter\(page\)/);
  assert.match(css, /counter\(pages\)/);
  assert.equal(printLayoutCSS(), '');
});

test('page setup persists through snapshots/templates and changes Office content hashes', () => {
  const project = newProject(), before = contentHash(project);
  project.printLayout = normalizePrintLayout({ size: 'A5', orientation: 'landscape', top: 18, header: 'Draft {page}' });
  assert.deepEqual(pageDimensions(project.printLayout), { width: 210, height: 148 });
  assert.notEqual(contentHash(project), before);
  assert.deepEqual(snapshot(project, 'Page setup').printLayout, project.printLayout);
  assert.deepEqual(projectFromTemplate(templateFromProject(project, 'Page template')).printLayout, project.printLayout);
  assert.doesNotThrow(() => validateProject(project));
  project.printLayout.top = -1;
  assert.throws(() => validateProject(project), /page margin/i);
  assert.equal(normalizePrintLayout(null).size, 'A4');
});
