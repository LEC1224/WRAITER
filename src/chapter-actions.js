import { stripCommentAnchors } from './comments.js';
import { uid } from './document.js';

// Match the manuscript format limits.
export const MAX_CHAPTERS = 2000;
export const MAX_CHAPTER_TITLE = 2000;

export function duplicateChapter(chapters, id, schema) {
  const index = chapters.findIndex(chapter => chapter.id === id);
  if (index < 0 || chapters.length >= MAX_CHAPTERS) return chapters;

  const source = chapters[index], titles = new Set(chapters.map(chapter => chapter.title));
  const base = source.title.trim() ? source.title : 'Untitled chapter';
  let title, copy = 1;
  do {
    const suffix = copy === 1 ? ' (copy)' : ' (copy ' + copy + ')';
    title = base.slice(0, MAX_CHAPTER_TITLE - suffix.length).replace(/[\uD800-\uDBFF]$/u, '') + suffix;
    copy++;
  } while (titles.has(title));

  // Manuscript content is immutable. Omit private anchors so edits or deletion
  // of a comment or bookmark in the original never affect the duplicate.
  const stripped = stripCommentAnchors(source.content);
  // Removing an anchor may leave adjacent text runs with identical formatting.
  // Merge them now so reloading the document does not change its undo state.
  const content = stripped === source.content ? stripped : schema.nodeFromJSON(stripped).toJSON();
  const duplicate = { ...source, id: uid(), title, content };
  return [...chapters.slice(0, index + 1), duplicate, ...chapters.slice(index + 1)];
}
