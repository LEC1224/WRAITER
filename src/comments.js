import { editorialSchema } from '../electron/editor-schema.mjs';
import { Transform } from '@tiptap/pm/transform';
import { collectCommentRanges, commentLocations, reconcileCommentChapters as reconcileChapters, COMMENT_ID_PATTERN, MAX_COMMENT_TEXT, MAX_COMMENTS, stripCommentAnchors } from '../electron/comments.mjs';

export { stripCommentAnchors };
export const reconcileCommentChapters = (project, schema = editorialSchema) => reconcileChapters(project, schema);

const textValue = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_COMMENT_TEXT) throw new Error(`Write a comment of up to ${MAX_COMMENT_TEXT.toLocaleString()} characters.`);
  return value.trim();
};
const timestamp = () => new Date().toISOString();

export function commentRanges(content, id, schema = editorialSchema) {
  return collectCommentRanges(content, schema).get(id) || [];
}

export function projectCommentRows(project, schema = editorialSchema) {
  const chapters = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  const attached = (project.comments || []).length ? commentLocations(project, schema) : new Map();
  return (project.comments || []).map(comment => {
    const locations = attached.get(comment.id) || [];
    const chapter = locations[0]?.chapter || chapters.get(comment.chapterId);
    const ranges = locations[0]?.ranges || [];
    return { comment, chapter, ranges, locations, detached: locations.length === 0 };
  });
}

// Prepare one immutable manuscript batch. The caller records both metadata and
// anchor changes as one undo step, rather than dispatching two unrelated edits.
export function addComment(project, { chapterId, from, to, text, id = globalThis.crypto.randomUUID() }, schema = editorialSchema) {
  const chapter = project.chapters.find(chapter => chapter.id === chapterId);
  if (!chapter) throw new Error('Select a passage in an existing chapter.');
  if ((project.comments || []).length >= MAX_COMMENTS) throw new Error(`A manuscript supports up to ${MAX_COMMENTS.toLocaleString()} comments.`);
  if (typeof id !== 'string' || !COMMENT_ID_PATTERN.test(id) || (project.comments || []).some(comment => comment.id === id)) throw new Error('This comment identifier is invalid or already used.');
  const doc = schema.nodeFromJSON(chapter.content);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to <= from || to > doc.content.size) throw new Error('Select the passage to comment on.');
  const quote = doc.textBetween(from, to, '\n', ' ').trim().slice(0, 2000);
  if (!quote) throw new Error('Select text to comment on.');
  doc.nodesBetween(from, to, node => {
    if (node.isInline && node.marks.length >= 64) throw new Error('This passage already has the maximum number of overlapping comments.');
  });
  const now = timestamp(), comment = { id, chapterId, text: textValue(text), quote, createdAt: now, updatedAt: now, resolved: false };
  const transaction = new Transform(doc).addMark(from, to, schema.marks.commentAnchor.create({ id }));
  const nextChapter = { ...chapter, content: transaction.doc.toJSON() };
  return {
    project: { ...project, comments: [...(project.comments || []), comment], chapters: project.chapters.map(item => item.id === chapterId ? nextChapter : item) },
    comment, selection: { from, to }
  };
}

export function updateComment(project, id, changes) {
  const existing = (project.comments || []).find(comment => comment.id === id);
  if (!existing) throw new Error('This comment no longer exists.');
  if ('resolved' in changes && typeof changes.resolved !== 'boolean') throw new Error('Invalid comment state.');
  const update = { ...existing, ...('text' in changes ? { text: textValue(changes.text) } : {}), ...('resolved' in changes ? { resolved: changes.resolved } : {}) };
  if (update.text === existing.text && update.resolved === existing.resolved) return project;
  update.updatedAt = timestamp();
  return { ...project, comments: project.comments.map(comment => comment.id === id ? update : comment) };
}

export function deleteComment(project, id, schema = editorialSchema) {
  if (!(project.comments || []).some(comment => comment.id === id)) return project;
  const chapters = project.chapters.map(chapter => {
    const ranges = commentRanges(chapter.content, id, schema);
    if (!ranges.length) return chapter;
    const doc = schema.nodeFromJSON(chapter.content);
    const transaction = new Transform(doc);
    const mark = schema.marks.commentAnchor.create({ id });
    for (const { from, to } of ranges) transaction.removeMark(from, to, mark);
    return { ...chapter, content: transaction.doc.toJSON() };
  });
  return { ...project, chapters, comments: project.comments.filter(comment => comment.id !== id) };
}
