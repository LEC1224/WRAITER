import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { trackedRanges, resolveTrackedChange, acceptTrackedJSON } from '../electron/tracked-changes.mjs';
import { suggestText, trackedDeletionRange } from '../src/tracked-editor.js';
import core from '../electron/core.cjs';
import files from '../electron/document-files.cjs';
import { newProject } from '../src/document.js';
import { projectChanges, reviewProjectChanges } from '../src/review-changes.js';

const initial = () => EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old words', marks: [{ type: 'bold' }] }] }] }) });
test('tracked replacement retains original text, author marks, and resolves as one review decision', () => {
  let state = initial();
  state = state.apply(suggestText(state, 1, 4, 'new'));
  assert.equal(state.doc.textContent, 'oldnew words');
  const changes = trackedRanges(state.doc);
  assert.equal(changes.length, 1); assert.deepEqual(changes[0].ranges.map(item => item.kind), ['delete', 'insert']);
  assert.equal(acceptTrackedJSON(state.doc.toJSON()).content[0].content[0].text, 'new');
  state = state.apply(resolveTrackedChange(state, changes[0].id, true));
  assert.equal(state.doc.textContent, 'new words');
  assert.equal(trackedRanges(state.doc).length, 0);
  assert.ok(state.doc.firstChild.firstChild.marks.some(mark => mark.type.name === 'bold'));
});
test('rejecting a deletion restores text and removing an insertion does not invent a deletion', () => {
  let state = initial();
  state = state.apply(suggestText(state, 1, 4, ''));
  state = state.apply(resolveTrackedChange(state, trackedRanges(state.doc)[0].id, false));
  assert.equal(state.doc.textContent, 'old words');
  state = state.apply(suggestText(state, 1, 1, 'x'));
  state = state.apply(suggestText(state, 1, 2, ''));
  assert.equal(state.doc.textContent, 'old words');
  assert.equal(trackedRanges(state.doc).length, 0);
});

test('repeated Backspace moves over live characters and coalesces one removal', () => {
  let state = initial();
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
  for (let i = 0; i < 3; i++) {
    const range = trackedDeletionRange(state, true);
    state = state.apply(suggestText(state, range.from, range.to, ''));
  }
  assert.equal(state.selection.from, 1);
  assert.equal(trackedRanges(state.doc).length, 1);
  assert.equal(trackedRanges(state.doc)[0].ranges.map(range => range.text).join(''), 'old');
  const id = trackedRanges(state.doc)[0].id;
  state = state.apply(resolveTrackedChange(state, id, false)); assert.equal(state.doc.textContent, 'old words');
});

test('Delete skips pending removals and edits inside an addition keep their review identity', () => {
  let state = initial();
  for (let i = 0; i < 3; i++) {
    const range = trackedDeletionRange(state, false);
    state = state.apply(suggestText(state, range.from, range.to, ''));
  }
  assert.equal(trackedRanges(state.doc).length, 1);
  assert.equal(trackedRanges(state.doc)[0].ranges.map(range => range.text).join(''), 'old');
  state = state.apply(suggestText(state, 4, 4, 'hello'));
  const id = trackedRanges(state.doc).find(change => change.ranges.some(range => range.kind === 'insert')).id;
  state = state.apply(suggestText(state, 5, 8, 'i'));
  assert.equal(trackedRanges(state.doc).find(change => change.id === id).ranges[0].text, 'hio');
});

test('replacing a selection containing pending additions keeps original removals recoverable', () => {
  let state = initial();
  state = state.apply(suggestText(state, 1, 4, 'new'));
  state = state.apply(suggestText(state, 1, 8, 'other '));
  const accepted = acceptTrackedJSON(state.doc.toJSON());
  assert.equal(schema.nodeFromJSON(accepted).textContent, 'other words');
  for (const change of trackedRanges(state.doc)) state = state.apply(resolveTrackedChange(state, change.id, false));
  assert.equal(state.doc.textContent, 'old words');
});

test('review applies a whole-document batch and maps the active caret', () => {
  const project = newProject();
  let state = initial(); state = state.apply(suggestText(state, 1, 4, 'new'));
  project.chapters[0].content = state.doc.toJSON();
  project.chapters.push({ id: 'other', title: 'Other', content: state.doc.toJSON() });
  const changes = projectChanges(project, schema); assert.equal(changes.length, 2); assert.equal(changes[0].kind, 'Replacement');
  const result = reviewProjectChanges(project, changes, false, schema, project.chapters[0].id, { type: 'text', anchor: 7, head: 7 });
  assert.deepEqual(result.project.chapters.map(chapter => schema.nodeFromJSON(chapter.content).textContent), ['old words', 'old words']);
  assert.equal(result.selection.anchor, 4); assert.equal(projectChanges(result.project, schema).length, 0);
});
test('tracked marks validate and changes crossing paragraph boundaries are refused', () => {
  let state = initial(); state = state.apply(suggestText(state, 1, 1, 'x'));
  const project = newProject(); project.chapters[0].content = state.doc.toJSON();
  assert.doesNotThrow(() => core.validateProject(project));
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] });
  assert.equal(suggestText(EditorState.create({ schema, doc }), 1, 4, 'x'), null);
});
test('review wording preserves unchanged gaps and excludes neighbouring deleted versions', () => {
  const mark = (id, kind) => schema.marks.trackedChange.create({ id, kind, author: 'Writer' });
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [
    schema.text('old', [mark('nearby', 'delete')]), schema.text('New', [mark('nearby', 'insert')]), schema.text(' '),
    schema.text('bad', [mark('target', 'delete')]), schema.text('good', [mark('target', 'insert')]), schema.text(' and '),
    schema.text('worse', [mark('target', 'delete')]), schema.text('better', [mark('target', 'insert')]), schema.text(' words.')
  ]));
  const project = newProject(); project.chapters[0].content = doc.toJSON();
  const change = projectChanges(project, schema).find(change => change.id === 'target');
  assert.equal(change.before, 'New ');
  assert.equal(change.original, 'bad and worse'); assert.equal(change.proposed, 'good and better'); assert.equal(change.after, ' words.');
});
test('native dirty detection includes shared Office comments but ignores private notes', () => {
  const project = newProject(), chapter = project.chapters[0], now = new Date().toISOString();
  project.comments = [{ id: 'shared', chapterId: chapter.id, text: 'shared note', author: 'Reviewer', origin: 'docx', quote: 'x', createdAt: now, updatedAt: now, resolved: false }];
  chapter.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'commentAnchor', attrs: { id: 'shared' } }] }] }] };
  const original = files.contentHash(project), edited = structuredClone(project); edited.comments[0].text = 'changed shared note';
  assert.notEqual(files.contentHash(edited), original);
  const privateEdit = structuredClone(project); privateEdit.comments.push({ id: 'private', chapterId: chapter.id, text: 'local note', quote: 'x', createdAt: now, updatedAt: now, resolved: false });
  privateEdit.chapters[0].content.content[0].content[0].marks.push({ type: 'commentAnchor', attrs: { id: 'private' } });
  assert.equal(files.contentHash(privateEdit), original);
});
