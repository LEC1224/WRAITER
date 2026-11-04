import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { editorialSchema } from '../electron/editor-schema.mjs';
import { newProject, snapshot } from '../src/document.js';
import { namedStyleCSS, namedStyleDeclarations, sanitizeNamedStyles } from '../src/named-styles.js';
import { templateFromProject, projectFromTemplate } from '../src/templates.js';
import { createHistory, recordProjectChange, applyHistory, prepareHistoryLoad } from '../src/history.js';
const { validateProject } = createRequire(import.meta.url)('../electron/core.cjs');

test('named styles are validated, survive templates and snapshots, and undo after restart', () => {
  const before = newProject();
  before.chapters[0].content = editorialSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { namedStyle: 'body1' }, content: [{ type: 'text', text: 'Story', marks: [{ type: 'namedStyle', attrs: { id: 'emphasis1' } }] }] }] }).toJSON();
  before.namedStyles = [{ id: 'body1', name: 'Body', kind: 'paragraph', attrs: { lineHeight: 1.5 } }, { id: 'emphasis1', name: 'Emphasis', kind: 'character', attrs: { italic: true } }];
  validateProject(before);
  const after = { ...before, namedStyles: [{ ...before.namedStyles[0], attrs: { lineHeight: 2 } }, before.namedStyles[1]] };
  const journal = recordProjectChange(createHistory(before), before, after, { label: 'Change Body' });
  const saved = { ...after, historySequence: journal.sequence };
  const loaded = prepareHistoryLoad(saved, { events: journal.events, recoverySequence: journal.sequence }, editorialSchema);
  assert.equal(loaded.requiresJournalReset, false);
  const undone = applyHistory(loaded.project, loaded.journal, 'undo', editorialSchema);
  assert.equal(undone.project.namedStyles[0].attrs.lineHeight, 1.5);
  const redone = applyHistory(undone.project, undone.journal, 'redo', editorialSchema);
  assert.equal(redone.project.namedStyles[0].attrs.lineHeight, 2);
  assert.deepEqual(projectFromTemplate(templateFromProject(after, 'Draft')).namedStyles, after.namedStyles);
  assert.deepEqual(snapshot(after).namedStyles, after.namedStyles);
  assert.throws(() => validateProject({ ...after, namedStyles: [{ id: 'safe', name: 'Bad', kind: 'paragraph', attrs: { fontFamily: '</style><script>' } }] }), /Invalid named style font/);
});

test('named style CSS rejects unsafe values and targets linked text', () => {
  const css = namedStyleCSS([{ id: 'body1', kind: 'paragraph', attrs: { fontSize: 14, lineHeight: 1.5 } }, { id: 'character1', kind: 'character', attrs: { italic: true, color: '#12aabb' } }], '.manuscript ');
  assert.match(css, /\.manuscript \[data-paragraph-style="body1"\]\{font-size:14pt;line-height:1.5\}/);
  assert.match(css, /data-character-style="character1"/);
  assert.equal(namedStyleDeclarations({ fontFamily: '</style><script>', color: 'red;display:none', fontSize: 999 }), '');
  assert.equal(sanitizeNamedStyles([{ id: 'valid', name: 'Bad', kind: 'paragraph', attrs: { fontFamily: '</style><script>' } }]), null);
  assert.equal(sanitizeNamedStyles([{ id: 'bad id', name: 'Bad', kind: 'paragraph', attrs: {} }]), null);
  assert.equal(sanitizeNamedStyles([{ id: 'valid', name: 'Bad', kind: 'paragraph', attrs: { unknown: 'x' } }]), null);
});
