import { addComment, deleteComment, projectCommentRows } from './comments.js';

// Bookmarks use the same private, edit-following marks as passage comments, but
// have their own metadata and never appear in the comments panel or exports.
export function addBookmark(project, selection, label) {
  const existing = project.comments || [];
  const bookmarks = project.bookmarks || [];
  const temporary = { ...project, comments: [...existing, ...bookmarks] };
  const result = addComment(temporary, { ...selection, text: label });
  return { ...result, project: { ...result.project, comments: existing, bookmarks: [...bookmarks, result.comment] } };
}

export function removeBookmark(project, id) {
  const existing = project.comments || [];
  const bookmarks = project.bookmarks || [];
  if (!bookmarks.some(bookmark => bookmark.id === id)) return project;
  const result = deleteComment({ ...project, comments: [...existing, ...bookmarks] }, id);
  return { ...result, comments: existing, bookmarks: bookmarks.filter(bookmark => bookmark.id !== id) };
}

export function bookmarkRows(project) {
  return projectCommentRows({ ...project, comments: project.bookmarks || [] });
}
