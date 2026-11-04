import { Mark } from '@tiptap/core';

// Revision IDs are independent of private comment/bookmark anchors.
export const TrackedChange = Mark.create({
  name: 'trackedChange', inclusive: false, excludes: '', clearable: false,
  addOptions() { return { allowImportedChanges: false }; },
  addAttributes() { return { id: { default: null }, kind: { default: null }, author: { default: 'Writer' }, date: { default: null } }; },
  parseHTML() { if (!this?.options?.allowImportedChanges) return []; return [{ tag: 'span[data-wraiter-track-id][data-wraiter-track-kind]', getAttrs: element => {
    const id = element.getAttribute('data-wraiter-track-id'), kind = element.getAttribute('data-wraiter-track-kind'), author = element.getAttribute('data-wraiter-track-author'), date = element.getAttribute('data-wraiter-track-date');
    return /^[A-Za-z0-9_-]{1,200}$/.test(id || '') && ['insert', 'delete'].includes(kind) && typeof author === 'string' && author.length <= 200 && typeof date === 'string' && date.length <= 100 ? { id, kind, author, date } : false;
  } }]; },
  renderHTML({ HTMLAttributes: attrs }) { return ['span', { class: `tracked-change tracked-${attrs.kind}`, 'data-tracked-id': attrs.id, title: `${attrs.kind === 'delete' ? 'Removed' : 'Added'} text — awaiting review. Click to accept or reject.` }, 0]; }
});

export function trackedRanges(doc) {
  const changes = new Map();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) if (mark.type.name === 'trackedChange') {
      let change = changes.get(mark.attrs.id);
      if (!change) { change = { id: mark.attrs.id, author: mark.attrs.author, date: mark.attrs.date, ranges: [] }; changes.set(mark.attrs.id, change); }
      change.ranges.push({ from: pos, to: pos + node.nodeSize, kind: mark.attrs.kind, text: node.text });
    }
  });
  return [...changes.values()];
}

// Range operations run backwards, so removal cannot invalidate earlier ranges.
export function resolveTrackedChange(state, id, accept) {
  return resolveTrackedChanges(state, new Set([id]), accept);
}

export function resolveTrackedChanges(state, ids, accept) {
  const ranges = trackedRanges(state.doc).filter(item => ids.has(item.id)).flatMap(item => item.ranges);
  if (!ranges.length) return null;
  const tr = state.tr;
  for (const range of ranges.sort((a, b) => b.from - a.from)) {
    if ((range.kind === 'delete') === accept) tr.delete(range.from, range.to);
    else tr.removeMark(range.from, range.to, state.schema.marks.trackedChange);
  }
  return tr;
}

// Rendered publication is the accepted reading, while native documents retain
// pending revisions. This function never mutates the source tree.
export function acceptTrackedJSON(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.marks?.some(mark => mark.type === 'trackedChange' && mark.attrs?.kind === 'delete')) return null;
  const result = { ...node };
  if (node.marks) { result.marks = node.marks.filter(mark => mark.type !== 'trackedChange'); if (!result.marks.length) delete result.marks; }
  if (node.content) result.content = node.content.map(acceptTrackedJSON).filter(Boolean);
  return result;
}
