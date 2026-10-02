import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { CommentAnchor, collectCommentRanges } from '../electron/comments.mjs';
import { addComment, updateComment, deleteComment, commentRanges, projectCommentRows, reconcileCommentChapters, stripCommentAnchors } from '../src/comments.js';
import { createHistory, normalizeHistoryProject, recordProjectChange, recordTransaction, applyHistory, historyProjectContent } from '../src/history.js';
import { snapshot } from '../src/document.js';

const require = createRequire(import.meta.url);
const { validateProject, DocumentStore } = require('../electron/core.cjs');
const content = text => schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]).toJSON();
const project = () => normalizeHistoryProject({
  format: 'wraiter', version: 1, id: 'comment-draft', title: 'Comment draft', notes: '', style: '', references: [], snapshots: [],
  chapters: [{ id: 'chapter-a', title: 'Opening', content: content('Alpha beta gamma') }, { id: 'chapter-b', title: 'Ending', content: content('Omega') }]
}, schema);
const anchored = () => addComment(project(), { chapterId: 'chapter-a', from: 7, to: 11, text: 'Check this detail.', id: 'comment-a' }, schema).project;

test('comments attach to exact passages without changing text and can overlap', () => {
  const original = project(), originalJSON = JSON.stringify(original);
  let next = addComment(original, { chapterId: 'chapter-a', from: 1, to: 11, text: 'Opening detail.', id: 'comment-a' }, schema).project;
  next = addComment(next, { chapterId: 'chapter-a', from: 7, to: 17, text: 'Second detail.', id: 'comment-b' }, schema).project;
  assert.equal(JSON.stringify(original), originalJSON, 'Preparation must leave the live manuscript untouched.');
  assert.equal(schema.nodeFromJSON(next.chapters[0].content).textContent, 'Alpha beta gamma');
  assert.deepEqual(commentRanges(next.chapters[0].content, 'comment-a'), [{ from: 1, to: 11 }]);
  assert.deepEqual(commentRanges(next.chapters[0].content, 'comment-b'), [{ from: 7, to: 17 }]);
  const doc = schema.nodeFromJSON(next.chapters[0].content);
  assert.deepEqual(doc.nodeAt(7).marks.map(mark => mark.attrs.id), ['comment-a', 'comment-b']);
  assert.equal(next.comments[0].quote, 'Alpha beta');
  assert.equal(next.comments[1].quote, 'beta gamma');
  assert.equal(validateProject(next), next);
});

test('anchor marks follow insertion and become detached only when their passage disappears', () => {
  let next = anchored(), state = EditorState.create({ schema, doc: schema.nodeFromJSON(next.chapters[0].content) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)).insertText('new '));
  assert.deepEqual(commentRanges(state.doc, 'comment-a'), [{ from: 11, to: 15 }], 'Text before the anchor must not grow the comment.');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 13)).insertText('X'));
  assert.deepEqual(commentRanges(state.doc, 'comment-a'), [{ from: 11, to: 16 }], 'Text typed inside the passage remains attached.');
  state = state.apply(state.tr.delete(11, 16));
  next = { ...next, chapters: next.chapters.map(chapter => chapter.id === 'chapter-a' ? { ...chapter, content: state.doc.toJSON() } : chapter) };
  const row = projectCommentRows(next)[0];
  assert.equal(row.detached, true); assert.deepEqual(row.ranges, []);
  assert.equal(row.comment.text, 'Check this detail.');
  assert.equal(validateProject(next), next);
  next = { ...next, chapters: next.chapters.filter(chapter => chapter.id !== 'chapter-a') };
  assert.equal(projectCommentRows(next)[0].chapter, undefined);
  assert.equal(validateProject(next), next, 'Deleting a chapter retains its private comment as a detached note.');
});

test('editing, resolving, reopening and deleting comments preserve overlapping anchors', () => {
  let next = anchored();
  next = addComment(next, { chapterId: 'chapter-a', from: 7, to: 17, text: 'Another note.', id: 'comment-b' }, schema).project;
  next = updateComment(next, 'comment-a', { text: 'Edited note.', resolved: true });
  assert.equal(next.comments[0].text, 'Edited note.'); assert.equal(next.comments[0].resolved, true);
  assert.deepEqual(commentRanges(next.chapters[0].content, 'comment-a'), [{ from: 7, to: 11 }]);
  next = updateComment(next, 'comment-a', { resolved: false });
  assert.equal(next.comments[0].resolved, false);
  const removed = deleteComment(next, 'comment-a');
  assert.deepEqual(removed.comments.map(comment => comment.id), ['comment-b']);
  assert.deepEqual(commentRanges(removed.chapters[0].content, 'comment-a'), []);
  assert.deepEqual(commentRanges(removed.chapters[0].content, 'comment-b'), [{ from: 7, to: 17 }]);
  assert.equal(schema.nodeFromJSON(removed.chapters[0].content).textContent, 'Alpha beta gamma');
  assert.equal(deleteComment(removed, 'missing'), removed);
});

test('moving and merging chapters reconcile a comment without modifying metadata or losing navigation', () => {
  const original = anchored(), originalJSON = JSON.stringify(original);
  const moved = { ...original, chapters: [{ ...original.chapters[0], content: content('Alpha gamma') }, { ...original.chapters[1], content: original.chapters[0].content }] };
  const next = reconcileCommentChapters(moved);
  assert.equal(next.comments[0].chapterId, 'chapter-b');
  assert.equal(next.comments[0].text, original.comments[0].text);
  assert.equal(next.comments[0].updatedAt, original.comments[0].updatedAt, 'A structural move must not pretend that the author edited the note.');
  assert.equal(JSON.stringify(original), originalJSON);
  assert.equal(moved.comments[0].chapterId, 'chapter-a');
  const rows = projectCommentRows(moved);
  assert.equal(rows[0].detached, false); assert.equal(rows[0].chapter.id, 'chapter-b', 'Navigation locates anchors even before reconciliation.');
  assert.equal(reconcileCommentChapters(next), next, 'Unchanged reconciliation preserves the immutable manuscript reference.');
  const merged = { ...next, chapters: [{ ...next.chapters[0], content: { type: 'doc', content: [...next.chapters[0].content.content, ...next.chapters[1].content.content] } }] };
  const reconciled = reconcileCommentChapters(merged);
  assert.equal(reconciled.comments[0].chapterId, 'chapter-a'); assert.equal(projectCommentRows(reconciled)[0].detached, false);
  assert.equal(validateProject(reconciled), reconciled);
});

test('a comment split between chapters stays attached and exposes every chapter location', () => {
  const original = project();
  original.chapters[0].content = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Alpha')), schema.node('paragraph', null, schema.text('Beta'))]).toJSON();
  const withComment = addComment(original, { chapterId: 'chapter-a', from: 1, to: 12, text: 'Review both passages.', id: 'cross-chapter' }).project;
  const [first, second] = withComment.chapters[0].content.content;
  const split = { ...withComment, chapters: [{ ...withComment.chapters[0], content: { type: 'doc', content: [first] } }, { ...withComment.chapters[1], content: { type: 'doc', content: [second] } }] };
  let rows = projectCommentRows(split);
  assert.deepEqual(rows[0].locations.map(location => location.chapter.id), ['chapter-a', 'chapter-b']);
  assert.equal(rows[0].detached, false); assert.equal(reconcileCommentChapters(split), split);
  const reordered = { ...split, chapters: [...split.chapters].reverse() };
  const reconciled = reconcileCommentChapters(reordered);
  assert.equal(reconciled.comments[0].chapterId, 'chapter-b', 'The first remaining attached chapter in manuscript order is primary.');
  const removedFirst = { ...split, chapters: [split.chapters[1]] };
  rows = projectCommentRows(removedFirst);
  assert.equal(rows[0].detached, false); assert.equal(rows[0].chapter.id, 'chapter-b');
  const deleted = deleteComment(removedFirst, 'cross-chapter');
  assert.equal(projectCommentRows(deleted).length, 0); assert.equal(collectCommentRanges(deleted.chapters[0].content, schema).size, 0);
});

test('comments attach to code passages and remain anchored when visual code formatting changes', () => {
  const original = project();
  original.chapters[0].content = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Alpha beta gamma', [schema.marks.code.create()]))]).toJSON();
  const next = addComment(original, { chapterId: 'chapter-a', from: 7, to: 11, text: 'Code detail.', id: 'code-comment' }).project;
  assert.deepEqual(commentRanges(next.chapters[0].content, 'code-comment'), [{ from: 7, to: 11 }]);
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(next.chapters[0].content) });
  const converted = state.tr.setBlockType(1, 17, schema.nodes.codeBlock).doc;
  converted.check();
  assert.deepEqual(commentRanges(converted, 'code-comment'), [{ from: 7, to: 11 }]);
  assert.equal(converted.nodeAt(7).marks.some(mark => mark.type.name === 'code'), false, 'Code blocks still remove visual character formatting.');
  const blockProject = { ...original, chapters: [{ ...original.chapters[0], content: schema.node('doc', null, [schema.node('codeBlock', null, schema.text('Alpha beta gamma'))]).toJSON() }, original.chapters[1]] };
  const blockComment = addComment(blockProject, { chapterId: 'chapter-a', from: 7, to: 11, text: 'Code block detail.', id: 'block-comment' }).project;
  assert.deepEqual(commentRanges(blockComment.chapters[0].content, 'block-comment'), [{ from: 7, to: 11 }]);
  assert.equal(validateProject(blockComment), blockComment);
  const formatted = EditorState.create({ schema, doc: schema.nodeFromJSON(anchored().chapters[0].content) });
  const code = formatted.tr.addMark(7, 11, schema.marks.bold.create()).addMark(7, 11, schema.marks.code.create()).doc;
  assert.deepEqual(commentRanges(code, 'comment-a'), [{ from: 7, to: 11 }]);
  assert.equal(code.nodeAt(7).marks.some(mark => mark.type.name === 'bold'), false);
});

test('comment creation is atomic in durable undo history, followed by typing, resolution and deletion', () => {
  let next = project(), journal = createHistory(next);
  const before = structuredClone(next);
  let candidate = addComment(next, { chapterId: 'chapter-a', from: 7, to: 11, text: 'A private note.', id: 'comment-a' }, schema).project;
  journal = recordProjectChange(journal, next, candidate, { label: 'Add comment' }); next = candidate;
  ({ project: next, journal } = applyHistory(next, journal, 'undo', schema));
  assert.deepEqual(historyProjectContent(next), historyProjectContent(before));
  ({ project: next, journal } = applyHistory(next, journal, 'redo', schema));
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(next.chapters[0].content), selection: TextSelection.create(schema.nodeFromJSON(next.chapters[0].content), 9) });
  const transaction = state.tr.insertText('X');
  candidate = { ...next, chapters: next.chapters.map(chapter => chapter.id === 'chapter-a' ? { ...chapter, content: transaction.doc.toJSON() } : chapter) };
  journal = recordTransaction(journal, { beforeProject: next, afterProject: candidate, chapterId: 'chapter-a', transaction }); next = candidate;
  candidate = updateComment(next, 'comment-a', { resolved: true });
  journal = recordProjectChange(journal, next, candidate, { label: 'Resolve comment' }); next = candidate;
  candidate = deleteComment(next, 'comment-a');
  journal = recordProjectChange(journal, next, candidate, { label: 'Delete comment' }); next = candidate;
  journal = createHistory(structuredClone(next), { events: structuredClone(journal.events) });
  ({ project: next, journal } = applyHistory(next, journal, 'undo', schema));
  assert.equal(next.comments[0].resolved, true); assert.deepEqual(commentRanges(next.chapters[0].content, 'comment-a'), [{ from: 7, to: 12 }]);
  ({ project: next, journal } = applyHistory(next, journal, 'undo', schema));
  assert.equal(next.comments[0].resolved, false);
  ({ project: next, journal } = applyHistory(next, journal, 'undo', schema));
  assert.equal(schema.nodeFromJSON(next.chapters[0].content).textContent, 'Alpha beta gamma');
  assert.deepEqual(commentRanges(next.chapters[0].content, 'comment-a'), [{ from: 7, to: 11 }]);
  ({ project: next, journal } = applyHistory(next, journal, 'undo', schema));
  assert.deepEqual(historyProjectContent(next), historyProjectContent(before));
});

test('embedded snapshots deeply preserve comment bodies, states and anchors', () => {
  let next = anchored();
  next = updateComment(next, 'comment-a', { resolved: true, text: 'Private resolved note.' });
  const saved = snapshot(next, 'Before a comment revision');
  assert.deepEqual(saved.comments, next.comments);
  assert.notEqual(saved.comments, next.comments);
  assert.notEqual(saved.comments[0], next.comments[0]);
  assert.deepEqual(commentRanges(saved.chapters[0].content, 'comment-a'), [{ from: 7, to: 11 }]);
  saved.comments[0].text = 'Changed snapshot only.';
  saved.chapters[0].content.content[0].content[1].marks[0].attrs.id = 'snapshot-only';
  assert.equal(next.comments[0].text, 'Private resolved note.');
  assert.deepEqual(commentRanges(next.chapters[0].content, 'comment-a'), [{ from: 7, to: 11 }]);
  const fresh = snapshot(next, 'Native saved revision');
  assert.equal(validateProject({ ...next, snapshots: [fresh] }).snapshots[0].comments[0].resolved, true);
});

test('comment addition restores the saved selection in a project batch through undo and redo', () => {
  const original = project(), selected = { type: 'text', anchor: 7, head: 11 };
  const next = addComment(original, { chapterId: 'chapter-a', from: 7, to: 11, text: 'Selected detail.', id: 'selection-comment' }).project;
  let journal = createHistory(original);
  journal = recordProjectChange(journal, original, next, { label: 'Add comment', chapterId: 'chapter-a', selectionBefore: selected, selectionAfter: selected });
  assert.equal(journal.entries.length, 1);
  const undone = applyHistory(next, journal, 'undo', schema);
  assert.equal(undone.chapterId, 'chapter-a'); assert.deepEqual(undone.selection, selected);
  assert.deepEqual(undone.project.comments || [], []); assert.deepEqual(commentRanges(undone.project.chapters[0].content, 'selection-comment'), []);
  const redone = applyHistory(undone.project, undone.journal, 'redo', schema);
  assert.deepEqual(redone.selection, selected); assert.equal(redone.project.comments[0].text, 'Selected detail.');
  assert.deepEqual(commentRanges(redone.project.chapters[0].content, 'selection-comment'), [{ from: 7, to: 11 }]);
});

test('a structural move journals comment relocation and selection as one durable batch', () => {
  const original = anchored(), selected = { type: 'text', anchor: 7, head: 11 }, afterCaret = { type: 'text', anchor: 1, head: 1 };
  const moved = reconcileCommentChapters({ ...original, chapters: [{ ...original.chapters[0], content: content('Alpha gamma') }, { ...original.chapters[1], content: original.chapters[0].content }] });
  let journal = createHistory(original);
  journal = recordProjectChange(journal, original, moved, { label: 'Move commented passage', chapterId: 'chapter-a', selectionBefore: selected, selectionAfter: afterCaret });
  const savedProject = JSON.parse(JSON.stringify(moved)), savedEvents = JSON.parse(JSON.stringify(journal.events));
  journal = createHistory(savedProject, { events: savedEvents });
  const undone = applyHistory(savedProject, journal, 'undo', schema);
  assert.equal(undone.project.comments[0].chapterId, 'chapter-a'); assert.equal(projectCommentRows(undone.project)[0].chapter.id, 'chapter-a');
  assert.deepEqual(undone.selection, selected); assert.equal(undone.chapterId, 'chapter-a');
  const redone = applyHistory(undone.project, undone.journal, 'redo', schema);
  assert.equal(redone.project.comments[0].chapterId, 'chapter-b'); assert.equal(projectCommentRows(redone.project)[0].chapter.id, 'chapter-b');
  assert.equal(redone.project.comments[0].text, 'Check this detail.'); assert.deepEqual(redone.selection, afterCaret);
  assert.equal(redone.journal.cursor, 1, 'The body move and metadata relocation remain one undo step.');
  const badSelectionJournal = createHistory(original);
  const recorded = recordProjectChange(badSelectionJournal, original, moved, { label: 'Move with obsolete cursor', chapterId: 'chapter-a', selectionBefore: { type: 'text', anchor: 9999, head: 9999 } });
  const safelyUndone = applyHistory(moved, recorded, 'undo', schema);
  assert.equal(safelyUndone.selection, null, 'A stale selection must not prevent restoring the manuscript and comments.');
  assert.equal(safelyUndone.project.comments[0].chapterId, 'chapter-a');
});

test('native files and recovery preserve comment metadata and snapshot anchors after a restart', async t => {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-comments-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-comments-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const next = anchored();
  next.snapshots = [{ id: 'snapshot-a', name: 'With comment', title: next.title, createdAt: new Date().toISOString(), chapters: structuredClone(next.chapters), comments: structuredClone(next.comments), references: [] }];
  const file = path.join(directory, 'Comments.wraiter'), store = new DocumentStore(directory);
  await store.persist(next, file);
  const restored = new DocumentStore(directory), boot = await restored.boot();
  assert.deepEqual(boot.project.comments, next.comments);
  assert.deepEqual(commentRanges(boot.project.chapters[0].content, 'comment-a'), [{ from: 7, to: 11 }]);
  assert.deepEqual((await restored.open(file)).project.snapshots[0].comments, next.comments);
});

test('native comment validation bounds metadata and rejects invalid anchors before saving', () => {
  const mutations = [
    p => { p.comments = null; }, p => { p.comments = Array(5001).fill(p.comments[0]); },
    p => { p.comments.push(structuredClone(p.comments[0])); }, p => { p.comments[0].id = 123; },
    p => { p.comments[0].id = '<script>'; }, p => { p.comments[0].text = 'x'.repeat(20001); },
    p => { p.comments[0].text = '  '; }, p => { p.comments[0].quote = 'x'.repeat(2001); },
    p => { p.comments[0].chapterId = ''; }, p => { p.comments[0].resolved = 'yes'; },
    p => { p.comments[0].createdAt = 'not a date'; }, p => { p.comments[0].updatedAt = null; },
    p => { p.chapters[0].content.content[0].content[1].marks[0].attrs.id = 42; },
    p => { p.chapters[0].content.content[0].content[1].marks[0].attrs.text = 'Private text inside a mark'; }
  ];
  for (const mutate of mutations) {
    const next = anchored(); mutate(next);
    assert.throws(() => validateProject(next), /Invalid|duplicated/);
  }
  const next = anchored(); next.snapshots = [{ id: 'snapshot-a', name: 'Malformed', title: next.title, createdAt: new Date().toISOString(), chapters: next.chapters, references: [], comments: [{ ...next.comments[0], resolved: null }] }];
  assert.throws(() => validateProject(next), /comment state/);
});

test('private anchor stripping removes only annotation marks and comment anchors resist format clearing', () => {
  let next = anchored();
  const node = schema.nodeFromJSON(next.chapters[0].content);
  const state = EditorState.create({ schema, doc: node });
  const formatted = state.tr.addMark(1, 17, schema.marks.bold.create()).addMark(7, 11, schema.marks.highlight.create({ color: '#fff29b' })).doc.toJSON();
  const stripped = stripCommentAnchors(formatted);
  assert.equal(schema.nodeFromJSON(stripped).textContent, node.textContent);
  assert.equal(collectCommentRanges(stripped, schema).size, 0);
  assert.equal(schema.nodeFromJSON(stripped).nodeAt(7).marks.some(mark => mark.type.name === 'bold'), true);
  assert.equal(schema.nodeFromJSON(stripped).nodeAt(7).marks.some(mark => mark.type.name === 'highlight'), true);
  assert.equal(CommentAnchor.config.clearable, false);
  assert.deepEqual(CommentAnchor.config.parseHTML(), [], 'Rich-text paste must not duplicate native private anchors.');
  assert.throws(() => addComment(next, { chapterId: 'chapter-a', from: 7, to: 7, text: 'No passage.' }), /Select/);
  assert.throws(() => addComment(next, { chapterId: 'chapter-a', from: 1, to: 9999, text: 'Invalid range.' }), /Select/);
  assert.throws(() => addComment(next, { chapterId: 'chapter-a', from: 1, to: 5, text: '', id: 'new-comment' }), /Write a comment/);
  assert.throws(() => addComment(next, { chapterId: 'chapter-a', from: 1, to: 5, text: 'Duplicate.', id: 'comment-a' }), /already used/);
});
