import { Extension, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';

function cssPoints(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(-?[\d.]+)(px|pt|in|cm|mm|pc)?$/i);
  if (!match) return null;
  return Number(match[1]) * ({ px: 0.75, pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12 }[match[2]?.toLowerCase() || 'pt'] || 1);
}
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading'], attributes: {
    pageBreakBefore: { default: null, keepOnSplit: false, parseHTML: element => ['page', 'always'].includes(element.style.breakBefore || element.style.pageBreakBefore) ? true : null, renderHTML: attrs => attrs.pageBreakBefore ? { style: 'break-before: page', 'data-page-break': 'true' } : {} },
    lineHeight: { default: null, parseHTML: element => element.style.lineHeight || null, renderHTML: attrs => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {} },
    spaceAfter: { default: null, parseHTML: element => cssPoints(element.style.marginBottom), renderHTML: attrs => attrs.spaceAfter != null ? { style: `margin-bottom: ${attrs.spaceAfter}pt` } : {} },
    firstLineIndent: { default: null, parseHTML: element => cssPoints(element.style.textIndent), renderHTML: attrs => attrs.firstLineIndent != null ? { style: `text-indent: ${attrs.firstLineIndent}pt` } : {} }
  } }]; },
  addCommands() { return { setParagraphFormat: attributes => ({ commands }) => commands.updateAttributes('paragraph', attributes) }; }
});

// Schema extensions are shared with the live editor. No browser or editor view
// is needed to validate and stage an editorial transaction in the main process.
export const documentExtensions = [
  StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: false } }),
  TextStyleKit, TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }), Image.configure({ allowBase64: true }),
  TableKit.configure({ table: { resizable: true } }), ParagraphFormat
];
export const editorialSchema = getSchema(documentExtensions);
