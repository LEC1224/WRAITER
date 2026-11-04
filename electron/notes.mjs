import { Node, mergeAttributes } from '@tiptap/core';

// The note body travels with its inline anchor, including through undo/copy.
export const Note = Node.create({
  name: 'note', priority: 1000, group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { kind: { default: 'footnote' }, text: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-wraiter-note]', priority: 1000, getAttrs: element => ({ kind: element.getAttribute('data-note-kind') === 'endnote' ? 'endnote' : 'footnote', text: element.getAttribute('data-note-text') || '' }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-wraiter-note': '', 'data-note-kind': node.attrs.kind, 'data-note-text': node.attrs.text, title: `${node.attrs.kind === 'endnote' ? 'Endnote' : 'Footnote'}: ${node.attrs.text.slice(0, 300)} — Click to edit`, class: 'note-marker', role: 'button', 'aria-label': `Edit ${node.attrs.kind}: ${node.attrs.text.slice(0, 120)}` }), node.attrs.kind === 'endnote' ? '‡' : '†']; }
});
