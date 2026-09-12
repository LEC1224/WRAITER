import { diffWordsWithSpace } from 'diff';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

// Only changed ranges are replaced; the remaining document nodes and marks survive.
export function revisionTransaction(state, from, to, replacement) {
  const $from = state.doc.resolve(from), $to = state.doc.resolve(to);
  const original = state.doc.textBetween(from, to, '\n', '\n');
  const normalized = replacement.replace(/\r\n/g, '\n');
  const blocks = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return;
    const start = Math.max(from, pos + 1), end = Math.min(to, pos + node.nodeSize - 1);
    if (end < start) return false;
    // Images and hard breaks need structural handling instead of string offsets.
    let plain = true;
    node.forEach(child => { if (!child.isText) plain = false; });
    blocks.push({ start, end, text: state.doc.textBetween(start, end, '', '\n'), plain });
    return false;
  });
  const lines = normalized.split('\n');
  const canPreserve = blocks.length === lines.length && blocks.every(b => b.plain) && original === blocks.map(b => b.text).join('\n');
  if (!canPreserve) return null;
  const edits = [];
  blocks.forEach((block, index) => {
    let offset = 0, pending = null;
    const flush = () => { if (pending) edits.push(pending); pending = null; };
    for (const part of diffWordsWithSpace(block.text, lines[index])) {
      if (part.added || part.removed) {
        if (!pending) pending = { from: block.start + offset, to: block.start + offset, text: '' };
        if (part.added) pending.text += part.value;
        else { offset += part.value.length; pending.to = block.start + offset; }
      } else { flush(); offset += part.value.length; }
    }
    flush();
  });
  let tr = closeHistory(state.tr);
  for (const edit of edits.reverse()) tr.insertText(edit.text, edit.from, edit.to);
  const end = tr.mapping.map(to, 1);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size))));
  return tr;
}

export function proposalChangesStructure(state, from, to, text) {
  return revisionTransaction(state, from, to, text) === null;
}
