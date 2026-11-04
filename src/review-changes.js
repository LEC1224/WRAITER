import { EditorState, Selection } from '@tiptap/pm/state';
import { trackedRanges, resolveTrackedChanges } from '../electron/tracked-changes.mjs';

const cache = new WeakMap();
// Context uses the proposed reading so a neighbouring edit never appears as
// duplicated old/new wording. Inside this edit, show its two actual readings,
// including any unchanged text between marked ranges.
function readingBetween(doc, from, to, originalId = null) {
  let text = '';
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock && text) text += ' ';
    if (!node.isText) { if (node.isInline && node.isLeaf) text += '…'; return; }
    const mark = node.marks.find(mark => mark.type.name === 'trackedChange');
    if (mark && mark.attrs.kind === (mark.attrs.id === originalId ? 'insert' : 'delete')) return;
    text += node.text.slice(Math.max(0, from - pos), Math.min(node.nodeSize, to - pos));
  });
  return text;
}
export function projectChanges(project, schema) {
  return project.chapters.flatMap(chapter => {
    let changes = cache.get(chapter.content);
    if (!changes) {
      const doc = schema.nodeFromJSON(chapter.content);
      changes = trackedRanges(doc).map(change => {
        const from = Math.min(...change.ranges.map(range => range.from)), to = Math.max(...change.ranges.map(range => range.to));
        const original = readingBetween(doc, from, to, change.id), proposed = readingBetween(doc, from, to);
        const hasRemoval = change.ranges.some(range => range.kind === 'delete'), hasAddition = change.ranges.some(range => range.kind === 'insert');
        return { ...change, from, to, original, proposed, kind: hasRemoval && hasAddition ? 'Replacement' : hasRemoval ? 'Removal' : 'Addition',
          before: readingBetween(doc, Math.max(0, from - 45), from), after: readingBetween(doc, to, Math.min(doc.content.size, to + 45)) };
      });
      cache.set(chapter.content, changes);
    }
    return changes.map(change => ({ ...change, key: `${chapter.id}:${change.id}`, chapterId: chapter.id, chapterTitle: chapter.title }));
  });
}

export function reviewProjectChanges(project, changes, accept, schema, activeChapterId, selection) {
  const grouped = new Map();
  for (const change of changes) {
    if (!grouped.has(change.chapterId)) grouped.set(change.chapterId, new Set());
    grouped.get(change.chapterId).add(change.id);
  }
  let nextSelection = selection;
  const chapters = project.chapters.map(chapter => {
    if (!grouped.has(chapter.id)) return chapter;
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(chapter.content) });
    const tr = resolveTrackedChanges(state, grouped.get(chapter.id), accept);
    if (!tr) throw new Error('These edits have already been reviewed. Refresh the list.');
    if (chapter.id === activeChapterId && selection) nextSelection = Selection.fromJSON(state.doc, selection).map(tr.doc, tr.mapping).toJSON();
    return { ...chapter, content: tr.doc.toJSON() };
  });
  return { project: { ...project, chapters }, selection: nextSelection };
}
