import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { collectCommentRanges } from '../electron/comments.mjs';
import { findTextMatches, findManuscriptMatches, groupSearchResults, replaceManuscriptMatches, SearchReplaceError } from '../src/search.js';
import { createHistory, recordProjectChange, applyHistory } from '../src/history.js';
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} }, marks: { bold: {} } });
test('search finds a phrase across bold/plain text nodes', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('The '), schema.text('quiet', [schema.marks.bold.create()]), schema.text(' hours.')])]);
  assert.deepEqual(findTextMatches(doc, 'quiet hours'), [{ from: 5, to: 16 }]);
});
test('search treats punctuation as literal and reports original Unicode positions', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('ÅÄÖ [a.*] İ next NEXT')])]);
  assert.deepEqual(findTextMatches(doc, '[a.*]'), [{ from: 5, to: 10 }]);
  assert.equal(findTextMatches(doc, 'next').length, 2);
  for (const match of findTextMatches(doc, 'next')) assert.equal(doc.textBetween(match.from, match.to).toLowerCase(), 'next');
});

const manuscriptSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', attrs: { textAlign: { default: null }, firstLineIndent: { default: null } } },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    hardBreak: { inline: true, group: 'inline' },
    image: { inline: true, group: 'inline', attrs: { src: {} } },
    text: { group: 'inline' }
  },
  marks: {
    bold: {}, italic: {}, textStyle: { attrs: { color: { default: null } } },
    commentAnchor: { attrs: { id: {} }, inclusive: false, excludes: '' }
  }
});
function doc(...children) { return manuscriptSchema.node('doc', null, children); }
function paragraph(...children) { return manuscriptSchema.node('paragraph', { textAlign: 'center', firstLineIndent: 18 }, children); }
function text(value, marks = []) { return manuscriptSchema.text(value, marks); }
function manuscript() {
  return { id: 'search-project', title: 'Synthetic manuscript', documentStyle: { fontFamily: 'Cambria' },
    comments: [{ id: 'one', text: 'Keep this note.' }, { id: 'two', text: 'Overlapping note.' }],
    chapters: [
      { id: 'first', title: 'First chapter', notes: 'Private chapter notes', content: doc(paragraph(text('A quiet', [manuscriptSchema.marks.bold.create()]), text(' hour, then a quiet hour.'))).toJSON() },
      { id: 'second', title: 'Second chapter', special: { retained: true }, content: doc(manuscriptSchema.node('heading', { level: 2 }, text('quiet hour')), paragraph(text('QUIET HOUR is quiet hourly.'))).toJSON() },
      { id: 'third', title: 'Unchanged chapter', content: doc(paragraph(text('No matching words here.'))).toJSON() }
    ]
  };
}

test('whole-word search respects Unicode letters, numbers, marks and apostrophes', () => {
  const content = doc(paragraph(text("Åsa Åsaland ÅSA ΩμέγαΩ Ωμέγα αΩμέγα 猫 大猫 猫2 é élan don't don’t don 🐈猫🐈")));
  assert.equal(findTextMatches(content, 'Åsa', Infinity, { wholeWord: true }).length, 2);
  assert.equal(findTextMatches(content, 'Åsa', Infinity, { wholeWord: true, caseSensitive: true }).length, 1);
  assert.equal(findTextMatches(content, 'Ωμέγα', Infinity, { wholeWord: true }).length, 1);
  assert.equal(findTextMatches(content, '猫', Infinity, { wholeWord: true }).length, 2);
  assert.equal(findTextMatches(content, 'é', Infinity, { wholeWord: true }).length, 1);
  assert.equal(findTextMatches(content, 'don', Infinity, { wholeWord: true }).length, 1);
  assert.equal(findTextMatches(content, "don't", Infinity, { wholeWord: true }).length, 1);
});

test('manuscript results include every chapter in order with real highlighted snippets and scope options', () => {
  const project = manuscript();
  const all = findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema, wholeWord: true });
  assert.equal(all.length, 4);
  assert.deepEqual(groupSearchResults(all).map(group => [group.chapterTitle, group.results.length]), [['First chapter', 2], ['Second chapter', 2]]);
  assert.deepEqual(all.map(result => result.chapterId), ['first', 'first', 'second', 'second']);
  assert.equal(all[0].snippet.before, 'A ');
  assert.equal(all[0].snippet.match, 'quiet hour');
  assert.match(all[0].snippet.after, /then a quiet hour/);
  assert.equal(all[3].text, 'QUIET HOUR');
  assert.equal(findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema, scope: 'chapter', chapterId: 'second', caseSensitive: true, wholeWord: true }).length, 1);
  assert.equal(findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema, maximum: 2 }).length, 2);
  const activeDoc = doc(paragraph(text('An unsaved quiet hour in the active editor.')));
  const active = findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema, scope: 'chapter', chapterId: 'first', activeDoc });
  assert.equal(active.length, 1);
  assert.equal(active[0].snippet.before, 'An unsaved ');
});

test('replacement preserves unaffected marks, chapter fields, paragraph settings and all project metadata', () => {
  const project = manuscript(), before = JSON.stringify(project);
  const results = findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema, caseSensitive: true, wholeWord: true });
  const replaced = replaceManuscriptMatches(project, results, 'bright moment', { schema: manuscriptSchema });
  assert.equal(replaced.count, 3);
  assert.deepEqual(replaced.changedChapterIds, ['first', 'second']);
  assert.equal(JSON.stringify(project), before, 'replacement must not mutate the original project');
  assert.equal(replaced.project.chapters[2], project.chapters[2], 'unmodified chapters retain their object identity');
  assert.equal(replaced.project.comments, project.comments);
  assert.equal(replaced.project.documentStyle, project.documentStyle);
  assert.equal(replaced.project.chapters[0].notes, project.chapters[0].notes);
  const first = manuscriptSchema.nodeFromJSON(replaced.project.chapters[0].content);
  assert.equal(first.textContent, 'A bright moment, then a bright moment.');
  assert.equal(first.firstChild.attrs.textAlign, 'center');
  assert.equal(first.firstChild.attrs.firstLineIndent, 18);
  assert.equal(first.firstChild.firstChild.text, 'A bright moment');
  assert.equal(first.firstChild.firstChild.marks[0].type.name, 'bold');
  const second = manuscriptSchema.nodeFromJSON(replaced.project.chapters[1].content);
  assert.equal(second.firstChild.type.name, 'heading');
  assert.equal(second.firstChild.attrs.level, 2);
  assert.equal(second.lastChild.textContent, 'QUIET HOUR is quiet hourly.');
  assert.ok(replaced.changes.every(change => change.transform.steps.length > 0));
});

test('replace all can be recorded and undone together across multiple chapters', () => {
  const project = manuscript(), results = findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema, wholeWord: true });
  const { project: after } = replaceManuscriptMatches(project, results, 'different evening', { schema: manuscriptSchema });
  const history = recordProjectChange(createHistory(project), project, after, { label: 'Replace all matches' });
  assert.equal(history.entries.length, 1);
  const undo = applyHistory(after, history, 'undo', manuscriptSchema);
  assert.deepEqual(undo.project.chapters, structuredClone(project.chapters));
  assert.deepEqual(undo.project.comments, project.comments);
  const redo = applyHistory(undo.project, undo.journal, 'redo', manuscriptSchema);
  assert.deepEqual(redo.project.chapters, structuredClone(after.chapters));
});

test('a stale or malformed preview fails atomically before any chapter changes', () => {
  const project = manuscript(), results = findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema });
  const before = JSON.stringify(project);
  const stale = results.map((result, index) => index === results.length - 1 ? { ...result, text: 'old text' } : result);
  assert.throws(() => replaceManuscriptMatches(project, stale, 'replacement', { schema: manuscriptSchema }), SearchReplaceError);
  assert.equal(JSON.stringify(project), before);
  assert.throws(() => replaceManuscriptMatches(project, [results[0], results[0]], 'replacement', { schema: manuscriptSchema }), /overlapping/);
  assert.throws(() => replaceManuscriptMatches(project, [{ ...results[0], chapterId: 'deleted' }], 'replacement', { schema: manuscriptSchema }), SearchReplaceError);
  assert.throws(() => replaceManuscriptMatches(project, [{ ...results[0], from: -1 }], 'replacement', { schema: manuscriptSchema }), SearchReplaceError);
});

test('replacement retains overlapping comment anchors and deletion keeps comment metadata', () => {
  const a = manuscriptSchema.marks.commentAnchor.create({ id: 'one' }), b = manuscriptSchema.marks.commentAnchor.create({ id: 'two' });
  const project = { ...manuscript(), chapters: [{ id: 'comments', title: 'Notes', content: doc(paragraph(text('Start '), text('quiet', [a]), text(' hour', [b]), text(' end'))).toJSON() }] };
  const results = findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema });
  const replaced = replaceManuscriptMatches(project, results, 'bright evening', { schema: manuscriptSchema });
  const content = manuscriptSchema.nodeFromJSON(replaced.project.chapters[0].content);
  assert.equal(content.textContent, 'Start bright evening end');
  assert.deepEqual(content.firstChild.child(1).marks.filter(mark => mark.type.name === 'commentAnchor').map(mark => mark.attrs.id).sort(), ['one', 'two']);
  const removed = replaceManuscriptMatches(project, results, '', { schema: manuscriptSchema });
  assert.equal(manuscriptSchema.nodeFromJSON(removed.project.chapters[0].content).textContent, 'Start  end');
  assert.deepEqual(removed.project.comments, project.comments);
});

test('search crosses hard breaks within a paragraph, skips images and never crosses chapter or paragraph boundaries', () => {
  const content = doc(paragraph(text('first'), manuscriptSchema.node('hardBreak'), text('second')), paragraph(text('third'), manuscriptSchema.node('image', { src: 'sample.png' }), text('fourth')), paragraph(text('fifth')));
  assert.equal(findTextMatches(content, 'first\nsecond').length, 1);
  assert.equal(findTextMatches(content, 'third\uFFFCfourth').length, 0);
  assert.equal(findTextMatches(content, 'secondthird').length, 0);
  assert.equal(findTextMatches(content, 'fourthfifth').length, 0);
});

test('whole manuscript searches are complete beyond the legacy chapter limit and cache unchanged chapter trees', () => {
  const chapters = [
    { id: 'many', title: 'Many results', content: doc(...Array.from({ length: 2401 }, () => paragraph(text('find this passage')))).toJSON() },
    { id: 'active', title: 'Current chapter', content: doc(paragraph(text('find another passage'))).toJSON() }
  ];
  const project = { ...manuscript(), chapters };
  const originalParse = manuscriptSchema.nodeFromJSON;
  let parsed = 0;
  manuscriptSchema.nodeFromJSON = json => { if (json.type === 'doc') parsed++; return originalParse(json); };
  try {
    const first = findManuscriptMatches(project, 'find', { schema: manuscriptSchema, chapterId: 'active' });
    assert.equal(first.length, 2402);
    assert.equal(parsed, 2);
    const activeDoc = doc(paragraph(text('find an edited passage')));
    const edited = { ...project, chapters: project.chapters.map(chapter => chapter.id === 'active' ? { ...chapter, content: activeDoc.toJSON() } : chapter) };
    const second = findManuscriptMatches(edited, 'find', { schema: manuscriptSchema, chapterId: 'active', activeDoc });
    assert.equal(second.length, 2402);
    assert.equal(parsed, 2, 'unchanged chapters are not parsed again after active edits');
    assert.equal(second.at(-1).snippet.after, ' an edited passage');
    const none = findManuscriptMatches(edited, 'missing', { schema: manuscriptSchema, chapterId: 'active', activeDoc });
    assert.equal(none.length, 0, 'query changes invalidate the match cache');
  } finally { manuscriptSchema.nodeFromJSON = originalParse; }
});

test('replacing an identical passage leaves its mixed formatting and object identity intact', () => {
  const project = manuscript(), matches = findManuscriptMatches(project, 'quiet hour', { schema: manuscriptSchema, caseSensitive: true, wholeWord: true });
  const replaced = replaceManuscriptMatches(project, matches, 'quiet hour', { schema: manuscriptSchema });
  assert.equal(replaced.project, project);
  assert.equal(replaced.changes.length, 0);
  assert.equal(replaced.count, matches.length);
});

test('a persisted replace-all batch restores comment anchors and the mapped passage selection on undo and redo', () => {
  const source = manuscript();
  const a = manuscriptSchema.marks.commentAnchor.create({ id: 'one' }), b = manuscriptSchema.marks.commentAnchor.create({ id: 'two' });
  source.chapters[0].content = doc(paragraph(text('A '), text('quiet', [manuscriptSchema.marks.bold.create(), a]), text(' hour', [a, b]), text(', then a quiet hour.'))).toJSON();
  const originalDoc = manuscriptSchema.nodeFromJSON(source.chapters[0].content), originalAnchors = collectCommentRanges(originalDoc, manuscriptSchema);
  const cursor = originalDoc.textContent.indexOf('then') + 1;
  const selectionBefore = TextSelection.create(originalDoc, cursor, cursor + 4);
  assert.equal(originalDoc.textBetween(selectionBefore.from, selectionBefore.to), 'then');
  const results = findManuscriptMatches(source, 'quiet hour', { schema: manuscriptSchema, wholeWord: true });
  const replaced = replaceManuscriptMatches(source, results, 'bright evening', { schema: manuscriptSchema });
  const changed = replaced.changes.find(change => change.chapterId === 'first');
  const selectionAfter = selectionBefore.map(changed.doc, changed.transform.mapping);
  assert.equal(changed.doc.textBetween(selectionAfter.from, selectionAfter.to), 'then');
  assert.equal(selectionAfter.from, selectionBefore.from + 4, 'The selection moves with the longer replacement before it');
  const journal = recordProjectChange(createHistory(source), source, replaced.project, {
    label: 'Replace all matches', chapterId: 'first', selectionBefore: selectionBefore.toJSON(), selectionAfter: selectionAfter.toJSON()
  });
  assert.equal(journal.entries.length, 1);
  const savedProject = JSON.parse(JSON.stringify(replaced.project));
  const restored = createHistory(savedProject, JSON.parse(JSON.stringify({ events: journal.events })));
  const undo = applyHistory(savedProject, restored, 'undo', manuscriptSchema);
  assert.equal(undo.chapterId, 'first');
  assert.deepEqual(undo.selection, selectionBefore.toJSON());
  assert.deepEqual(undo.project.chapters, JSON.parse(JSON.stringify(source.chapters)));
  assert.deepEqual(undo.project.comments, source.comments);
  assert.deepEqual(collectCommentRanges(undo.project.chapters[0].content, manuscriptSchema), originalAnchors);
  // Reload once more between undo and redo, as a real closed/reopened project does.
  const reopened = JSON.parse(JSON.stringify(undo.project));
  const reopenedJournal = createHistory(reopened, JSON.parse(JSON.stringify({ events: undo.journal.events })));
  const redo = applyHistory(reopened, reopenedJournal, 'redo', manuscriptSchema);
  assert.equal(redo.chapterId, 'first');
  assert.deepEqual(redo.selection, selectionAfter.toJSON());
  assert.deepEqual(redo.project.chapters, JSON.parse(JSON.stringify(replaced.project.chapters)));
  assert.deepEqual(redo.project.comments, source.comments);
  assert.deepEqual(collectCommentRanges(redo.project.chapters[0].content, manuscriptSchema), collectCommentRanges(changed.doc, manuscriptSchema));
});
