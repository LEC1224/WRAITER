import { Mark } from '@tiptap/core';

export const COMMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
export const MAX_COMMENT_TEXT = 20000;
export const MAX_COMMENTS = 5000;

// Native JSON restores anchors directly. Rich-text paste deliberately does not
// import another document's private comment identifiers or duplicate a comment.
export const CommentAnchor = Mark.create({
  name: 'commentAnchor',
  inclusive: false,
  excludes: '',
  clearable: false,
  addAttributes() { return { id: { default: null } }; },
  parseHTML() { return []; },
  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'comment-anchor', 'data-comment-id': HTMLAttributes.id }, 0];
  }
});

function mergeRange(ranges, from, to) {
  const last = ranges.at(-1);
  if (last && last.to === from) last.to = to;
  else ranges.push({ from, to });
}

// Find all anchors in one traversal, including overlapping comments and ranges
// split by formatting or paragraph boundaries. Coordinates are ProseMirror's.
export function collectCommentRanges(content, schema) {
  const doc = content?.type?.name === 'doc' ? content : schema.nodeFromJSON(content);
  const ranges = new Map();
  doc.descendants((node, pos) => {
    if (!node.isInline) return;
    for (const mark of node.marks) if (mark.type.name === 'commentAnchor' && COMMENT_ID_PATTERN.test(mark.attrs.id || '')) {
      if (!ranges.has(mark.attrs.id)) ranges.set(mark.attrs.id, []);
      mergeRange(ranges.get(mark.attrs.id), pos, pos + node.nodeSize);
    }
  });
  return ranges;
}

const rangeCache = new WeakMap();
export function commentLocations(project, schema) {
  const locations = new Map();
  for (const chapter of project.chapters) {
    let cached = rangeCache.get(chapter.content);
    if (cached?.schema !== schema) {
      cached = { schema, ranges: collectCommentRanges(chapter.content, schema) };
      rangeCache.set(chapter.content, cached);
    }
    for (const [id, ranges] of cached.ranges) {
      if (!locations.has(id)) locations.set(id, []);
      locations.get(id).push({ chapter, ranges });
    }
  }
  return locations;
}

// Moving, splitting and merging chapters move their existing marks intact.
// Reconcile the metadata's primary chapter using manuscript order, while keeping
// a removed passage's original chapter ID so its detached note remains saved.
export function reconcileCommentChapters(project, schema) {
  if (!project.comments?.length) return project;
  const locations = commentLocations(project, schema);
  let changed = false;
  const comments = project.comments.map(comment => {
    const chapterId = locations.get(comment.id)?.[0]?.chapter.id;
    if (!chapterId || chapterId === comment.chapterId) return comment;
    changed = true;
    return { ...comment, chapterId };
  });
  return changed ? { ...project, comments } : project;
}

export function stripCommentAnchors(content) {
  if (!content || typeof content !== 'object') return content;
  const children = content.content?.map(stripCommentAnchors);
  const marks = content.marks?.filter(mark => mark.type !== 'commentAnchor');
  const changedChildren = children?.some((child, index) => child !== content.content[index]);
  if (!changedChildren && (!marks || marks.length === content.marks.length)) return content;
  const next = { ...content };
  if (children) next.content = children;
  if (marks?.length) next.marks = marks;
  else if (marks) delete next.marks;
  return next;
}
