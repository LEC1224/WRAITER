import { nodeText, uid } from '../document.js';

// Build a fresh, export-only contents list after applying the export scope.
// It is deliberately ordinary text: office apps can edit it, but it does not
// claim to be a dynamically updating field or contain estimated page numbers.
export function withExportContents(project, { includeChapterTitles = true } = {}) {
  const entries = [];
  const headings = node => {
    if (node.type === 'heading') {
      const text = nodeText(node, ' ').trim();
      if (text) entries.push({ text, level: Math.min(3, Math.max(1, Number(node.attrs?.level) || 1)) });
      return;
    }
    for (const child of node.content || []) headings(child);
  };
  for (const chapter of project.chapters) {
    if (includeChapterTitles && chapter.title.trim()) entries.push({ text: chapter.title, level: 0 });
    headings(chapter.content);
  }
  if (!entries.length) return project;
  const content = entries.map(({ text, level }) => ({ type: 'paragraph', ...(level ? { attrs: { firstLineIndent: level * 12 } } : {}), content: [{ type: 'text', text }] }));
  if (!includeChapterTitles) content.unshift({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Contents' }] });
  return { ...project, chapters: [{ id: uid(), title: 'Contents', status: 'Draft', content: { type: 'doc', content } }, ...project.chapters] };
}
