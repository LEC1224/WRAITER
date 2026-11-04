import { TextSelection, Selection } from '@tiptap/pm/state';
import { Transform } from '@tiptap/pm/transform';
import { uid } from './document.js';

const blank = node => node.type.name === 'paragraph' && !node.textContent.trim() && !node.childCount;
function hasContent(doc) {
  let found = false;
  doc.descendants(node => {
    if (node.isText && node.text.trim() || node.isLeaf && !node.isText && node.type.name !== 'hardBreak') found = true;
    return !found;
  });
  return found;
}

// Only cross empty paragraphs or a textblock boundary when looking for a title.
// A cursor inside ordinary prose must split at that exact character instead.
export function chapterSplitPlan({ doc, selection }) {
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  let heading = null, split = selection.from, rest = split;
  if ($from.depth === 1) {
    const blocks = [];
    doc.forEach((node, from) => blocks.push({ node, from, to: from + node.nodeSize }));
    const index = $from.index(0), current = blocks[index];
    const isHeading = block => block?.node.type.name === 'heading' && !!block.node.textContent.trim();
    if (isHeading(current)) heading = current;
    else {
      const atStart = $from.parentOffset === 0, atEnd = $from.parentOffset === $from.parent.content.size;
      if (atStart || blank(current.node)) {
        let previous = index - 1;
        while (previous >= 0 && blank(blocks[previous].node)) previous--;
        if (isHeading(blocks[previous])) heading = blocks[previous];
      }
      if (!heading && (atEnd || blank(current.node))) {
        let next = index + 1;
        while (next < blocks.length && blank(blocks[next].node)) next++;
        if (isHeading(blocks[next])) heading = blocks[next];
      }
    }
    if (heading) {
      split = heading.from; rest = heading.to;
      // Keep private passage anchors attached if a heading has a comment.
      let anchored = false;
      heading.node.descendants(node => { if (node.marks.some(mark => mark.type.name === 'commentAnchor')) anchored = true; });
      if (anchored) rest = split;
    } else if ($from.parentOffset === 0) split = rest = current.from;
    else if ($from.parentOffset === $from.parent.content.size) split = rest = current.to;
  }
  const before = new Transform(doc).delete(split, doc.content.size).doc;
  const after = new Transform(doc).delete(0, rest).doc;
  if (!hasContent(before) || !heading && !hasContent(after)) return null;
  before.check(); after.check();
  return { before, after, title: heading?.node.textContent.trim() || null };
}

export function splitChapterAtCursor(project, chapterId, state, id = uid()) {
  const index = project.chapters.findIndex(chapter => chapter.id === chapterId);
  const plan = chapterSplitPlan(state);
  if (index < 0 || !plan) throw new Error('Place the cursor inside a chapter with text on both sides of the break.');
  if (!id || project.chapters.some(chapter => chapter.id === id)) throw new Error('The new chapter needs its own identifier.');
  const chapter = project.chapters[index];
  const next = { ...chapter, id, title: plan.title || `Chapter ${index + 2}`, content: plan.after.toJSON() };
  const chapters = [...project.chapters];
  chapters.splice(index, 1, { ...chapter, content: plan.before.toJSON() }, next);
  return { project: { ...project, chapters }, chapterId: id, selection: Selection.atStart(plan.after).toJSON(), title: next.title };
}
