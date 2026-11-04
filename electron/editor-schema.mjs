import { Extension, Mark, getSchema, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import TextAlign from '@tiptap/extension-text-align';
import { BackgroundColor, TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { CommentAnchor } from './comments.mjs';
import { Note } from './notes.mjs';
import { parseTabStops } from '../src/tabs.js';
import { styleIdValid } from '../src/named-styles.js';
import { TrackedChange } from './tracked-changes.mjs';

// Keep the original colour in the document and exports. Only the manuscript
// stylesheet blends this colour with the current page to keep text readable.
const ReadableHighlight = Highlight.extend({
  addAttributes() {
    const attributes = this.parent();
    return { ...attributes, color: { ...attributes.color, renderHTML: attrs => attrs.color ? {
      'data-color': attrs.color,
      style: `background-color: ${attrs.color}; color: inherit; --wraiter-highlight-color: ${attrs.color}`
    } : {} } };
  }
});
const ReadableBackgroundColor = BackgroundColor.extend({
  addGlobalAttributes() {
    return this.parent().map(group => ({ ...group, attributes: { ...group.attributes, backgroundColor: {
      ...group.attributes.backgroundColor,
      renderHTML: attrs => attrs.backgroundColor ? {
        'data-wraiter-background': '',
        style: `background-color: ${attrs.backgroundColor}; --wraiter-highlight-color: ${attrs.backgroundColor}`
      } : {}
    } } }));
  }
});
// Code removes visual character formatting, while private comment anchors must
// survive that change and must also be usable on passages already written as code.
const CommentSafeCode = Code.extend({ excludes: 'bold italic underline strike code link textStyle highlight superscript subscript' });
const CommentSafeCodeBlock = CodeBlock.extend({ marks: 'commentAnchor' });
const Superscript = Mark.create({ name: 'superscript', excludes: 'subscript', parseHTML: () => [{ tag: 'sup' }, { style: 'vertical-align=super' }], renderHTML: ({ HTMLAttributes }) => ['sup', mergeAttributes(HTMLAttributes), 0] });
const Subscript = Mark.create({ name: 'subscript', excludes: 'superscript', parseHTML: () => [{ tag: 'sub' }, { style: 'vertical-align=sub' }], renderHTML: ({ HTMLAttributes }) => ['sub', mergeAttributes(HTMLAttributes), 0] });
const NamedCharacterStyle = Mark.create({ name: 'namedStyle', addAttributes() { return { id: { default: null, parseHTML: el => el.getAttribute('data-character-style'), renderHTML: attrs => styleIdValid(attrs.id) ? { 'data-character-style': attrs.id } : {} } }; }, parseHTML: () => [{ tag: 'span[data-character-style]', getAttrs: el => styleIdValid(el.getAttribute('data-character-style')) ? null : false }], renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes), 0] });
const PositionedImage = Image.extend({
  addAttributes() {
    return { ...this.parent(), wrap: { default: null, parseHTML: element => ['left', 'right'].includes(element.getAttribute('data-image-wrap')) ? element.getAttribute('data-image-wrap') : null, renderHTML: attrs => ['left', 'right'].includes(attrs.wrap) ? { 'data-image-wrap': attrs.wrap, style: attrs.wrap === 'left' ? 'float:left;margin:0 1em 0.5em 0' : 'float:right;margin:0 0 0.5em 1em' } : {} } };
  }
});

const CellAppearance = Extension.create({ name: 'cellAppearance', addGlobalAttributes() { return [{ types: ['tableCell', 'tableHeader'], attributes: {
  cellBackground: { default: null, parseHTML: el => /^#[0-9a-f]{6}$/i.test(el.getAttribute('data-cell-background') || '') ? el.getAttribute('data-cell-background') : null, renderHTML: attrs => /^#[0-9a-f]{6}$/i.test(attrs.cellBackground || '') ? { 'data-cell-background': attrs.cellBackground, style: `background-color:${attrs.cellBackground}` } : {} },
  cellBorder: { default: null, parseHTML: el => /^#[0-9a-f]{6}$/i.test(el.getAttribute('data-cell-border') || '') ? el.getAttribute('data-cell-border') : null, renderHTML: attrs => /^#[0-9a-f]{6}$/i.test(attrs.cellBorder || '') ? { 'data-cell-border': attrs.cellBorder, style: `border:1px solid ${attrs.cellBorder}` } : {} }
} }]; } });

function cssPoints(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(-?[\d.]+)(px|pt|in|cm|mm|pc)?$/i);
  if (!match) return null;
  return Number(match[1]) * ({ px: 0.75, pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12 }[match[2]?.toLowerCase() || 'pt'] || 1);
}
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading'], attributes: {
    namedStyle: { default: null, parseHTML: element => styleIdValid(element.getAttribute('data-paragraph-style')) ? element.getAttribute('data-paragraph-style') : null, renderHTML: attrs => styleIdValid(attrs.namedStyle) ? { 'data-paragraph-style': attrs.namedStyle } : {} },
    tabStops: { default: null, parseHTML: element => { try { const value = parseTabStops(element.getAttribute('data-tab-stops')); return value.length ? value : null; } catch { return null; } }, renderHTML: attrs => Array.isArray(attrs.tabStops) && attrs.tabStops.length ? { 'data-tab-stops': attrs.tabStops.join(','), style: `tab-size:${attrs.tabStops[0]}pt` } : {} },
    pageBreakBefore: { default: null, keepOnSplit: false, parseHTML: element => ['page', 'always'].includes(element.style.breakBefore || element.style.pageBreakBefore) ? true : null, renderHTML: attrs => attrs.pageBreakBefore ? { style: 'break-before: page', 'data-page-break': 'true' } : {} },
    lineHeight: { default: null, parseHTML: element => element.style.lineHeight || null, renderHTML: attrs => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {} },
    spaceBefore: { default: null, parseHTML: element => cssPoints(element.style.marginTop), renderHTML: attrs => attrs.spaceBefore != null ? { style: `margin-top: ${attrs.spaceBefore}pt` } : {} },
    spaceAfter: { default: null, parseHTML: element => cssPoints(element.style.marginBottom), renderHTML: attrs => attrs.spaceAfter != null ? { style: `margin-bottom: ${attrs.spaceAfter}pt` } : {} },
    leftIndent: { default: null, parseHTML: element => cssPoints(element.style.marginLeft), renderHTML: attrs => attrs.leftIndent != null ? { style: `margin-left: ${attrs.leftIndent}pt` } : {} },
    rightIndent: { default: null, parseHTML: element => cssPoints(element.style.marginRight), renderHTML: attrs => attrs.rightIndent != null ? { style: `margin-right: ${attrs.rightIndent}pt` } : {} },
    firstLineIndent: { default: null, parseHTML: element => cssPoints(element.style.textIndent), renderHTML: attrs => attrs.firstLineIndent != null ? { style: `text-indent: ${attrs.firstLineIndent}pt` } : {} }
  } }]; },
  addCommands() { return { setParagraphFormat: attributes => ({ commands }) => commands.updateAttributes('paragraph', attributes) }; }
});

// Schema extensions are shared with the live editor. No browser or editor view
// is needed to validate and stage an editorial transaction in the main process.
export const documentExtensions = [
  StarterKit.configure({ undoRedo: false, code: false, codeBlock: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: false } }),
  CommentSafeCode, CommentSafeCodeBlock, Superscript, Subscript, NamedCharacterStyle,
  TextStyleKit.configure({ backgroundColor: false }), ReadableBackgroundColor, TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ReadableHighlight.configure({ multicolor: true }), PositionedImage.configure({ allowBase64: true }),
  TableKit.configure({ table: { resizable: true } }), CellAppearance, ParagraphFormat, CommentAnchor, TrackedChange, Note
];
export const editorialSchema = getSchema(documentExtensions);
