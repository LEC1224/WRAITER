import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

export const trackModeKey = new PluginKey('trackMode');
const revisionMeta = 'wraiterTrackedChange';
const markAt = (node, name) => node?.marks?.find(mark => mark.type.name === name);
const newId = () => `revision_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;

// All supported edits remain inside one text block. Unsupported structural or
// rich edits are blocked while tracking is on, rather than silently untracked.
export function suggestText(state, from, to, text) {
  if (typeof text !== 'string' || /[\r\n]/.test(text)) return null;
  const start = state.doc.resolve(from), end = state.doc.resolve(to);
  if (start.parent !== end.parent || !start.parent.isTextblock || start.parent.type.spec.code) return null;
  const pieces = [];
  let valid = true;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return;
    if (!node.isText) { valid = false; return; }
    pieces.push({ from: Math.max(pos, from), to: Math.min(pos + node.nodeSize, to), mark: markAt(node, 'trackedChange'), marks: node.marks });
  });
  if (!valid) return null;
  const track = state.schema.marks.trackedChange, tr = state.tr;
  const before = start.nodeBefore, after = start.nodeAfter;
  const previous = markAt(before, 'trackedChange'), next = markAt(after, 'trackedChange');
  const recent = mark => mark?.attrs.author === 'Writer' && Date.now() - Date.parse(mark.attrs.date) < 30000;
  const allInserted = pieces.length > 0 && pieces.every(piece => piece.mark?.attrs.kind === 'insert' && piece.mark.attrs.id === pieces[0].mark.attrs.id);
  const insertion = allInserted ? pieces[0].mark : from === to && (previous?.attrs.kind === 'insert' && (next?.attrs.id === previous.attrs.id || recent(previous)) ? previous : next?.attrs.kind === 'insert' && recent(next) ? next : null);
  const adjacentDeletion = [markAt(start.nodeBefore, 'trackedChange'), markAt(end.nodeAfter, 'trackedChange')].find(mark => mark?.attrs.kind === 'delete' && recent(mark));
  const attrs = insertion?.attrs || (!text && adjacentDeletion?.attrs) || { id: newId(), author: 'Writer', date: new Date().toISOString() };
  // Replacing wording is one review decision. Existing proposed additions can
  // be edited or erased; existing removals stay recoverable until reviewed.
  for (const piece of [...pieces].reverse()) {
    if (piece.mark?.attrs.kind === 'insert') tr.delete(piece.from, piece.to);
    else if (!piece.mark) tr.addMark(piece.from, piece.to, track.create({ ...attrs, kind: 'delete' }));
  }
  const insertAt = tr.mapping.map(to, -1);
  if (text) {
    const sourceMarks = pieces.find(piece => piece.mark?.attrs.kind !== 'delete')?.marks || state.storedMarks || start.marks();
    const marks = sourceMarks.filter(mark => mark.type.name !== 'trackedChange');
    tr.insert(insertAt, state.schema.text(text, [...marks, track.create({ ...attrs, kind: 'insert' })]));
  }
  tr.setSelection(TextSelection.create(tr.doc, text ? insertAt + text.length : tr.mapping.map(from, -1)));
  return tr.setMeta(revisionMeta, true);
}

export function trackedDeletionRange(state, backwards) {
  let { from, to } = state.selection;
  if (from !== to) return { from, to };
  let cursor = from;
  while (true) {
    const at = state.doc.resolve(cursor), node = backwards ? at.nodeBefore : at.nodeAfter;
    if (!node?.isText) return null;
    if (markAt(node, 'trackedChange')?.attrs.kind === 'delete') { cursor += backwards ? -node.nodeSize : node.nodeSize; continue; }
    const characters = Array.from(node.text), length = (backwards ? characters.at(-1) : characters[0]).length;
    return backwards ? { from: cursor - length, to: cursor } : { from: cursor, to: cursor + length };
  }
}

export function trackedEditor(onBlocked, initiallyEnabled = false) {
  return Extension.create({ name: 'trackedEditor', addProseMirrorPlugins() { return [new Plugin({ key: trackModeKey,
    state: { init: () => initiallyEnabled, apply: (tr, active) => tr.getMeta(trackModeKey) ?? active },
    filterTransaction(tr, state) { if (!trackModeKey.getState(state) || !tr.docChanged || tr.getMeta(revisionMeta)) return true; onBlocked?.(); return false; },
    props: {
      handleTextInput(view, from, to, text) {
        if (!trackModeKey.getState(view.state)) return false;
        const tr = suggestText(view.state, from, to, text); if (tr) view.dispatch(tr); else onBlocked?.(); return true;
      },
      handlePaste(view, event) {
        if (!trackModeKey.getState(view.state)) return false;
        const text = event.clipboardData?.getData('text/plain') || '';
        if (!text || /[\r\n]/.test(text)) { onBlocked?.(); return true; }
        const tr = suggestText(view.state, view.state.selection.from, view.state.selection.to, text); if (tr) view.dispatch(tr); else onBlocked?.(); return true;
      },
      handleKeyDown(view, event) {
        if (!trackModeKey.getState(view.state) || !['Backspace', 'Delete', 'Enter'].includes(event.key)) return false;
        if (event.key === 'Enter' || event.ctrlKey || event.metaKey || event.altKey) { onBlocked?.(); return true; }
        const range = trackedDeletionRange(view.state, event.key === 'Backspace');
        if (!range) { onBlocked?.(); return true; }
        const { from, to } = range;

        const tr = suggestText(view.state, from, to, ''); if (tr) view.dispatch(tr); else onBlocked?.(); return true;
      }
    }
  })]; } });
}
export function trackedReviewTransaction(tr) { return tr.setMeta(revisionMeta, true); }
