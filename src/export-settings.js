import { normalizePrintLayout } from './print-layout.js';

export const EXPORT_SETTINGS_KEY = 'wraiter.export-settings.v1';
export const EXPORT_FORMATS = [ ['docx', 'Word document (.docx)'], ['odt', 'OpenDocument Text (.odt)'], ['pdf', 'PDF · print / standard'], ['pdf-desktop', 'PDF · desktop reading'], ['pdf-mobile', 'PDF · mobile reading'], ['epub', 'EPUB ebook'], ['txt', 'Plain text (.txt)'], ['bbcode', 'BBCode text (.txt)'], ['md', 'Markdown (.md)'], ['html', 'HTML document (.html)'], ['discord', 'Discord chat (.txt)'], ['rich-text', 'Formatted text · Telegram / email (.html)'], ['telegram-md', 'Telegram bot · MarkdownV2 (.txt)'], ['telegram-html', 'Telegram bot · HTML (.txt)'] ];
const defaults = { format: 'pdf', scope: 'manuscript', destination: 'file', colorMode: 'light', includeTitle: true, includeChapterTitles: true, customPage: false, includeContents: false, includeComments: false, includeTrackedChanges: false };

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const result = { ...defaults };
  const choices = { format: EXPORT_FORMATS.map(([id]) => id), scope: ['manuscript', 'chapter', 'selection'], destination: ['file', 'clipboard', 'preview'], colorMode: ['light', 'dark'] };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof fallback === 'boolean' ? typeof value[key] === 'boolean' : choices[key].includes(value[key])) result[key] = value[key];
  }
  for (const key of ['projectId', 'chapterId']) if (typeof value[key] === 'string' && value[key].length <= 500) result[key] = value[key];
  if (result.customPage && value.page && typeof value.page === 'object' && !Array.isArray(value.page)) result.page = normalizePrintLayout(value.page);
  return result;
}

export function defaultExportSettings(project, chapterId, initialPreview = false) {
  return { ...defaults, projectId: project.id, chapterId, destination: initialPreview ? 'preview' : 'file', page: normalizePrintLayout(project.printLayout) };
}

export function readExportSettings({ project, chapterId, hasSelection, initialPreview = false }) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY)); } catch { /* Unavailable or damaged preferences use the defaults. */ }
  const settings = { ...defaultExportSettings(project, chapterId), ...normalizeSettings(saved) };
  if (saved?.projectId !== project.id || !project.chapters.some(chapter => chapter.id === settings.chapterId)) settings.chapterId = chapterId;
  settings.projectId = project.id;
  if (settings.scope === 'selection' && !hasSelection) settings.scope = 'manuscript';
  // Print must still open a PDF preview after a clipboard or Office export.
  if (initialPreview) { if (!settings.format.startsWith('pdf')) settings.format = 'pdf'; settings.destination = 'preview'; }
  return settings;
}

export function writeExportSettings(settings) {
  // Remember a chapter only for its own manuscript; save page settings only for a custom override.
  localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}
