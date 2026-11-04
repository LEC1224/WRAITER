import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { createHistory, recordTransaction, applyHistory, normalizeHistoryProject, structuralFingerprint } from '../src/history.js';
import { createRequire } from 'node:module';
const { contentHash } = createRequire(import.meta.url)('../electron/document-files.cjs');
const additions = new Set(['spaceBefore', 'leftIndent', 'rightIndent', 'wrap', 'cellBackground', 'cellBorder', 'namedStyle', 'tabStops']);

test('all new null schema defaults preserve old history and Office dirtiness', () => {
  const nodes = {}; schema.spec.nodes.forEach((name, spec) => { nodes[name] = { ...spec, ...(spec.attrs ? { attrs: Object.fromEntries(Object.entries(spec.attrs).filter(([key]) => !additions.has(key))) } : {}) }; });
  const old = new Schema({ nodes, marks: schema.spec.marks });
  const doc = old.nodes.doc.create(null, [old.nodes.paragraph.create(null, old.text('Before')), old.nodes.image.create({ src: 'data:image/png;base64,AA==' }), old.nodes.table.create(null, [old.nodes.tableRow.create(null, [old.nodes.tableCell.create(null, [old.nodes.paragraph.create(null, old.text('Cell', [old.marks.superscript.create()]))])])])]);
  const project = { id: 'schema-compat', title: 'Test', chapters: [{ id: 'one', title: 'Chapter', content: doc.toJSON() }] };
  const state = EditorState.create({ schema: old, doc }), tr = state.tr.insertText('!', 7);
  const next = { ...project, chapters: [{ ...project.chapters[0], content: tr.doc.toJSON() }] };
  const history = recordTransaction(createHistory(project), { chapterId: 'one', beforeProject: project, afterProject: next, transaction: tr });
  const normalized = normalizeHistoryProject(next, schema);
  assert.equal(contentHash(normalized), contentHash(next));
  const resumed = createHistory(normalized, { events: structuredClone(history.events) });
  const undone = applyHistory(normalized, resumed, 'undo', schema);
  assert.equal(schema.nodeFromJSON(undone.project.chapters[0].content).textContent, 'BeforeCell');
  const redone = applyHistory(undone.project, undone.journal, 'redo', schema);
  assert.equal(schema.nodeFromJSON(redone.project.chapters[0].content).textContent, 'Before!Cell');
  assert.equal(schema.nodeFromJSON(redone.project.chapters[0].content).lastChild.firstChild.firstChild.firstChild.firstChild.marks[0].type.name, 'superscript');
});

test('interim preview fingerprints with explicit null fields remain readable', () => {
  const project = normalizeHistoryProject({ id: 'preview-history', title: 'Test', chapters: [{ id: 'one', title: 'One', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] } }] }, schema);
  const fingerprint = structuralFingerprint(project, true);
  const events = [{ version: 1, kind: 'init', sequence: 1, projectId: project.id, fingerprint, timestamp: new Date().toISOString() }];
  assert.doesNotThrow(() => createHistory(project, { events }));
});

test('paragraph-only and image/table preview histories survive later schema additions', () => {
  for (const omitted of [new Set(['wrap', 'cellBackground', 'cellBorder', 'namedStyle', 'tabStops']), new Set(['namedStyle', 'tabStops'])]) {
    const nodes = {}; schema.spec.nodes.forEach((name, spec) => { nodes[name] = { ...spec, ...(spec.attrs ? { attrs: Object.fromEntries(Object.entries(spec.attrs).filter(([key]) => !omitted.has(key))) } : {}) }; });
    const interim = new Schema({ nodes, marks: schema.spec.marks });
    const project = { id: 'preview-intermediate', title: 'Test', chapters: [{ id: 'one', title: 'One', content: interim.nodes.doc.create(null, [interim.nodes.paragraph.create(null, interim.text('Text'))]).toJSON() }] };
    const events = [{ version: 1, kind: 'init', sequence: 1, projectId: project.id, fingerprint: structuralFingerprint(project, true), timestamp: new Date().toISOString() }];
    assert.doesNotThrow(() => createHistory(normalizeHistoryProject(project, schema), { events }));
  }
});
