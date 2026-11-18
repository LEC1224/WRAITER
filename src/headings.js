import { editorialSchema } from '../electron/editor-schema.mjs';
import { readParsedDocument } from './document-cache.js';

const cache = new WeakMap();
export function chapterHeadings(content) {
  if (!content || typeof content !== 'object') return [];
  if (cache.has(content)) return cache.get(content);
  const headings = [];
  const doc = readParsedDocument(content, editorialSchema);
  doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return;
    headings.push({ from: position + 1, to: position + 1, level: node.attrs.level || 1, title: node.textContent.trim() || '(Empty heading)' });
    return false;
  });
  cache.set(content, headings);
  return headings;
}
