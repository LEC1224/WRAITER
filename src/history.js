import { Step } from '@tiptap/pm/transform';
import { Selection } from '@tiptap/pm/state';

// The journal is independent of an editor instance. Every edit and cursor move is
// an immutable event, so closing a document or changing chapters loses no undo.
const IGNORED = new Set(['updatedAt', 'historySequence', 'snapshots', 'chats', 'activeChatId', 'binding', 'fileBinding', 'nativeBinding']);
export const HISTORY_REPLAY_META = 'wraiterHistoryReplay';
export const HISTORY_SELECTION_META = 'wraiterHistorySelectionBefore';
export const HISTORY_GROUP_BREAK_META = 'wraiterHistoryGroupBreak';
const clone = value => value === undefined ? undefined : structuredClone(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const id = () => globalThis.crypto.randomUUID();
const valueFingerprints = new WeakMap(), projectFingerprints = new WeakMap(), structuralFingerprints = new WeakMap();
const statusCache = new WeakMap();
const OPTIONAL_SCHEMA_DEFAULTS = new Set(['pageBreakBefore', 'spaceBefore', 'leftIndent', 'rightIndent', 'wrap', 'cellBackground', 'cellBorder', 'namedStyle', 'tabStops']);
const compatibilityFingerprints = new Map();
const compatibilityModes = ['editing', 'preview', true];
const optionalDefault = (key, value, compatibility) => value == null && (key === 'pageBreakBefore' || !compatibility && OPTIONAL_SCHEMA_DEFAULTS.has(key) || compatibility === 'preview' && ['namedStyle', 'tabStops'].includes(key) || compatibility === 'editing' && ['wrap', 'cellBackground', 'cellBorder', 'namedStyle', 'tabStops'].includes(key));

export class HistoryMismatchError extends Error {
  constructor(message = 'This editing history no longer matches the document. The saved history has been preserved.') {
    super(message); this.name = 'HistoryMismatchError';
  }
}

function stable(value, compatibility = false) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => stable(item, compatibility)).join(',') + ']';
  // A new optional schema attribute must not invalidate journals made before
  // it existed. An absent page break and the schema's null default are equal.
  return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined && !optionalDefault(key, value[key], compatibility)).map(key => JSON.stringify(key) + ':' + stable(value[key], compatibility)).join(',') + '}';
}

// Two independent 32-bit hashes plus serialized length catch accidental stale
// state without requiring an asynchronous crypto call in each editor transaction.
export function historyFingerprint(value, compatibility = false) {
  const text = stable(value, compatibility); let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b); b ^= b >>> 13;
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

// Version two fingerprints are Merkle-style: a parent hashes the fingerprints
// of its immediate children instead of rebuilding and rescanning one enormous
// JSON string. ProseMirror nodes are persistent immutable trees, so typing in a
// paragraph only invalidates that paragraph and its ancestors. The result is a
// deterministic fingerprint that can also be reproduced from saved JSON.
function digest(parts, weight = 1) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      a = Math.imul(a ^ code, 0x01000193);
      b = Math.imul(b ^ code, 0x85ebca6b); b ^= b >>> 13;
    }
    a = Math.imul(a ^ 0x1f, 0x01000193);
    b = Math.imul(b ^ 0x1f, 0x85ebca6b); b ^= b >>> 13;
  }
  return `v2:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}:${weight}`;
}
function fingerprintArray(items, compatibility = false) {
  const children = items.map(item => structuralFingerprint(item, compatibility));
  return digest(['array', items.length, ...children], 1 + children.reduce((sum, value) => sum + Number(value.slice(value.lastIndexOf(':') + 1)), 0));
}
function fingerprintEntries(entries, compatibility = false) {
  const sorted = entries.filter(([key, value]) => value !== undefined && !optionalDefault(key, value, compatibility)).sort(([a], [b]) => a.localeCompare(b));
  const children = sorted.map(([key, value]) => [key, structuralFingerprint(value, compatibility)]);
  return digest(['object', sorted.length, ...children.flat()], 1 + children.reduce((sum, [, value]) => sum + Number(value.slice(value.lastIndexOf(':') + 1)), 0));
}
function proseMirrorJSON(value) {
  if (!value?.type?.name || typeof value.toJSON !== 'function') return null;
  // Mark and Node both expose type/attrs/toJSON. Nodes additionally expose a
  // Fragment with childCount/child; text nodes expose text.
  if (value.content && Number.isSafeInteger(value.childCount)) {
    const entries = [['type', value.type.name]];
    if (value.attrs && Object.keys(value.attrs).length) entries.push(['attrs', value.attrs]);
    if (value.childCount) entries.push(['content', Array.from({ length: value.childCount }, (_, index) => value.child(index))]);
    if (value.marks?.length) entries.push(['marks', value.marks]);
    if (value.isText) entries.push(['text', value.text]);
    return entries;
  }
  const entries = [['type', value.type.name]];
  if (value.attrs && Object.keys(value.attrs).length) entries.push(['attrs', value.attrs]);
  return entries;
}
export function structuralFingerprint(value, compatibility = false) {
  if (value === undefined) return digest(['undefined'], 1);
  if (value === null) return digest(['null'], 1);
  if (typeof value !== 'object') return digest([typeof value, JSON.stringify(value)], typeof value === 'string' ? value.length + 1 : 1);
  if (compatibility && !compatibilityFingerprints.has(compatibility)) compatibilityFingerprints.set(compatibility, new WeakMap());
  const cache = compatibility ? compatibilityFingerprints.get(compatibility) : structuralFingerprints;
  const cached = cache.get(value);
  if (cached) return cached;
  const pm = proseMirrorJSON(value);
  const result = pm ? fingerprintEntries(pm, compatibility) : Array.isArray(value) ? fingerprintArray(value, compatibility) : fingerprintEntries(Object.entries(value), compatibility);
  cache.set(value, result);
  return result;
}

// Associate the JSON snapshot Tiptap must produce for persistence with its
// already-persistent editor tree. This saves a second full traversal during the
// same keystroke while retaining plain serializable project data.
export function associateHistoryContent(content, documentNode) {
  if (!content || typeof content !== 'object' || !documentNode) return content;
  structuralFingerprints.set(content, structuralFingerprint(documentNode));
  return content;
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
// The legacy hash remains readable forever. A journal naturally moves to v2 on
// its next edit; no history migration or destructive reset is needed.
function legacyProjectFingerprint(project, compatibility = false) {
  const fields = Object.keys(project).filter(key => !IGNORED.has(key) && project[key] !== undefined).sort().map(key => [key,
    key === 'chapters' ? project.chapters.map(chapter => Object.keys(chapter).filter(name => chapter[name] !== undefined).sort().map(name => [name, compatibility ? historyFingerprint(chapter[name], compatibility) : cachedFingerprint(chapter[name])])) : compatibility ? historyFingerprint(project[key], compatibility) : cachedFingerprint(project[key])
  ]);
  return historyFingerprint(fields, compatibility);
}
function projectFingerprint(project, expected = 'v2:') {
  if (!String(expected).startsWith('v2:')) { const current = legacyProjectFingerprint(project); if (current === expected) return current; for (const mode of compatibilityModes) { const alternate = legacyProjectFingerprint(project, mode); if (alternate === expected) return alternate; } return current; }
  if (!projectFingerprints.has(project)) projectFingerprints.set(project, fingerprintEntries(Object.entries(project).filter(([key]) => !IGNORED.has(key))));
  const current = projectFingerprints.get(project);
  // Early preview journals included null defaults from the new schema. Keep
  // reading those exact fingerprints while new edits use the canonical form.
  if (expected !== 'v2:' && current !== expected) for (const mode of compatibilityModes) { const alternate = fingerprintEntries(Object.entries(project).filter(([key]) => !IGNORED.has(key)), mode); if (alternate === expected) return alternate; }
  return current;
}
function matchingFingerprint(value, expected) {
  const current = String(expected).startsWith('v2:') ? structuralFingerprint(value) : historyFingerprint(proseMirrorJSON(value) ? value.toJSON() : value);
  if (current !== expected) for (const mode of compatibilityModes) { const alternate = String(expected).startsWith('v2:') ? structuralFingerprint(value, mode) : historyFingerprint(proseMirrorJSON(value) ? value.toJSON() : value, mode); if (alternate === expected) return alternate; }
  return current;
}

function validateEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.label !== 'string' || typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp)) || typeof entry.beforeFingerprint !== 'string' || typeof entry.afterFingerprint !== 'string' || entry.chapterTitle != null && typeof entry.chapterTitle !== 'string' || entry.summary != null && typeof entry.summary !== 'string') throw new HistoryMismatchError('An editing journal entry is unreadable.');
  if (entry.groupId != null && (entry.kind !== 'steps' || typeof entry.groupId !== 'string' || !entry.groupId)) throw new HistoryMismatchError('An editing journal entry has an invalid undo group.');
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

function replayEvent(journal, event, loading = false, cursorEntry = null) {
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
  const entry = cursorEntry || journal._lookup.get(journal.activeIds[index]);
  if (!entry || entry.id !== journal.activeIds[index] || event.entryId !== entry.id || event.afterFingerprint !== (event.kind === 'undo' ? entry.beforeFingerprint : entry.afterFingerprint)) throw new HistoryMismatchError('An editing journal undo or redo event is invalid.');
  journal.events.push(event); journal.sequence = event.sequence; journal.cursor += event.kind === 'undo' ? -1 : 1; journal.headFingerprint = event.afterFingerprint;
  return journal;
}

function beginReplay(project, initial) {
  if (initial.version !== 1 || initial.kind !== 'init' || initial.sequence !== 1 || initial.projectId !== project.id || typeof initial.fingerprint !== 'string') throw new HistoryMismatchError('This editing journal belongs to a different manuscript or version.');
  return { version: 1, projectId: project.id, events: [initial], sequence: 1, entries: [], activeIds: [], cursor: 0, headFingerprint: initial.fingerprint, _lookup: new Map() };
}

export function createHistory(project, saved = {}) {
  if (!project?.id || !Array.isArray(project.chapters)) throw new HistoryMismatchError('Editing history needs a valid manuscript.');
  if (saved.events !== undefined && !Array.isArray(saved.events)) throw new HistoryMismatchError('The saved editing journal is invalid.');
  const events = saved.events || [];
  const initial = events[0] || { version: 1, kind: 'init', sequence: 1, projectId: project.id, fingerprint: projectFingerprint(project), timestamp: new Date().toISOString() };
  const journal = beginReplay(project, clone(initial));
  for (let i = 1; i < events.length; i++) replayEvent(journal, clone(events[i]), true);
  delete journal._lookup;
  if (journal.headFingerprint !== projectFingerprint(project, journal.headFingerprint)) throw new HistoryMismatchError();
  return journal;
}

function verifyCurrent(journal, project) {
  if (project.id !== journal.projectId || projectFingerprint(project, journal.headFingerprint) !== journal.headFingerprint) throw new HistoryMismatchError();
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

const TYPING_GROUP_PAUSE_MS = 2500;
const punctuation = /[\p{P}\p{S}]/u;
const whitespace = /\s/u;
function singleCharacter(value) { return typeof value === 'string' && Array.from(value).length === 1; }
function textSlice(step) {
  const content = step?.slice?.content;
  return content?.length === 1 && content[0].type === 'text' ? content[0].text : null;
}
function simpleTextEdit(entry) {
  if (entry?.kind !== 'steps' || entry.forward.length !== 1 || entry.inverse.length !== 1) return null;
  const step = entry.forward[0], reverse = entry.inverse[0];
  if (step.stepType !== 'replace' || reverse.stepType !== 'replace') return null;
  const inserted = textSlice(step), removed = textSlice(reverse);
  if (step.from === step.to && singleCharacter(inserted) && !reverse.slice?.content?.length) return { kind: 'insert', from: step.from, to: step.to, text: inserted };
  if (step.from < step.to && !step.slice?.content?.length && singleCharacter(removed)) {
    const cursor = entry.selectionBefore?.anchor;
    if (entry.selectionBefore?.head !== cursor) return null;
    if (cursor === step.to) return { kind: 'backspace', from: step.from, to: step.to, text: removed };
    if (cursor === step.from) return { kind: 'delete', from: step.from, to: step.to, text: removed };
  }
  return null;
}
function caret(selection) {
  return selection?.type === 'text' && selection.anchor === selection.head ? selection.anchor : null;
}
function breaksWord(previous, current, kind) {
  if (kind === 'backspace') return whitespace.test(current) && !whitespace.test(previous) || punctuation.test(current) && !punctuation.test(previous);
  return whitespace.test(current) && !whitespace.test(previous) || punctuation.test(previous) && !punctuation.test(current) && !whitespace.test(current);
}
function typingGroupId(journal, entry, transaction) {
  if (transaction.getMeta('historyLabel') || transaction.getMeta('assistAccept') || transaction.getMeta('paste') || transaction.getMeta('uiEvent') === 'paste') return null;
  const current = simpleTextEdit(entry);
  if (!current || caret(entry.selectionBefore) == null || caret(entry.selectionAfter) == null) return null;
  if (transaction.getMeta(HISTORY_GROUP_BREAK_META)) return entry.id;
  const precedingId = journal.activeIds[journal.cursor - 1];
  const previous = journal.cursor === journal.activeIds.length && journal.entries.at(-1)?.id === precedingId ? journal.entries.at(-1) : null;
  const earlier = simpleTextEdit(previous);
  const elapsed = previous ? Date.parse(entry.timestamp) - Date.parse(previous.timestamp) : Infinity;
  if (!previous?.groupId || !earlier || previous.chapterId !== entry.chapterId || earlier.kind !== current.kind ||
      elapsed < 0 || elapsed > TYPING_GROUP_PAUSE_MS ||
      caret(previous.selectionAfter) !== caret(entry.selectionBefore) ||
      breaksWord(earlier.text, current.text, current.kind)) return entry.id;
  if (current.kind === 'insert' && current.from === earlier.to + earlier.text.length) return previous.groupId;
  if (current.kind === 'backspace' && current.to === earlier.from) return previous.groupId;
  if (current.kind === 'delete' && current.from === earlier.from) return previous.groupId;
  return entry.id;
}

export function recordTransaction(journal, { chapterId, transaction, beforeProject, afterProject, label, appendedTransactions = [] }) {
  if (!transaction?.docChanged && !appendedTransactions.some(item => item.docChanged)) return journal;
  if (transaction.getMeta(HISTORY_REPLAY_META)) return journal;
  verifyCurrent(journal, beforeProject);
  const before = beforeProject.chapters.find(chapter => chapter.id === chapterId), after = afterProject.chapters.find(chapter => chapter.id === chapterId);
  if (!before || !after || structuralFingerprint(before.content) !== structuralFingerprint(transaction.before)) throw new HistoryMismatchError('An editor transaction starts from a different chapter revision.');
  const transactions = [transaction, ...appendedTransactions];
  const final = transactions.at(-1);
  if (structuralFingerprint(final.doc) !== structuralFingerprint(after.content)) throw new HistoryMismatchError('An editor transaction is missing part of the final chapter change.');
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
    beforeDocFingerprint: structuralFingerprint(before.content), afterDocFingerprint: structuralFingerprint(after.content),
    forward, inverse,
    selectionBefore: clone(transaction.getMeta(HISTORY_SELECTION_META) || null),
    selectionAfter: final.selection.toJSON()
  };
  const groupId = typingGroupId(journal, entry, transaction);
  if (groupId) entry.groupId = groupId;
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

export function recordProjectChange(journal, before, after, { label = 'Edit manuscript', chapterId = null, chapterIdAfter = null, revertsEntryId = null, selectionBefore = null, selectionAfter = null } = {}) {
  verifyCurrent(journal, before);
  if (after.id !== before.id || !Array.isArray(after.chapters) || !after.chapters.length || new Set(after.chapters.map(chapter => chapter.id)).size !== after.chapters.length) throw new HistoryMismatchError('A manuscript history entry must retain its identity and valid chapters.');
  const afterFingerprint = projectFingerprint(after);
  if (afterFingerprint === journal.headFingerprint) return journal;
  return appendEntry(journal, {
    id: id(), kind: 'project', timestamp: new Date().toISOString(), label: String(label).slice(0, 200), chapterId,
    chapterTitle: after.chapters.find(chapter => chapter.id === chapterId)?.title,
    ...(chapterIdAfter && chapterIdAfter !== chapterId ? { chapterIdAfter } : {}),
    ...(selectionBefore ? { selectionBefore: clone(selectionBefore) } : {}),
    ...(selectionAfter ? { selectionAfter: clone(selectionAfter) } : {}),
    beforeFingerprint: journal.headFingerprint, afterFingerprint,
    ...(revertsEntryId ? { revertsEntryId } : {}),
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

function applyEntry(project, entry, direction, schema, replayDocument) {
  const expectedProject = direction === 'undo' ? entry.afterFingerprint : entry.beforeFingerprint;
  if (projectFingerprint(project, expectedProject) !== expectedProject) throw new HistoryMismatchError('The document does not match the requested editing history entry.');
  let next, selection = null;
  if (entry.kind === 'steps') {
    const chapter = project.chapters.find(item => item.id === entry.chapterId);
    if (!chapter || !schema) throw new HistoryMismatchError('This chapter is unavailable for undo or redo.');
    // Consecutive steps in an undo group or a recovered tail usually touch
    // the same chapter. A project-level change invalidates this by identity.
    let doc = replayDocument.content === chapter.content ? replayDocument.doc : schema.nodeFromJSON(chapter.content);
    const expectedDoc = direction === 'undo' ? entry.afterDocFingerprint : entry.beforeDocFingerprint;
    if (matchingFingerprint(doc, expectedDoc) !== expectedDoc) throw new HistoryMismatchError('The chapter has changed outside its editing history.');
    for (const json of direction === 'undo' ? entry.inverse : entry.forward) {
      const result = Step.fromJSON(schema, json).apply(doc);
      if (result.failed || !result.doc) throw new HistoryMismatchError('An editing history step could not be applied: ' + (result.failed || 'invalid document'));
      doc = result.doc;
    }
    doc.check();
    selection = clone(direction === 'undo' ? entry.selectionBefore : entry.selectionAfter);
    if (selection) { try { Selection.fromJSON(doc, selection); } catch { selection = null; } }
    const content = associateHistoryContent(doc.toJSON(), doc);
    replayDocument.content = content; replayDocument.doc = doc;
    next = { ...project, chapters: project.chapters.map(item => item.id === entry.chapterId ? { ...item, content } : item) };
  } else {
    next = applyPatches(project, entry.patches, direction);
    selection = clone(direction === 'undo' ? entry.selectionBefore : entry.selectionAfter);
    if (selection) {
      try { const chapter = next.chapters.find(item => item.id === (direction === 'redo' ? entry.chapterIdAfter || entry.chapterId : entry.chapterId)); Selection.fromJSON(schema.nodeFromJSON(chapter.content), selection); }
      catch { selection = null; }
    }
  }
  const afterFingerprint = direction === 'undo' ? entry.beforeFingerprint : entry.afterFingerprint;
  if (projectFingerprint(next, afterFingerprint) !== afterFingerprint) throw new HistoryMismatchError('The restored document did not match its recorded revision.');
  next.updatedAt = new Date().toISOString();
  return { project: next, selection, afterFingerprint };
}

export function applyHistory(project, journal, direction, schema) {
  if (!['undo', 'redo'].includes(direction)) throw new Error('History direction must be undo or redo.');
  verifyCurrent(journal, project);
  const entryId = journal.activeIds[direction === 'undo' ? journal.cursor - 1 : journal.cursor];
  if (!entryId) return null;
  let chronological = journal.entries.findLastIndex(item => item.id === entryId);
  const entry = journal.entries[chronological];
  if (!entry) throw new HistoryMismatchError('The requested editing history entry is missing.');
  const groupId = entry.groupId || entry.id;
  const stride = direction === 'undo' ? -1 : 1, replayDocument = {};
  // Cursor moves only append events. Retain one private copy for the entire
  // group so a failed step cannot alter the caller's published journal.
  const updated = { ...journal, events: journal.events.slice() };
  let next = project, selection = null, lastEntry = entry;
  while (chronological >= 0 && chronological < journal.entries.length) {
    const nextId = updated.activeIds[direction === 'undo' ? updated.cursor - 1 : updated.cursor];
    if (!nextId) break;
    const member = journal.entries[chronological];
    chronological += stride;
    if (member.id !== nextId) continue; // Skip edits left on a former branch.
    if ((member.groupId || member.id) !== groupId) break;
    const result = applyEntry(next, member, direction, schema, replayDocument);
    const event = { version: 1, kind: direction, sequence: updated.sequence + 1, timestamp: new Date().toISOString(), entryId: member.id, beforeFingerprint: updated.headFingerprint, afterFingerprint: result.afterFingerprint };
    replayEvent(updated, event, true, member);
    next = result.project; selection = result.selection; lastEntry = member;
  }
  next.historySequence = updated.sequence;
  const chapterId = direction === 'redo' ? lastEntry.chapterIdAfter || lastEntry.chapterId : lastEntry.chapterId;
  return { project: next, journal: updated, chapterId: next.chapters.some(chapter => chapter.id === chapterId) ? chapterId : next.chapters[0].id, selection, entry: lastEntry };
}

// During restoration the journal has one owner. Append into its arrays and
// lookup table, then publish the completed immutable journal to the editor.
function historyReplay(project, totalEvents, recoverySequence, schema, validateSteps) {
  const checkpoint = recoverySequence == null || recoverySequence === 0 ? 1 : recoverySequence;
  if (totalEvents && (!Number.isSafeInteger(checkpoint) || checkpoint < 1 || checkpoint > totalEvents)) throw new HistoryMismatchError('The document recovery checkpoint is missing from the editing journal.');
  let journal, next = project;
  const replayDocument = {};
  return {
    append(event) {
      if (!journal) journal = beginReplay(project, event);
      else {
        replayEvent(journal, event, true);
        if (event.kind === 'edit' && validateSteps && schema && event.entry.kind === 'steps') {
          for (const step of event.entry.forward) Step.fromJSON(schema, step);
          for (const step of event.entry.inverse) Step.fromJSON(schema, step);
        }
        if (journal.sequence > checkpoint) {
          const entry = event.kind === 'edit' ? event.entry : journal._lookup.get(event.entryId);
          next = applyEntry(next, entry, event.kind === 'undo' ? 'undo' : 'redo', schema, replayDocument).project;
        }
      }
      if (journal.sequence === checkpoint) verifyCurrent(journal, project);
    },
    finish() {
      if ((journal?.sequence || 0) !== totalEvents) throw new HistoryMismatchError('The editing journal did not contain all of its saved records.');
      if (!journal) journal = createHistory(project);
      delete journal._lookup;
      return { project: { ...next, historySequence: journal.sequence }, journal, recoveredEvents: Math.max(0, totalEvents - checkpoint) };
    }
  };
}

export function recoverHistoryProject(project, { events = [], recoverySequence = project.historySequence } = {}, schema, validateSteps = false) {
  const replay = historyReplay(project, events.length, recoverySequence, schema, validateSteps);
  for (const event of events) replay.append(clone(event));
  return replay.finish();
}

function missingHistory(project, totalEvents) {
  if (!totalEvents && Number(project.historySequence) > 1) throw new HistoryMismatchError('The earlier editing journal is missing for this document.');
}

function loadedHistory(restored) { return { ...restored, requiresJournalReset: false, warning: '', reason: '' }; }

// Propose a fresh baseline only. The caller preserves the old ledger before
// publishing the new sequence or permitting another save against it.
function historyLoadFailure(project, error, previousEventCount) {
  const baseline = createHistory(project);
  return {
    project: { ...project, historySequence: baseline.sequence }, journal: baseline,
    recoveredEvents: 0, requiresJournalReset: true,
    warning: 'The saved document was opened unchanged. Its earlier undo history could not be restored.',
    reason: String(error?.message || error).slice(0, 2000),
    previousSequence: project.historySequence ?? null, previousEventCount
  };
}

export function prepareHistoryLoad(project, saved = {}, schema) {
  try {
    if (saved?.error || saved?.readError) throw new HistoryMismatchError(String(saved.error?.message || saved.error || saved.readError?.message || saved.readError));
    if (!saved || typeof saved !== 'object' || saved.events !== undefined && !Array.isArray(saved.events)) throw new HistoryMismatchError('The saved editing journal is unreadable.');
    const events = saved.events || [];
    if (saved.totalEvents !== undefined && (!Number.isSafeInteger(saved.totalEvents) || saved.totalEvents !== events.length)) throw new HistoryMismatchError('The editing journal did not contain all of its saved records.');
    missingHistory(project, events.length);
    return loadedHistory(recoverHistoryProject(project, { events, recoverySequence: saved.recoverySequence ?? project.historySequence }, schema, true));
  } catch (error) { return historyLoadFailure(project, error, Array.isArray(saved?.events) ? saved.events.length : null); }
}

// Each IPC reply contains serialized records for just one page. Parsing them
// here gives the renderer sole ownership and lets it paint between replies.
export async function loadDocumentHistory(project, api, schema) {
  if (!api.loadEditHistoryPage) {
    const saved = await api.loadEditHistory(project.id);
    return { ...prepareHistoryLoad(project, saved, schema), totalEvents: saved?.totalEvents || 0 };
  }
  const read = async (from, snapshot) => {
    try { return await api.loadEditHistoryPage(project.id, from, snapshot); }
    catch {
      // Sharing violations and other short-lived I/O failures deserve a retry.
      // If the retry also fails, leave the saved undo lineage in place.
      await new Promise(resolve => setTimeout(resolve, 100));
      return api.loadEditHistoryPage(project.id, from, snapshot);
    }
  };
  let page = await read(0), received = 0, replay;
  const snapshot = { totalEvents: page?.totalEvents, generation: page?.generation };
  for (;;) {
    if (page?.corrupt) return { ...historyLoadFailure(project, page.corrupt, received || null), totalEvents: null };
    if (!Number.isSafeInteger(page?.totalEvents) || page.totalEvents < 0 || typeof page.generation !== 'string' || page.generation !== snapshot.generation || page.totalEvents !== snapshot.totalEvents || !Number.isSafeInteger(page.next) || page.next > page.totalEvents || (received < page.totalEvents ? page.next <= received : page.next !== received) || typeof page.text !== 'string') throw new Error('The editing history changed during loading. Please try again.');
    const lines = page.text.split('\n').filter(line => line.trim());
    if (lines.length !== page.next - received) throw new Error('The editing journal page is incomplete. Please try again.');
    try {
      if (!replay) {
        missingHistory(project, page.totalEvents);
        replay = historyReplay(project, page.totalEvents, project.historySequence, schema, true);
      }
      for (const line of lines) replay.append(JSON.parse(line));
      if (page.next === page.totalEvents) return { ...loadedHistory(replay.finish()), totalEvents: page.totalEvents };
    } catch (error) { return { ...historyLoadFailure(project, error, page.totalEvents), totalEvents: page.totalEvents }; }
    received = page.next;
    page = await read(received, snapshot);
  }
}

export function historyStatus(journal) {
  if (!journal) return { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '', totalEdits: 0, sequence: 0 };
  // Published journals are immutable. Cursor/toolbar renders and the history
  // panel can share this calculation until an edit, undo or redo replaces it.
  const cached = statusCache.get(journal);
  if (cached) return { ...cached };
  let totalEdits = 0, priorGroup = null, priorStatus = null, active = 0, undoLabel = '', redoLabel = '';
  // The active branch is a subsequence of the chronological ledger, including
  // after undo and branching. Both can be walked together without two indexes.
  for (const entry of journal.entries) {
    let status = 'branched';
    if (entry.id === journal.activeIds[active]) {
      status = active < journal.cursor ? 'applied' : 'undone';
      if (active === journal.cursor - 1) undoLabel = entry.label;
      if (active === journal.cursor) redoLabel = entry.label;
      active++;
    }
    if (!entry.groupId || entry.groupId !== priorGroup || status !== priorStatus) totalEdits++;
    priorGroup = entry.groupId || null; priorStatus = status;
  }
  const status = { canUndo: journal.cursor > 0, canRedo: journal.cursor < journal.activeIds.length, undoLabel, redoLabel, totalEdits, sequence: journal.sequence };
  statusCache.set(journal, status);
  return { ...status };
}

// The panel opens at the newest edits. Walk backwards so its first page costs
// only the groups it displays, even when a manuscript has years of history.
function* timelineRows(journal) {
  let active = journal.activeIds.length - 1;
  const statusOf = entry => entry.id !== journal.activeIds[active] ? 'branched' : active < journal.cursor ? 'applied' : 'undone';
  for (let last = journal.entries.length - 1; last >= 0;) {
    const latest = journal.entries[last], status = statusOf(latest);
    let first = last;
    if (status !== 'branched') active--;
    if (latest.kind === 'steps' && latest.groupId) {
      while (first > 0) {
        const earlier = journal.entries[first - 1];
        if (earlier.groupId !== latest.groupId || earlier.kind !== 'steps' || statusOf(earlier) !== status) break;
        if (status !== 'branched') active--;
        first--;
      }
    }
    const earliest = journal.entries[first];
    const row = { ...earliest, status, current: latest.id === journal.activeIds[journal.cursor - 1], editCount: last - first + 1 };
    if (earliest.kind === 'steps') {
      row.forward = []; row.inverse = [];
      for (let i = first; i <= last; i++) for (const step of journal.entries[i].forward) row.forward.push(step);
      for (let i = last; i >= first; i--) for (const step of journal.entries[i].inverse) row.inverse.push(step);
      if (first !== last) {
        row.afterFingerprint = latest.afterFingerprint; row.afterDocFingerprint = latest.afterDocFingerprint;
        row.selectionAfter = latest.selectionAfter; row.timestamp = latest.timestamp;
        row.summary = excerpt(row.forward.map(step => textOf(step.slice)).join('')) || excerpt(row.inverse.map(step => textOf(step.slice)).join(''));
      }
    }
    yield row;
    last = first - 1;
  }
}

export function timelinePage(journal, limit, matches) {
  if (!journal) return { rows: [], total: 0 };
  const rows = []; let total = 0;
  for (const row of timelineRows(journal)) {
    if (matches && !matches(row)) continue;
    if (rows.length < limit) rows.push(row);
    total++;
    if (!matches && rows.length === limit) break;
  }
  return { rows, total: matches ? total : historyStatus(journal).totalEdits };
}

export function timelineEntries(journal) {
  return journal ? [...timelineRows(journal)] : [];
}
