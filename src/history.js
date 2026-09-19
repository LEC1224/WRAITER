import { Step } from '@tiptap/pm/transform';
import { Selection } from '@tiptap/pm/state';

// The journal is independent of an editor instance. Every edit and cursor move is
// an immutable event, so closing a document or changing chapters loses no undo.
const IGNORED = new Set(['updatedAt', 'historySequence', 'snapshots', 'chats', 'activeChatId', 'binding', 'fileBinding', 'nativeBinding']);
export const HISTORY_REPLAY_META = 'wraiterHistoryReplay';
export const HISTORY_SELECTION_META = 'wraiterHistorySelectionBefore';
const clone = value => value === undefined ? undefined : structuredClone(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const id = () => globalThis.crypto.randomUUID();
const valueFingerprints = new WeakMap(), projectFingerprints = new WeakMap();

export class HistoryMismatchError extends Error {
  constructor(message = 'This editing history no longer matches the document. The saved history has been preserved.') {
    super(message); this.name = 'HistoryMismatchError';
  }
}

function stable(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  // A new optional schema attribute must not invalidate journals made before
  // it existed. An absent page break and the schema's null default are equal.
  return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined && !(key === 'pageBreakBefore' && value[key] == null)).map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}

// Two independent 32-bit hashes plus serialized length catch accidental stale
// state without requiring an asynchronous crypto call in each editor transaction.
export function historyFingerprint(value) {
  const text = stable(value); let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b); b ^= b >>> 13;
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export function historyProjectContent(project) {
  return Object.fromEntries(Object.entries(project).filter(([key]) => !IGNORED.has(key)));
}
export function normalizeHistoryProject(project, schema) {
  return { ...project, chapters: project.chapters.map(chapter => ({ ...chapter, content: schema.nodeFromJSON(chapter.content).toJSON() })) };
}
function cachedFingerprint(value) {
  if (!value || typeof value !== 'object') return historyFingerprint(value);
  if (!valueFingerprints.has(value)) valueFingerprints.set(value, historyFingerprint(value));
  return valueFingerprints.get(value);
}
// Projects and chapter content are immutable React values. Hashing their fields
// independently avoids rescanning every untouched chapter on each keystroke.
function projectFingerprint(project) {
  if (!projectFingerprints.has(project)) {
    const fields = Object.keys(project).filter(key => !IGNORED.has(key) && project[key] !== undefined).sort().map(key => [key,
      key === 'chapters' ? project.chapters.map(chapter => Object.keys(chapter).filter(name => chapter[name] !== undefined).sort().map(name => [name, cachedFingerprint(chapter[name])])) : cachedFingerprint(project[key])
    ]);
    projectFingerprints.set(project, historyFingerprint(fields));
  }
  return projectFingerprints.get(project);
}

function validateEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.label !== 'string' || typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp)) || typeof entry.beforeFingerprint !== 'string' || typeof entry.afterFingerprint !== 'string' || entry.chapterTitle != null && typeof entry.chapterTitle !== 'string' || entry.summary != null && typeof entry.summary !== 'string') throw new HistoryMismatchError('An editing journal entry is unreadable.');
  if (entry.kind === 'steps') {
    if (typeof entry.chapterId !== 'string' || !entry.chapterId || !Array.isArray(entry.forward) || !entry.forward.length || !Array.isArray(entry.inverse) || entry.inverse.length !== entry.forward.length || [...entry.forward, ...entry.inverse].some(step => !step || typeof step.stepType !== 'string') || typeof entry.beforeDocFingerprint !== 'string' || typeof entry.afterDocFingerprint !== 'string') throw new HistoryMismatchError('An editing journal entry has invalid document operations.');
  } else if (entry.kind === 'project') {
    if (!Array.isArray(entry.patches) || !entry.patches.length) throw new HistoryMismatchError('An editing journal entry has invalid manuscript changes.');
    for (const patch of entry.patches) {
      if (!patch || !['project', 'chapter', 'chapter-property', 'chapter-order'].includes(patch.scope)) throw new HistoryMismatchError('An editing journal change is invalid.');
      if (patch.scope === 'chapter-order') {
        if (![patch.before, patch.after].every(order => Array.isArray(order) && order.length && order.every(chapterId => typeof chapterId === 'string' && chapterId) && new Set(order).size === order.length)) throw new HistoryMismatchError('An editing journal chapter order is invalid.');
      } else {
        if (typeof patch.hadBefore !== 'boolean' || typeof patch.hasAfter !== 'boolean' || patch.hadBefore && !own(patch, 'before') || patch.hasAfter && !own(patch, 'after')) throw new HistoryMismatchError('An editing journal change is missing its saved value.');
        if (patch.scope !== 'project' && (typeof patch.chapterId !== 'string' || !patch.chapterId)) throw new HistoryMismatchError('An editing journal change is missing its chapter.');
        if (patch.scope !== 'chapter' && (typeof patch.key !== 'string' || ['__proto__', 'prototype', 'constructor', 'id'].includes(patch.key))) throw new HistoryMismatchError('An editing journal change has an invalid field.');
      }
    }
  } else throw new HistoryMismatchError('An editing journal entry uses an unsupported operation.');
}

function replayEvent(journal, event, loading = false) {
  if (!event || event.version !== 1 || event.sequence !== journal.sequence + 1 || !['edit', 'undo', 'redo'].includes(event.kind)) throw new HistoryMismatchError('The editing journal contains a missing or invalid event.');
  if (event.beforeFingerprint !== journal.headFingerprint) throw new HistoryMismatchError('The editing journal has an inconsistent document sequence.');
  if (event.kind === 'edit') {
    const entry = event.entry;
    validateEntry(entry);
    if (!entry?.id || (loading ? journal._lookup.has(entry.id) : journal.entries.some(item => item.id === entry.id)) || !['steps', 'project'].includes(entry.kind) || entry.beforeFingerprint !== event.beforeFingerprint || entry.afterFingerprint !== event.afterFingerprint) throw new HistoryMismatchError('An editing journal entry is invalid.');
    if (loading) {
      journal.events.push(event); journal.entries.push(entry); journal._lookup.set(entry.id, entry);
      journal.activeIds.length = journal.cursor; journal.activeIds.push(entry.id); journal.cursor++;
      journal.sequence = event.sequence; journal.headFingerprint = event.afterFingerprint;
      return journal;
    }
    const activeIds = [...journal.activeIds.slice(0, journal.cursor), entry.id];
    return { ...journal, events: [...journal.events, event], sequence: event.sequence, entries: [...journal.entries, entry], activeIds, cursor: activeIds.length, headFingerprint: event.afterFingerprint };
  }
  const index = event.kind === 'undo' ? journal.cursor - 1 : journal.cursor;
  const entry = loading ? journal._lookup.get(journal.activeIds[index]) : journal.entries.find(item => item.id === journal.activeIds[index]);
  if (!entry || event.entryId !== entry.id || event.afterFingerprint !== (event.kind === 'undo' ? entry.beforeFingerprint : entry.afterFingerprint)) throw new HistoryMismatchError('An editing journal undo or redo event is invalid.');
  if (loading) {
    journal.events.push(event); journal.sequence = event.sequence; journal.cursor += event.kind === 'undo' ? -1 : 1; journal.headFingerprint = event.afterFingerprint;
    return journal;
  }
  return { ...journal, events: [...journal.events, event], sequence: event.sequence, cursor: journal.cursor + (event.kind === 'undo' ? -1 : 1), headFingerprint: event.afterFingerprint };
}

export function createHistory(project, saved = {}) {
  if (!project?.id || !Array.isArray(project.chapters)) throw new HistoryMismatchError('Editing history needs a valid manuscript.');
  if (saved.events !== undefined && !Array.isArray(saved.events)) throw new HistoryMismatchError('The saved editing journal is invalid.');
  const events = saved.events || [];
  const initial = events[0] || { version: 1, kind: 'init', sequence: 1, projectId: project.id, fingerprint: projectFingerprint(project), timestamp: new Date().toISOString() };
  if (initial.version !== 1 || initial.kind !== 'init' || initial.sequence !== 1 || initial.projectId !== project.id || typeof initial.fingerprint !== 'string') throw new HistoryMismatchError('This editing journal belongs to a different manuscript or version.');
  let journal = { version: 1, projectId: project.id, events: [clone(initial)], sequence: 1, entries: [], activeIds: [], cursor: 0, headFingerprint: initial.fingerprint, _lookup: new Map() };
  for (const event of events.slice(1)) journal = replayEvent(journal, clone(event), true);
  delete journal._lookup;
  if (journal.headFingerprint !== projectFingerprint(project)) throw new HistoryMismatchError();
  return journal;
}

function verifyCurrent(journal, project) {
  if (project.id !== journal.projectId || projectFingerprint(project) !== journal.headFingerprint) throw new HistoryMismatchError();
}
function appendEntry(journal, entry) {
  return replayEvent(journal, { version: 1, kind: 'edit', sequence: journal.sequence + 1, timestamp: entry.timestamp, beforeFingerprint: entry.beforeFingerprint, afterFingerprint: entry.afterFingerprint, entry });
}
function textOf(node) { return node?.text || (node?.content || []).map(textOf).join(node?.type === 'doc' ? '\n' : ''); }
function excerpt(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
function labelFor(steps, transaction) {
  if (transaction.getMeta('historyLabel')) return String(transaction.getMeta('historyLabel')).slice(0, 200);
  if (transaction.getMeta('assistAccept')) return 'Accept AI suggestion';
  if (transaction.getMeta('paste') || transaction.getMeta('uiEvent') === 'paste') return 'Paste';
  if (steps.every(step => step.stepType === 'addMark')) return 'Apply formatting';
  if (steps.every(step => step.stepType === 'removeMark')) return 'Remove formatting';
  if (steps.every(step => step.stepType === 'attr' || step.stepType === 'docAttr')) return 'Change formatting';
  if (steps.length === 1 && steps[0].stepType === 'replace') {
    const step = steps[0], inserted = textOf(step.slice);
    if (step.from === step.to && inserted) return 'Type text';
    if (step.to > step.from && !step.slice?.content?.length) return 'Delete text';
    if (inserted) return 'Replace text';
  }
  return 'Edit document';
}

export function recordTransaction(journal, { chapterId, transaction, beforeProject, afterProject, label, appendedTransactions = [] }) {
  if (!transaction?.docChanged && !appendedTransactions.some(item => item.docChanged)) return journal;
  if (transaction.getMeta(HISTORY_REPLAY_META)) return journal;
  verifyCurrent(journal, beforeProject);
  const before = beforeProject.chapters.find(chapter => chapter.id === chapterId), after = afterProject.chapters.find(chapter => chapter.id === chapterId);
  if (!before || !after || cachedFingerprint(before.content) !== historyFingerprint(transaction.before.toJSON())) throw new HistoryMismatchError('An editor transaction starts from a different chapter revision.');
  const transactions = [transaction, ...appendedTransactions];
  const final = transactions.at(-1);
  if (historyFingerprint(final.doc.toJSON()) !== cachedFingerprint(after.content)) throw new HistoryMismatchError('An editor transaction is missing part of the final chapter change.');
  const expected = { ...beforeProject, chapters: beforeProject.chapters.map(chapter => chapter.id === chapterId ? { ...chapter, content: after.content } : chapter) };
  if (projectFingerprint(expected) !== projectFingerprint(afterProject)) throw new HistoryMismatchError('An editor transaction also changed manuscript metadata.');
  const forward = [], inverse = [];
  let previous = transaction.before;
  for (const tr of transactions) {
    if (!tr.before.eq(previous)) throw new HistoryMismatchError('Appended editor transactions are out of sequence.');
    tr.steps.forEach((step, index) => { forward.push(step.toJSON()); inverse.unshift(step.invert(tr.docs[index]).toJSON()); });
    previous = tr.doc;
  }
  if (!forward.length || projectFingerprint(beforeProject) === projectFingerprint(afterProject)) return journal;
  const entry = {
    id: id(), kind: 'steps', timestamp: new Date().toISOString(), chapterId,
    label: String(label || labelFor(forward, transaction)).slice(0, 200),
    chapterTitle: after.title,
    summary: excerpt(forward.filter(step => step.slice).map(step => textOf(step.slice)).join(' ')) || excerpt(inverse.filter(step => step.slice).map(step => textOf(step.slice)).join(' ')),
    beforeFingerprint: journal.headFingerprint, afterFingerprint: projectFingerprint(afterProject),
    beforeDocFingerprint: cachedFingerprint(before.content), afterDocFingerprint: cachedFingerprint(after.content),
    forward, inverse,
    selectionBefore: clone(transaction.getMeta(HISTORY_SELECTION_META) || null),
    selectionAfter: final.selection.toJSON()
  };
  return appendEntry(journal, entry);
}

function propertyPatches(before, after, scope, chapterId) {
  const patches = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((scope === 'project' && (IGNORED.has(key) || key === 'chapters')) || key === 'id') continue;
    const hadBefore = own(before, key) && before[key] !== undefined, hasAfter = own(after, key) && after[key] !== undefined;
    if (hadBefore === hasAfter && stable(before[key]) === stable(after[key])) continue;
    patches.push({ scope, chapterId, key, hadBefore, hasAfter, ...(hadBefore ? { before: clone(before[key]) } : {}), ...(hasAfter ? { after: clone(after[key]) } : {}) });
  }
  return patches;
}
function projectPatches(before, after) {
  const patches = propertyPatches(before, after, 'project');
  const previous = new Map(before.chapters.map(chapter => [chapter.id, chapter])), next = new Map(after.chapters.map(chapter => [chapter.id, chapter]));
  for (const [chapterId, chapter] of previous) {
    if (!next.has(chapterId)) patches.push({ scope: 'chapter', chapterId, hadBefore: true, hasAfter: false, before: clone(chapter) });
    else patches.push(...propertyPatches(chapter, next.get(chapterId), 'chapter-property', chapterId));
  }
  for (const [chapterId, chapter] of next) if (!previous.has(chapterId)) patches.push({ scope: 'chapter', chapterId, hadBefore: false, hasAfter: true, after: clone(chapter) });
  const beforeOrder = [...previous.keys()], afterOrder = [...next.keys()];
  if (stable(beforeOrder) !== stable(afterOrder)) patches.push({ scope: 'chapter-order', before: beforeOrder, after: afterOrder });
  return patches;
}

export function recordProjectChange(journal, before, after, { label = 'Edit manuscript', chapterId = null } = {}) {
  verifyCurrent(journal, before);
  if (after.id !== before.id || !Array.isArray(after.chapters) || !after.chapters.length || new Set(after.chapters.map(chapter => chapter.id)).size !== after.chapters.length) throw new HistoryMismatchError('A manuscript history entry must retain its identity and valid chapters.');
  const afterFingerprint = projectFingerprint(after);
  if (afterFingerprint === journal.headFingerprint) return journal;
  return appendEntry(journal, {
    id: id(), kind: 'project', timestamp: new Date().toISOString(), label: String(label).slice(0, 200), chapterId,
    chapterTitle: after.chapters.find(chapter => chapter.id === chapterId)?.title,
    beforeFingerprint: journal.headFingerprint, afterFingerprint,
    patches: projectPatches(before, after)
  });
}

function applyPatches(project, patches, direction) {
  const target = clone(project), undo = direction === 'undo';
  const value = patch => clone(undo ? patch.before : patch.after);
  const exists = patch => undo ? patch.hadBefore : patch.hasAfter;
  for (const patch of patches) {
    if (patch.scope === 'chapter-order') continue;
    if (patch.scope === 'chapter') {
      target.chapters = target.chapters.filter(chapter => chapter.id !== patch.chapterId);
      if (exists(patch)) target.chapters.push(value(patch));
    } else {
      const object = patch.scope === 'project' ? target : target.chapters.find(chapter => chapter.id === patch.chapterId);
      if (!object || typeof patch.key !== 'string' || ['__proto__', 'prototype', 'constructor', 'id'].includes(patch.key)) throw new HistoryMismatchError('A manuscript history patch is invalid.');
      if (exists(patch)) object[patch.key] = value(patch); else delete object[patch.key];
    }
  }
  const order = patches.find(patch => patch.scope === 'chapter-order');
  if (order) {
    const ids = value(order), chapters = new Map(target.chapters.map(chapter => [chapter.id, chapter]));
    if (ids.length !== chapters.size || ids.some(chapterId => !chapters.has(chapterId)) || new Set(ids).size !== ids.length) throw new HistoryMismatchError('A manuscript history entry has an invalid chapter order.');
    target.chapters = ids.map(chapterId => chapters.get(chapterId));
  }
  return target;
}

function applyEntry(project, entry, direction, schema) {
  if (projectFingerprint(project) !== (direction === 'undo' ? entry.afterFingerprint : entry.beforeFingerprint)) throw new HistoryMismatchError('The document does not match the requested editing history entry.');
  let next, selection = null;
  if (entry.kind === 'steps') {
    const chapter = project.chapters.find(item => item.id === entry.chapterId);
    if (!chapter || !schema) throw new HistoryMismatchError('This chapter is unavailable for undo or redo.');
    let doc = schema.nodeFromJSON(chapter.content);
    const expectedDoc = direction === 'undo' ? entry.afterDocFingerprint : entry.beforeDocFingerprint;
    if (historyFingerprint(doc.toJSON()) !== expectedDoc) throw new HistoryMismatchError('The chapter has changed outside its editing history.');
    for (const json of direction === 'undo' ? entry.inverse : entry.forward) {
      const result = Step.fromJSON(schema, json).apply(doc);
      if (result.failed || !result.doc) throw new HistoryMismatchError('An editing history step could not be applied: ' + (result.failed || 'invalid document'));
      doc = result.doc;
    }
    doc.check();
    selection = clone(direction === 'undo' ? entry.selectionBefore : entry.selectionAfter);
    if (selection) { try { Selection.fromJSON(doc, selection); } catch { selection = null; } }
    next = { ...project, chapters: project.chapters.map(item => item.id === entry.chapterId ? { ...item, content: doc.toJSON() } : item) };
  } else next = applyPatches(project, entry.patches, direction);
  const afterFingerprint = direction === 'undo' ? entry.beforeFingerprint : entry.afterFingerprint;
  if (projectFingerprint(next) !== afterFingerprint) throw new HistoryMismatchError('The restored document did not match its recorded revision.');
  next.updatedAt = new Date().toISOString();
  return { project: next, selection, afterFingerprint };
}

export function applyHistory(project, journal, direction, schema) {
  if (!['undo', 'redo'].includes(direction)) throw new Error('History direction must be undo or redo.');
  verifyCurrent(journal, project);
  const entryId = journal.activeIds[direction === 'undo' ? journal.cursor - 1 : journal.cursor];
  if (!entryId) return null;
  const entry = journal.entries.find(item => item.id === entryId);
  if (!entry) throw new HistoryMismatchError('The requested editing history entry is missing.');
  const { project: next, selection, afterFingerprint } = applyEntry(project, entry, direction, schema);
  const event = { version: 1, kind: direction, sequence: journal.sequence + 1, timestamp: new Date().toISOString(), entryId, beforeFingerprint: journal.headFingerprint, afterFingerprint };
  const updated = replayEvent(journal, event);
  next.historySequence = updated.sequence;
  return { project: next, journal: updated, chapterId: next.chapters.some(chapter => chapter.id === entry.chapterId) ? entry.chapterId : next.chapters[0].id, selection, entry };
}

export function recoverHistoryProject(project, { events = [], recoverySequence = project.historySequence } = {}, schema) {
  if (!events.length) {
    const journal = createHistory(project);
    return { project: { ...project, historySequence: journal.sequence }, journal, recoveredEvents: 0 };
  }
  const sequence = recoverySequence == null || recoverySequence === 0 ? 1 : recoverySequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > events.length) throw new HistoryMismatchError('The document recovery checkpoint is missing from the editing journal.');
  let journal = createHistory(project, { events: events.slice(0, sequence) }), next = project;
  for (const event of events.slice(sequence)) {
    // Validate journal ordering and undo lineage before applying the saved edit.
    const advanced = replayEvent(journal, clone(event));
    const entry = event.kind === 'edit' ? event.entry : journal.entries.find(item => item.id === event.entryId);
    const result = applyEntry(next, entry, event.kind === 'undo' ? 'undo' : 'redo', schema);
    next = result.project; journal = advanced;
  }
  return { project: { ...next, historySequence: journal.sequence }, journal, recoveredEvents: events.length - sequence };
}

// A mismatch is a history problem, never a reason to hide an intact document.
// The returned reset is only a proposal: the caller must preserve the old ledger
// in the backend before publishing these new sequence numbers to that ledger.
export function prepareHistoryLoad(project, saved = {}, schema) {
  const baseline = createHistory(project);
  try {
    if (saved?.error || saved?.readError) throw new HistoryMismatchError(String(saved.error?.message || saved.error || saved.readError?.message || saved.readError));
    if (!saved || typeof saved !== 'object' || saved.events !== undefined && !Array.isArray(saved.events)) throw new HistoryMismatchError('The saved editing journal is unreadable.');
    const events = saved.events || [];
    if (saved.totalEvents !== undefined && (!Number.isSafeInteger(saved.totalEvents) || saved.totalEvents !== events.length)) throw new HistoryMismatchError('The editing journal did not contain all of its saved records.');
    if (!events.length && Number(project.historySequence) > 1) throw new HistoryMismatchError('The earlier editing journal is missing for this document.');
    const restored = recoverHistoryProject(project, { events, recoverySequence: saved.recoverySequence ?? project.historySequence }, schema);
    if (schema) for (const entry of restored.journal.entries) if (entry.kind === 'steps') for (const step of [...entry.forward, ...entry.inverse]) Step.fromJSON(schema, step);
    return { ...restored, requiresJournalReset: false, warning: '', reason: '' };
  } catch (error) {
    return {
      project: { ...project, historySequence: baseline.sequence }, journal: baseline,
      recoveredEvents: 0, requiresJournalReset: true,
      warning: 'The saved document was opened unchanged. Its earlier undo history could not be restored.',
      reason: String(error?.message || error).slice(0, 2000),
      previousSequence: project.historySequence ?? null,
      previousEventCount: Array.isArray(saved?.events) ? saved.events.length : null
    };
  }
}

export function historyStatus(journal) {
  if (!journal) return { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '', totalEdits: 0, sequence: 0 };
  const lookup = new Map(journal.entries.map(entry => [entry.id, entry]));
  return { canUndo: journal.cursor > 0, canRedo: journal.cursor < journal.activeIds.length, undoLabel: lookup.get(journal.activeIds[journal.cursor - 1])?.label || '', redoLabel: lookup.get(journal.activeIds[journal.cursor])?.label || '', totalEdits: journal.entries.length, sequence: journal.sequence };
}

export function timelineEntries(journal) {
  if (!journal) return [];
  const positions = new Map(journal.activeIds.map((entryId, index) => [entryId, index]));
  return journal.entries.map(entry => ({ ...entry, status: !positions.has(entry.id) ? 'branched' : positions.get(entry.id) < journal.cursor ? 'applied' : 'undone', current: journal.activeIds[journal.cursor - 1] === entry.id })).reverse();
}
