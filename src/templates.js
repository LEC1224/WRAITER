import { newProject, uid } from './document.js';
import { stripCommentAnchors } from './comments.js';

export const TEMPLATE_STORAGE_KEY = 'wraiter.templates.v1';
export function templateFromProject(project, name) {
  const title = String(name || '').trim();
  if (!title || title.length > 200) throw new Error('Enter a template name of up to 200 characters.');
  return { id: uid(), name: title, language: project.language, documentStyle: structuredClone(project.documentStyle), ...(project.printLayout ? { printLayout: structuredClone(project.printLayout) } : {}), namedStyles: structuredClone(project.namedStyles || []), layout: project.layout, showStatistics: project.showStatistics,
    chapters: project.chapters.map(chapter => ({ title: chapter.title, status: chapter.status, content: stripCommentAnchors(structuredClone(chapter.content)) })) };
}
export function projectFromTemplate(template) {
  if (!template || !Array.isArray(template.chapters) || !template.chapters.length || template.chapters.length > 2000) throw new Error('This template is damaged.');
  return { ...newProject(), language: template.language || 'en-US', documentStyle: structuredClone(template.documentStyle), ...(template.printLayout ? { printLayout: structuredClone(template.printLayout) } : {}), namedStyles: structuredClone(template.namedStyles || []), ...(template.layout ? { layout: template.layout } : {}), ...(typeof template.showStatistics === 'boolean' ? { showStatistics: template.showStatistics } : {}),
    chapters: template.chapters.map(chapter => ({ id: uid(), title: chapter.title, status: chapter.status, content: structuredClone(chapter.content) })) };
}
export function readTemplates(storage = localStorage) {
  try { const data = JSON.parse(storage.getItem(TEMPLATE_STORAGE_KEY) || '[]'); if (!Array.isArray(data) || data.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.chapters) || !item.chapters.length)) throw new Error('Invalid template data'); return data; }
  catch { throw new Error('Saved templates could not be read. Their data has not been changed.'); }
}
export function writeTemplates(templates, storage = localStorage) {
  try { storage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates)); }
  catch { throw new Error('The template could not be saved. Local template storage may be full.'); }
}
