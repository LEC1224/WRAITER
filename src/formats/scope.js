import { nodeText, uid } from '../document.js';

export function exportScope(project, options = {}) {
  const scope = options.scope || 'manuscript';
  if (!['manuscript', 'chapter', 'selection'].includes(scope)) throw new Error(`Unknown export scope: ${scope}`);
  if (scope === 'manuscript') return { ...project, chapters: [...project.chapters] };
  const chapter = project.chapters.find(item => item.id === options.chapterId);
  if (scope === 'chapter') {
    if (!chapter) throw new Error('Choose a chapter to export.');
    return { ...project, title: chapter.title, chapters: [chapter] };
  }
  const content = options.selectionDoc;
  if (!content || content.type !== 'doc' || !content.content?.length || (!nodeText(content).trim() && !JSON.stringify(content).includes('"image"'))) throw new Error('Select some manuscript text to export.');
  return { ...project, title: options.selectionTitle || `${chapter?.title || project.title} — selection`, chapters: [{ id: uid(), title: options.selectionTitle || 'Selected text', status: 'Draft', content }] };
}

export function titleOptions(options = {}) {
  const scope = options.scope || 'manuscript';
  return {
    includeTitle: options.includeTitle ?? (!options.nativeSave && scope === 'manuscript'),
    includeChapterTitles: options.includeChapterTitles ?? (!options.nativeSave && scope !== 'selection'),
  };
}
