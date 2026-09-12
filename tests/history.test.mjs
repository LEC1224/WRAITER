import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { createHistory, recordTransaction, recordProjectChange, applyHistory, historyStatus, timelineEntries, normalizeHistoryProject, recoverHistoryProject, prepareHistoryLoad, HistoryMismatchError, HISTORY_SELECTION_META, HISTORY_REPLAY_META } from '../src/history.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', attrs: { textAlign: { default: null } } },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    text: { group: 'inline' },
    image: { inline: true, group: 'inline', attrs: { src: {} } }
  }, marks: { bold: {}, italic: {}, link: { attrs: { href: {} } } }
});
const doc = text => schema.node('doc', null, [schema.node('paragraph', null, text ? schema.text(text) : undefined)]).toJSON();
const manuscript = () => ({ id: 'manuscript-one', title: 'The manuscript', chapters: [{ id: 'chapter-a', title: 'Opening', content: doc('Alpha') }, { id: 'chapter-b', title: 'Ending', content: doc('Omega') }], notes: '', documentStyle: { fontFamily: 'Cambria', fontSize: 12 }, updatedAt: 'old', snapshots: [] });
const stateFor = (project, chapterId = 'chapter-a') => EditorState.create({ schema, doc: schema.nodeFromJSON(project.chapters.find(item => item.id === chapterId).content) });
function edit(project, journal, makeTransaction, chapterId = 'chapter-a') {
  const state = stateFor(project, chapterId), transaction = makeTransaction(state).setMeta(HISTORY_SELECTION_META, state.selection.toJSON());
  const after = { ...project, chapters: project.chapters.map(chapter => chapter.id === chapterId ? { ...chapter, content: transaction.doc.toJSON() } : chapter) };
  return { project: after, journal: recordTransaction(journal, { beforeProject: project, afterProject: after, chapterId, transaction }) };
}
const contents = project => project.chapters.map(chapter => schema.nodeFromJSON(chapter.content).textContent);

test('undo and redo survive serialized sessions and cross chapter boundaries', () => {
  const original = manuscript(); let project = original, journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('!', 6)));
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('?', 6), 'chapter-b'));
  journal = createHistory(structuredClone(project), JSON.parse(JSON.stringify({ events: journal.events })));
  assert.deepEqual(contents(project), ['Alpha!', 'Omega?']);
  let result = applyHistory(project, journal, 'undo', schema); ({ project, journal } = result);
  assert.equal(result.chapterId, 'chapter-b'); assert.deepEqual(contents(project), ['Alpha!', 'Omega']);
  ({ project, journal } = applyHistory(project, journal, 'undo', schema));
  assert.deepEqual(contents(project), contents(original)); assert.equal(historyStatus(journal).canUndo, false);
  journal = createHistory(project, { events: JSON.parse(JSON.stringify(journal.events)) });
  ({ project, journal } = applyHistory(project, journal, 'redo', schema));
  ({ project, journal } = applyHistory(project, journal, 'redo', schema));
  assert.deepEqual(contents(project), ['Alpha!', 'Omega?']); assert.equal(historyStatus(journal).canRedo, false);
});

test('a replacement with multiple marked steps is one exact, reversible atomic edit', () => {
  const original = manuscript(), state = stateFor(original);
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 5)));
  const tr = selected.tr.insertText('new', 2, 5).addMark(2, 5, schema.marks.bold.create()).setMeta(HISTORY_SELECTION_META, selected.selection.toJSON()).setMeta('assistAccept', true);
  const project = { ...original, chapters: original.chapters.map(chapter => chapter.id === 'chapter-a' ? { ...chapter, content: tr.doc.toJSON() } : chapter) };
  const journal = recordTransaction(createHistory(original), { beforeProject: original, afterProject: project, chapterId: 'chapter-a', transaction: tr });
  assert.equal(journal.entries.length, 1); assert.equal(journal.entries[0].forward.length, 2);
  assert.equal(historyStatus(journal).undoLabel, 'Accept AI suggestion');
  const undone = applyHistory(project, journal, 'undo', schema);
  assert.deepEqual(undone.project.chapters, original.chapters);
  assert.deepEqual(undone.selection, { type: 'text', anchor: 2, head: 5 });
  const restored = applyHistory(undone.project, createHistory(undone.project, { events: undone.journal.events }), 'redo', schema);
  assert.deepEqual(restored.project.chapters, project.chapters);
});

test('block splits, images and node formatting retain structure through undo', () => {
  let project = manuscript(), journal = createHistory(project); const original = structuredClone(project);
  ({ project, journal } = edit(project, journal, state => state.tr.split(3).insert(5, schema.node('image', { src: 'data:image/png;base64,AAAA' })).setNodeMarkup(0, schema.nodes.heading, { level: 2 })));
  assert.equal(project.chapters[0].content.content[0].type, 'heading');
  assert.equal(project.chapters[0].content.content.length, 2);
  const edited = structuredClone(project);
  ({ project, journal } = applyHistory(project, journal, 'undo', schema));
  assert.deepEqual(structuredClone(project.chapters), original.chapters);
  ({ project, journal } = applyHistory(project, journal, 'redo', schema));
  assert.deepEqual(structuredClone(project.chapters), edited.chapters);
});

test('new edits invalidate redo without deleting abandoned edits from the audit trail', () => {
  let project = manuscript(), journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('!', 6)));
  const abandonedId = journal.entries[0].id;
  ({ project, journal } = applyHistory(project, journal, 'undo', schema));
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('?', 6)));
  assert.equal(historyStatus(journal).canRedo, false);
  assert.equal(journal.entries.length, 2);
  assert.equal(timelineEntries(journal).find(item => item.id === abandonedId).status, 'branched');
  assert.equal(timelineEntries(journal)[0].status, 'applied');
  assert.equal(journal.events.length, 4);
  journal = createHistory(project, { events: JSON.parse(JSON.stringify(journal.events)) });
  assert.equal(timelineEntries(journal).find(item => item.id === abandonedId).status, 'branched');
  ({ project, journal } = applyHistory(project, journal, 'undo', schema));
  assert.deepEqual(contents(project), ['Alpha', 'Omega']);
});

test('chapter creation, deletion and reordering plus metadata form one reversible project action', () => {
  const before = manuscript();
  const after = { ...before, title: 'Revised title', notes: 'Keep this note', documentStyle: { fontFamily: 'Arial', fontSize: 14 }, chapters: [{ id: 'chapter-c', title: 'New', content: doc('New ending') }, { ...before.chapters[1], title: 'Revised ending' }] };
  const journal = recordProjectChange(createHistory(before), before, after, { label: 'Restructure manuscript', chapterId: 'chapter-c' });
  assert.equal(journal.entries.length, 1);
  const result = applyHistory(after, createHistory(after, { events: journal.events }), 'undo', schema);
  assert.deepEqual(structuredClone(result.project.chapters), structuredClone(before.chapters));
  assert.equal(result.project.title, before.title); assert.equal(result.project.notes, '');
  assert.deepEqual(result.project.documentStyle, before.documentStyle);
  assert.equal(result.chapterId, 'chapter-a');
  const redone = applyHistory(result.project, result.journal, 'redo', schema);
  assert.deepEqual(structuredClone(redone.project.chapters), structuredClone(after.chapters)); assert.equal(redone.chapterId, 'chapter-c');
});

test('chapter reordering stores identifiers, not copies of unaffected manuscript text', () => {
  const before = manuscript(), after = { ...before, chapters: [...before.chapters].reverse() };
  const journal = recordProjectChange(createHistory(before), before, after, { label: 'Reorder chapters' });
  assert.deepEqual(journal.entries[0].patches, [{ scope: 'chapter-order', before: ['chapter-a', 'chapter-b'], after: ['chapter-b', 'chapter-a'] }]);
  assert.deepEqual(structuredClone(applyHistory(after, journal, 'undo', schema).project.chapters), structuredClone(before.chapters));
});

test('project edits on all chapters undo together while preserving later redo after restart', () => {
  const original = manuscript(), changed = { ...original, chapters: original.chapters.map(chapter => ({ ...chapter, content: doc(schema.nodeFromJSON(chapter.content).textContent.toUpperCase()) })) };
  let journal = recordProjectChange(createHistory(original), original, changed, { label: 'AI: uppercase manuscript' });
  const undone = applyHistory(changed, journal, 'undo', schema);
  journal = createHistory(undone.project, { events: undone.journal.events });
  assert.deepEqual(contents(undone.project), ['Alpha', 'Omega']);
  assert.deepEqual(contents(applyHistory(undone.project, journal, 'redo', schema).project), ['ALPHA', 'OMEGA']);
});

test('timestamps, save bindings, embedded snapshots and journal sequence do not create or break undo', () => {
  let project = manuscript(), journal = createHistory(project);
  const ignored = { ...project, updatedAt: 'new time', snapshots: [{ id: 'snapshot' }], historySequence: 77, nativeBinding: { path: 'C:/test.docx' } };
  assert.equal(recordProjectChange(journal, project, ignored), journal);
  ({ project, journal } = edit(ignored, journal, state => state.tr.insertText('!', 6)));
  const undone = applyHistory(project, journal, 'undo', schema);
  assert.deepEqual(undone.project.snapshots, ignored.snapshots); assert.deepEqual(undone.project.nativeBinding, ignored.nativeBinding);
  assert.equal(undone.project.historySequence, journal.sequence + 1);
});

test('stale documents and corrupt events never modify the current manuscript', () => {
  let project = manuscript(), journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('!', 6)));
  const external = { ...project, title: 'Externally changed' }, original = structuredClone(external);
  assert.throws(() => applyHistory(external, journal, 'undo', schema), HistoryMismatchError);
  assert.deepEqual(structuredClone(external), original);
  assert.throws(() => createHistory(external, { events: journal.events }), HistoryMismatchError);
  const missing = JSON.parse(JSON.stringify(journal.events)); missing[1].sequence = 7;
  assert.throws(() => createHistory(project, { events: missing }), HistoryMismatchError);
  const broken = structuredClone(journal); broken.entries[0].inverse[0].from = 99999;
  assert.throws(() => applyHistory(project, broken, 'undo', schema));
  assert.deepEqual(contents(project), ['Alpha!', 'Omega']);
});

test('appended plugin transactions are captured in the same atomic edit', () => {
  const before = manuscript(), state = stateFor(before), transaction = state.tr.insertText('!', 6).setMeta(HISTORY_SELECTION_META, state.selection.toJSON());
  const intermediate = state.apply(transaction), appended = intermediate.tr.insert(intermediate.doc.content.size, schema.node('paragraph'));
  const after = { ...before, chapters: before.chapters.map(chapter => chapter.id === 'chapter-a' ? { ...chapter, content: appended.doc.toJSON() } : chapter) };
  assert.throws(() => recordTransaction(createHistory(before), { beforeProject: before, afterProject: after, chapterId: 'chapter-a', transaction }), HistoryMismatchError);
  const journal = recordTransaction(createHistory(before), { beforeProject: before, afterProject: after, chapterId: 'chapter-a', transaction, appendedTransactions: [appended] });
  assert.equal(journal.entries.length, 1); assert.equal(journal.entries[0].forward.length, 2);
  assert.deepEqual(applyHistory(after, journal, 'undo', schema).project.chapters, before.chapters);
});

test('selection-only and history replay transactions never recursively enter the journal', () => {
  const project = manuscript(), journal = createHistory(project), state = stateFor(project);
  assert.equal(recordTransaction(journal, { transaction: state.tr.setSelection(TextSelection.create(state.doc, 2)), beforeProject: project, afterProject: project, chapterId: 'chapter-a' }), journal);
  assert.equal(recordTransaction(journal, { transaction: state.tr.insertText('!').setMeta(HISTORY_REPLAY_META, true), beforeProject: project, afterProject: project, chapterId: 'chapter-a' }), journal);
});

test('schema normalization makes first-edit history work for uninitialized paragraph attrs', () => {
  const raw = manuscript(); raw.chapters[0].content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] }] };
  const normalized = normalizeHistoryProject(raw, schema), journal = createHistory(normalized);
  const result = edit(normalized, journal, state => state.tr.insertText('!', 6));
  assert.deepEqual(applyHistory(result.project, result.journal, 'undo', schema).project.chapters, normalized.chapters);
});

test('every transaction remains available past the old twenty-snapshot limit', () => {
  let project = manuscript(), journal = createHistory(project);
  for (let i = 0; i < 75; i++) ({ project, journal } = edit(project, journal, state => state.tr.insertText('x', 1)));
  journal = createHistory(project, { events: JSON.parse(JSON.stringify(journal.events)) });
  assert.equal(historyStatus(journal).totalEdits, 75);
  for (let i = 0; i < 75; i++) ({ project, journal } = applyHistory(project, journal, 'undo', schema));
  assert.deepEqual(contents(project), ['Alpha', 'Omega']);
  assert.equal(journal.events.length, 151);
  assert.equal(timelineEntries(journal).filter(item => item.status === 'undone').length, 75);
});

test('a crash between journal fsync and snapshot save recovers all later edit and undo events', () => {
  let project = manuscript(), journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('!', 6)));
  const checkpoint = { ...structuredClone(project), historySequence: journal.sequence };
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('?', 6), 'chapter-b'));
  ({ project, journal } = applyHistory(project, journal, 'undo', schema));
  ({ project, journal } = edit(project, journal, state => state.tr.insertText(' recovered', 7)));
  const renamed = { ...project, title: 'Recovered manuscript' };
  journal = recordProjectChange(journal, project, renamed, { label: 'Rename manuscript' }); project = renamed;
  const recovered = recoverHistoryProject(checkpoint, { events: JSON.parse(JSON.stringify(journal.events)) }, schema);
  assert.deepEqual(structuredClone(recovered.project.chapters), structuredClone(project.chapters));
  assert.equal(recovered.project.title, project.title);
  assert.equal(recovered.recoveredEvents, 4);
  assert.equal(recovered.journal.sequence, journal.sequence);
  assert.deepEqual(recovered.journal.events, JSON.parse(JSON.stringify(journal.events)));
  assert.equal(timelineEntries(recovered.journal).filter(entry => entry.status === 'branched').length, 1);
  assert.equal(applyHistory(recovered.project, recovered.journal, 'undo', schema).project.title, checkpoint.title);
});

test('crash recovery refuses mismatched or missing snapshot markers without changing the document', () => {
  let project = manuscript(), journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('!', 6)));
  assert.throws(() => recoverHistoryProject(project, { events: journal.events, recoverySequence: 1 }, schema), HistoryMismatchError);
  assert.throws(() => recoverHistoryProject(project, { events: journal.events, recoverySequence: 99 }, schema), HistoryMismatchError);
  const intact = recoverHistoryProject(project, { events: journal.events, recoverySequence: journal.sequence }, schema);
  assert.equal(intact.recoveredEvents, 0);
  assert.deepEqual(intact.project.chapters, project.chapters);
});

test('a divergent journal opens the saved document unchanged and proposes a separate undo baseline', () => {
  let project = manuscript(), journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText(' old branch', 6)));
  const saved = { events: structuredClone(journal.events), totalEvents: journal.sequence };
  const current = { ...manuscript(), title: 'External revision', historySequence: journal.sequence };
  const sourceProject = JSON.stringify(current), sourceJournal = JSON.stringify(saved);
  const result = prepareHistoryLoad(current, saved, schema);
  assert.equal(result.requiresJournalReset, true);
  assert.equal(result.recoveredEvents, 0);
  assert.equal(result.project.id, current.id);
  assert.deepEqual(contents(result.project), contents(current));
  assert.equal(result.project.title, 'External revision');
  assert.equal(historyStatus(result.journal).canUndo, false);
  assert.equal(result.journal.sequence, 1);
  assert.equal(result.previousSequence, 2);
  assert.equal(JSON.stringify(current), sourceProject);
  assert.equal(JSON.stringify(saved), sourceJournal);
  assert.match(result.warning, /opened unchanged/);
  const next = edit(result.project, result.journal, state => state.tr.insertText(' safe edit', 6));
  assert.deepEqual(contents(applyHistory(next.project, next.journal, 'undo', schema).project), contents(current));
});

test('unreadable ledger errors leave the document usable and retain the original error explanation', () => {
  const current = { ...manuscript(), historySequence: 37 };
  for (const saved of [{ error: new Error('Unreadable JSON in journal record 9') }, { readError: 'Access to the journal was denied' }, { events: 'invalid data' }]) {
    const result = prepareHistoryLoad(current, saved, schema);
    assert.equal(result.requiresJournalReset, true);
    assert.deepEqual(result.project.chapters, current.chapters);
    assert.equal(result.project.notes, current.notes);
    assert.equal(result.previousSequence, 37);
    assert.ok(result.reason.length > 0);
    assert.equal(historyStatus(result.journal).canUndo, false);
  }
});

test('a missing journal is reported when the document says earlier editing history existed', () => {
  const current = { ...manuscript(), historySequence: 14 };
  const result = prepareHistoryLoad(current, { events: [], totalEvents: 0 }, schema);
  assert.equal(result.requiresJournalReset, true);
  assert.match(result.reason, /missing/);
  assert.equal(result.previousSequence, 14);
  assert.deepEqual(result.project.chapters, current.chapters);
  assert.equal(prepareHistoryLoad(manuscript(), { events: [] }, schema).requiresJournalReset, false);
  assert.equal(prepareHistoryLoad({ ...manuscript(), historySequence: 1 }, { events: [] }, schema).requiresJournalReset, false);
});

test('partly replayable crash tails are never partially applied when a later record diverges', () => {
  const checkpoint = manuscript(); let project = checkpoint, journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText(' pending', 6)));
  ({ project, journal } = edit(project, journal, state => state.tr.insertText(' invalid', 6), 'chapter-b'));
  const broken = structuredClone(journal.events); broken[2].entry.forward[0].from = 99999;
  const original = JSON.stringify(broken);
  const result = prepareHistoryLoad({ ...checkpoint, historySequence: 1 }, { events: broken }, schema);
  assert.equal(result.requiresJournalReset, true);
  assert.equal(result.recoveredEvents, 0);
  assert.deepEqual(contents(result.project), ['Alpha', 'Omega']);
  assert.equal(JSON.stringify(broken), original);
});

test('a valid crash tail still recovers through the safe loading facade', () => {
  const checkpoint = manuscript(); let project = checkpoint, journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText(' recovered', 6)));
  const result = prepareHistoryLoad({ ...checkpoint, historySequence: 1 }, { events: journal.events, totalEvents: journal.sequence }, schema);
  assert.equal(result.requiresJournalReset, false);
  assert.equal(result.recoveredEvents, 1);
  assert.deepEqual(contents(result.project), ['Alpha recovered', 'Omega']);
  assert.equal(result.warning, '');
  assert.equal(historyStatus(result.journal).canUndo, true);
});

test('missing records and unsupported journal versions propose preservation rather than guessed recovery', () => {
  const project = manuscript(), journal = createHistory(project);
  const future = structuredClone(journal.events); future[0].version = 42;
  const result = prepareHistoryLoad(project, { events: future }, schema);
  assert.equal(result.requiresJournalReset, true);
  assert.deepEqual(result.project.chapters, project.chapters);
  const truncated = prepareHistoryLoad(project, { events: journal.events, totalEvents: 9 }, schema);
  assert.equal(truncated.requiresJournalReset, true);
  assert.match(truncated.reason, /all of its saved records/);
  assert.equal(future[0].version, 42);
});

test('malformed loaded entries cannot crash the history panel or expose unsupported undo commands', () => {
  let project = manuscript(), journal = createHistory(project);
  ({ project, journal } = edit(project, journal, state => state.tr.insertText('!', 6)));
  project = { ...project, historySequence: journal.sequence };
  for (const corrupt of [entry => { entry.forward = null; }, entry => { entry.label = { invalid: 'React child' }; }, entry => { entry.timestamp = 'invalid'; }, entry => { entry.inverse[0].stepType = 'unknown-plugin-step'; }]) {
    const events = structuredClone(journal.events); corrupt(events[1].entry);
    const result = prepareHistoryLoad(project, { events }, schema);
    assert.equal(result.requiresJournalReset, true);
    assert.deepEqual(result.project.chapters, project.chapters);
    assert.equal(result.journal.entries.length, 0);
  }
});
