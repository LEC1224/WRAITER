import { Selection } from '@tiptap/pm/state';

export function noteLocations(doc) {
  const notes = []; let footnote = 0, endnote = 0;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'note') return;
    const number = node.attrs.kind === 'endnote' ? ++endnote : ++footnote;
    notes.push({ pos, number, kind: node.attrs.kind, text: node.attrs.text });
  });
  return notes;
}
export function captureNoteAt(editor, pos) {
  if (!editor || editor.isDestroyed) return null;
  const doc = editor.state.doc, node = doc.nodeAt(pos);
  if (node?.type.name !== 'note') return null;
  return { editor, doc, from: pos, to: pos + node.nodeSize, node, ...node.attrs, number: noteLocations(doc).find(note => note.pos === pos)?.number };
}
export function removeNote(target) {
  const editor = target?.editor;
  if (!editor || editor.isDestroyed || editor.state.doc !== target.doc || !target.node || editor.state.doc.nodeAt(target.from) !== target.node) return false;
  editor.view.dispatch(editor.state.tr.delete(target.from, target.to).setMeta('historyLabel', 'Delete note'));
  editor.commands?.focus(); return true;
}

// Capture an immutable target before opening the note dialog. A note appends
// after selected prose; only selecting an existing note replaces an element.
export function captureNoteTarget(editor) {
  if (!editor || editor.isDestroyed) return null;
  const { selection, doc } = editor.state;
  const node = selection.node?.type.name === 'note' ? selection.node : null;
  const caret = node || selection.$to.parent.inlineContent ? selection : Selection.findFrom(selection.$to, -1, true);
  if (!caret) return null;
  return { editor, doc, from: node ? selection.from : caret.to, to: caret.to, node, kind: node?.attrs.kind || 'footnote', text: node?.attrs.text || '', number: node ? noteLocations(doc).find(note => note.pos === selection.from)?.number : null };
}

export function applyNote(target, { kind, text }) {
  const editor = target?.editor;
  if (!editor || editor.isDestroyed || editor.state.doc !== target.doc || !['footnote', 'endnote'].includes(kind) || typeof text !== 'string' || !text.trim() || text.length > 100000) return false;
  const note = editor.state.schema.nodes.note;
  if (!note || target.node && editor.state.doc.nodeAt(target.from) !== target.node) return false;
  editor.view.dispatch(editor.state.tr.replaceWith(target.from, target.to, note.create({ kind, text })).setMeta('historyLabel', target.node ? 'Edit note' : 'Insert note'));
  editor.commands?.focus();
  return true;
}

