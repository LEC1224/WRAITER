import DOMPurify from 'dompurify';
import { generateHTML, getSchema } from '@tiptap/core';
import { DOMParser as ProseMirrorParser } from '@tiptap/pm/model';
import JSZip from 'jszip';
import MarkdownIt from 'markdown-it';
import { newProject, uid, paragraph, nodeText, blockMarkup, inlineMarkup } from './document.js';
import { toODT } from './formats/odt.js';
import { toEPUB } from './formats/epub.js';
import { exportScope, titleOptions } from './formats/scope.js';
import { addStructure, readStructure, loadOfficePackage } from './formats/package.js';
import { formatLosses } from './formats/losses.js';
export { exportScope } from './formats/scope.js';

const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RASTER_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const MAX_XML = 30 * 1024 * 1024;
const DEFAULT_DOCUMENT_STYLE = { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 };
function documentStyle(project) { return { ...DEFAULT_DOCUMENT_STYLE, ...(project.documentStyle || {}) }; }
function points(value) {
  const match = String(value ?? '').trim().match(/^(-?[\d.]+)(pt|px|in|cm|mm|pc)?$/i);
  if (!match || !Number.isFinite(Number(match[1]))) return null;
  return Number(match[1]) * ({ pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12 }[match[2]?.toLowerCase() || 'pt']);
}
function lineRatio(value, fallback = 1.5) {
  const match = String(value ?? '').match(/^([\d.]+)(%)?$/);
  return match && Number(match[1]) > 0 ? Number(match[1]) / (match[2] ? 100 : 1) : fallback;
}
const cssString = value => String(value).replace(/[\\"<>\x00-\x1f]/g, character => `\\${character.charCodeAt(0).toString(16)} `);
function generateJSON(html, extensions) {
  const container = document.createElement('div'); container.innerHTML = html;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT), whitespace = [];
  const containers = new Set(['DIV', 'BODY', 'HTML', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH']);
  while (walker.nextNode()) if (containers.has(walker.currentNode.parentElement.tagName) && !walker.currentNode.textContent.trim()) whitespace.push(walker.currentNode);
  whitespace.forEach(node => node.remove());
  // HTML's default collapsing parser loses tabs, repeated spaces, and spaces at
  // paragraph edges. Office files and native HTML must retain author wording.
  return ProseMirrorParser.fromSchema(getSchema(extensions)).parse(container, { preserveWhitespace: 'full' }).toJSON();
}

// Imports are self-contained; opening one must not fetch external image URLs.
export function safeHTML(html) {
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'form', 'video', 'audio'], FORBID_ATTR: ['srcset'] });
  for (const img of fragment.querySelectorAll('img')) {
    if (!RASTER_DATA.test(img.getAttribute('src') || '')) img.replaceWith(document.createTextNode(`[Image not embedded: ${img.getAttribute('alt') || 'external or unsupported image'}]`));
    else img.setAttribute('src', img.getAttribute('src').replace(/^data:image\/jpg;/i, 'data:image/jpeg;'));
  }
  for (const link of fragment.querySelectorAll('a[href]')) if (!/^(https?:|mailto:)/i.test(link.getAttribute('href'))) link.removeAttribute('href');
  const allowed = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'background-color', 'text-align', 'text-decoration', 'text-decoration-line', 'white-space', 'line-height', 'margin-bottom', 'text-indent', 'break-before', 'page-break-before']);
  for (const element of fragment.querySelectorAll('[style]')) {
    for (const property of [...element.style]) {
      const value = element.style.getPropertyValue(property);
      if (!allowed.has(property) || /url\s*\(|expression\s*\(|var\s*\(/i.test(value)) element.style.removeProperty(property);
    }
  }
  const container = document.createElement('div'); container.append(fragment);
  return container.innerHTML;
}

const NS = { office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0', table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', xlink: 'http://www.w3.org/1999/xlink', svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0' };
const attr = (node, key) => { const [prefix, name] = key.split(':'); return node?.getAttributeNS?.(NS[prefix], name) || ''; };
const elements = (node, prefix, name) => [...node.getElementsByTagNameNS(NS[prefix], name)];
function boundedCount(value, maximum, label) {
  const count = value ? Number(value) : 1;
  if (!Number.isInteger(count) || count < 1 || count > maximum) throw new Error(`This ODT has an unsupported ${label}; import stopped to avoid losing content.`);
  return count;
}
function parseXML(source) {
  if (source.length > MAX_XML) throw new Error('The expanded document XML is too large for this preview.');
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('The document contains invalid XML.');
  return xml;
}
function xmlText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.localName === 's') return ' '.repeat(boundedCount(attr(node, 'text:c'), 10000, 'space repeat count'));
  if (node.localName === 'tab') return '\t';
  if (node.localName === 'line-break') return '\n';
  return [...node.childNodes].map(xmlText).join('') + (['p', 'h'].includes(node.localName) ? '\n' : '');
}
async function importODT(bytes) {
  const zip = await loadOfficePackage(bytes), entry = zip.file('content.xml');
  if (!entry) throw new Error('This ODT has no document content.');
  const xml = parseXML(await entry.async('string'));
  const sources = zip.file('styles.xml') ? [parseXML(await zip.file('styles.xml').async('string')), xml] : [xml];
  const styles = new Map(), defaults = new Map(), fonts = new Map(), lists = new Map(), images = new Map();
  const notes = [], losses = new Set();
  for (const source of sources) {
    for (const font of elements(source, 'style', 'font-face')) fonts.set(attr(font, 'style:name'), attr(font, 'svg:font-family').replace(/^['"]|['"]$/g, ''));
    for (const style of elements(source, 'style', 'default-style')) defaults.set(attr(style, 'style:family'), style);
    for (const style of elements(source, 'style', 'style')) styles.set(`${attr(style, 'style:family')}:${attr(style, 'style:name')}`, style);
    for (const list of elements(source, 'text', 'list-style')) lists.set(attr(list, 'style:name'), list);
  }
  function styleProperties(style) {
    if (!style) return {};
    const props = elements(style, 'style', 'text-properties')[0], para = elements(style, 'style', 'paragraph-properties')[0], result = {};
    for (const name of ['font-weight', 'font-style', 'font-size', 'color', 'background-color']) { const value = attr(props, `fo:${name}`); if (value) result[name] = value; }
    const font = attr(props, 'fo:font-family') || fonts.get(attr(props, 'style:font-name'));
    if (font) result['font-family'] = font;
    const underline = attr(props, 'style:text-underline-style'), strike = attr(props, 'style:text-line-through-style');
    if (underline || strike) result['text-decoration'] = [underline && underline !== 'none' ? 'underline' : '', strike && strike !== 'none' ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    const align = attr(para, 'fo:text-align');
    if (align) result['text-align'] = ({ start: 'left', end: 'right' })[align] || align;
    const line = attr(para, 'fo:line-height');
    if (attr(para, 'fo:break-before') === 'page') result['break-before'] = 'page';
    if (line && line !== 'normal') result['line-height'] = line;
    for (const name of ['margin-bottom', 'text-indent']) {
      const value = points(attr(para, `fo:${name}`));
      if (value != null) result[name] = `${Number(value.toFixed(4))}pt`;
    }
    return result;
  }
  function resolvedStyle(name, family, seen = new Set()) {
    const key = `${family}:${name}`, style = styles.get(key);
    if (!style || seen.has(key)) return styleProperties(defaults.get(family));
    seen.add(key);
    const parent = attr(style, 'style:parent-style-name');
    return { ...(parent ? resolvedStyle(parent, family, seen) : styleProperties(defaults.get(family))), ...styleProperties(style) };
  }
  for (const image of elements(xml, 'draw', 'image')) {
    const path = attr(image, 'xlink:href').replace(/^\.\//, ''), imageEntry = zip.file(path);
    const mime = ({ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' })[path.split('.').pop().toLowerCase()];
    if (imageEntry && mime) {
      const data = await imageEntry.async('uint8array');
      if (data.length <= 12 * 1024 * 1024) images.set(image, `data:image/${mime};base64,${await imageEntry.async('base64')}`);
      else losses.add('Images larger than 12 MB were replaced with placeholders.');
    } else losses.add('External or unsupported images were replaced with placeholders.');
  }
  function convert(node, listDepth = 1) {
    if (node.nodeType === 3) return escape(node.textContent);
    if (node.nodeType !== 1) return '';
    const tag = `${Object.keys(NS).find(key => NS[key] === node.namespaceURI)}:${node.localName}`;
    if (tag === 'text:tracked-changes') { losses.add('Tracked change history is omitted; the visible manuscript text is imported.'); return ''; }
    if (tag === 'text:hidden-text') { notes.push(`Imported hidden text\n${xmlText(node).trim()}`); losses.add('Hidden text is kept in Project notes instead of being exposed in the manuscript.'); return ''; }
    if (['text:sequence-decls', 'text:variable-decls', 'text:user-field-decls', 'office:forms', 'text:change', 'text:change-start', 'text:change-end', 'office:annotation-end'].includes(tag)) return '';
    if (tag === 'office:annotation') { notes.push(`Imported comment\n${xmlText(node).trim()}`); losses.add('Comments and notes are preserved as plain text in Project notes.'); return ''; }
    if (tag === 'text:note') {
      const citation = elements(node, 'text', 'note-citation')[0]?.textContent || String(notes.length + 1), body = elements(node, 'text', 'note-body')[0];
      notes.push(`Imported note [${citation}]\n${body ? xmlText(body).trim() : ''}`);
      losses.add('Comments and notes are preserved as plain text in Project notes.');
      return escape(`[${citation}]`);
    }
    if (tag === 'text:s') return ' '.repeat(boundedCount(attr(node, 'text:c'), 10000, 'space repeat count'));
    if (tag === 'text:tab') return '\t';
    if (tag === 'text:line-break') return '<br>';
    if (tag === 'svg:desc' || tag === 'svg:title') return '';
    if (tag === 'draw:image') {
      const width = points(attr(node.parentElement, 'svg:width')), height = points(attr(node.parentElement, 'svg:height'));
      return images.has(node) ? `<img src="${images.get(node)}" alt="${escape(attr(node.parentElement, 'draw:name') || 'Imported image')}"${width ? ` width="${width / 0.75}"` : ''}${height ? ` height="${height / 0.75}"` : ''}>` : '[Image not imported]';
    }
    if (tag === 'table:covered-table-cell') return '';
    let inner = [...node.childNodes].map(child => convert(child, tag === 'text:list' ? listDepth + 1 : listDepth)).join('');
    const family = ['text:p', 'text:h'].includes(tag) ? 'paragraph' : 'text', properties = resolvedStyle(attr(node, 'text:style-name'), family);
    const paragraphProperties = new Set(['text-align', 'line-height', 'margin-bottom', 'text-indent', 'break-before']);
    const css = Object.entries(properties).filter(([name]) => !paragraphProperties.has(name)).map(([name, value]) => `${name}:${value}`).join(';');
    if (css && ['text:p', 'text:h', 'text:span'].includes(tag)) inner = `<span style="${escape(css)}">${inner}</span>`;
    const paragraphCSS = Object.entries(properties).filter(([name]) => paragraphProperties.has(name)).map(([name, value]) => `${name}:${value}`).join(';');
    const alignment = ` style="white-space:pre-wrap;${escape(paragraphCSS)}"`;
    if (tag === 'text:p') {
      const name = attr(node, 'text:style-name'), parent = attr(styles.get(`paragraph:${name}`), 'style:parent-style-name');
      if (name === 'Wraiter_Rule') return '<hr>';
      if (name === 'Wraiter_Code') return `<pre><code>${inner}</code></pre>`;
      return name === 'Wraiter_Quote' || parent === 'Wraiter_Quote' ? `<blockquote><p${alignment}>${inner}</p></blockquote>` : `<p${alignment}>${inner}</p>`;
    }
    if (tag === 'text:h') { const level = Math.min(3, Math.max(1, Number(attr(node, 'text:outline-level')) || 1)); return `<h${level}${alignment}>${inner}</h${level}>`; }
    if (tag === 'text:list') {
      let listStyle = lists.get(attr(node, 'text:style-name'));
      if (!listStyle) { let parent = node.parentElement; while (parent && !listStyle) { listStyle = lists.get(attr(parent, 'text:style-name')); parent = parent.parentElement; } }
      const level = listStyle && [...listStyle.children].find(child => Number(attr(child, 'text:level')) === listDepth), ordered = level?.localName === 'list-level-style-number';
      const first = [...node.children].find(child => child.localName === 'list-item'), start = Math.max(1, Number(attr(first, 'text:start-value') || attr(level, 'text:start-value')) || 1);
      if (attr(node, 'text:continue-numbering') === 'true' || attr(node, 'text:continue-list')) losses.add('Continued list numbering may restart; review list starts.');
      if (ordered && attr(level, 'style:num-format') && attr(level, 'style:num-format') !== '1') losses.add('Lettered and Roman numeral lists use decimal numbering.');
      return ordered ? `<ol start="${start}">${inner}</ol>` : `<ul>${inner}</ul>`;
    }
    if (tag === 'text:list-item' || tag === 'text:list-header') return `<li>${inner}</li>`;
    if (tag === 'table:table') return `<table>${inner}</table>`;
    if (tag === 'table:table-row') return `<tr>${inner}</tr>`.repeat(boundedCount(attr(node, 'table:number-rows-repeated'), 1000, 'table row repeat count'));
    if (tag === 'table:table-cell') {
      const colspan = boundedCount(attr(node, 'table:number-columns-spanned'), 100, 'table column span'), rowspan = boundedCount(attr(node, 'table:number-rows-spanned'), 1000, 'table row span');
      const cellTag = attr(node, 'table:style-name') === 'WHeaderCell' || node.parentElement?.parentElement?.localName === 'table-header-rows' ? 'th' : 'td';
      return `<${cellTag} colspan="${colspan}" rowspan="${rowspan}">${inner || '<p></p>'}</${cellTag}>`.repeat(boundedCount(attr(node, 'table:number-columns-repeated'), 100, 'table column repeat count'));
    }
    if (tag === 'text:a') return `<a href="${escape(attr(node, 'xlink:href'))}">${inner}</a>`;
    return inner;
  }
  const body = elements(xml, 'office', 'text')[0];
  if (!body) throw new Error('No manuscript text was found in this ODT.');
  const html = convert(body);
  const defaultParagraph = defaults.get('paragraph'), defaultProperties = styleProperties(defaultParagraph);
  const runProperties = defaultParagraph && elements(defaultParagraph, 'style', 'text-properties')[0];
  const languageCode = attr(runProperties, 'fo:language'), country = attr(runProperties, 'fo:country');
  const language = languageCode && languageCode !== 'none' ? `${languageCode}${country && country !== 'none' ? '-' + country : ''}` : undefined;
  const structure = await readStructure(zip, 'content.xml');
  if (!structure) {
    const present = (prefix, name) => sources.some(source => elements(source, prefix, name).length);
    for (const [prefix, name, message] of [
      ['style', 'header', 'Page headers are not editable and will not be retained when saving.'],
      ['style', 'footer', 'Page footers are not editable and will not be retained when saving.'],
      ['style', 'tab-stops', 'Custom tab stops are replaced by default tab spacing.'],
      ['style', 'columns', 'Multiple text columns are saved as a single column.'],
      ['text', 'section', 'Text sections are flattened into the manuscript.'],
      ['text', 'table-of-content', 'The table of contents becomes ordinary text and will no longer update.'],
      ['text', 'page-number', 'Dynamic page numbers become ordinary text.'],
      ['text', 'variable-set', 'Document variables become ordinary text.'],
      ['text', 'variable-get', 'Document variables become ordinary text.'],
      ['text', 'user-field-get', 'Custom fields become ordinary text.'],
      ['text', 'sequence', 'Numbering fields become ordinary text and no longer update.'],
      ['text', 'date', 'Date fields become ordinary text and no longer update.'],
      ['text', 'time', 'Time fields become ordinary text and no longer update.'],
      ['text', 'page-count', 'Page count fields become ordinary text and no longer update.'],
      ['text', 'bookmark-ref', 'Bookmark references become ordinary text.'],
      ['text', 'reference-ref', 'Cross-references become ordinary text.'],
      ['text', 'ruby', 'Ruby annotations are flattened into ordinary text.'],
      ['text', 'bookmark', 'Document bookmarks are not retained.'],
      ['text', 'bookmark-start', 'Document bookmarks are not retained.'],
      ['draw', 'object', 'Embedded objects are not supported.'],
      ['draw', 'text-box', 'Floating text boxes are flattened into text.'],
      ['draw', 'custom-shape', 'Custom drawing shapes are not supported.'],
      ['draw', 'rect', 'Drawing shapes are not supported.'],
      ['draw', 'ellipse', 'Drawing shapes are not supported.'],
      ['draw', 'line', 'Drawing shapes are not supported.'],
    ]) if (present(prefix, name)) losses.add(message);
    if (sources.some(source => elements(source, 'style', 'page-layout-properties').length)) losses.add('Page size, margins, and page styles are replaced by WRAITER’s standard page layout when saving.');
    if (sources.some(source => elements(source, 'style', 'style').length)) losses.add('Named styles are saved as direct text formatting; editing the original style definitions is not supported.');
    if (elements(xml, 'draw', 'frame').some(frame => attr(frame, 'text:anchor-type') && attr(frame, 'text:anchor-type') !== 'as-char')) losses.add('Floating images are placed in the text flow; their page anchoring and wrapping are not retained.');
  }
  const chapters = structure?.chapters.map(chapter => ({ ...chapter, html: [...body.children].slice(chapter.start, chapter.end).map(node => convert(node)).join('') }));
  return { html, chapters, title: structure?.title, language, documentStyle: { fontFamily: defaultProperties['font-family'] || DEFAULT_DOCUMENT_STYLE.fontFamily, fontSize: points(defaultProperties['font-size']) || DEFAULT_DOCUMENT_STYLE.fontSize, lineHeight: lineRatio(defaultProperties['line-height']) }, notes: notes.join('\n\n'), warnings: [...losses] };
}

// Mammoth retains document structure. Enrich matching paragraphs with their OOXML layout,
// rather than rebuilding lists, hyperlinks, notes, tables, and images a second time.
async function docxTypography(bytes, html) {
  const zip = await loadOfficePackage(bytes), word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const source = zip.file('word/document.xml');
  if (!source) return { html };
  const xml = parseXML(await source.async('string'));
  const styles = zip.file('word/styles.xml') ? parseXML(await zip.file('word/styles.xml').async('string')) : null;
  const children = (node, name) => node ? [...node.children].filter(child => child.namespaceURI === word && child.localName === name) : [];
  const child = (node, name) => children(node, name)[0];
  const property = (node, name) => node?.getAttributeNS(word, name) || '';
  const runStyle = node => {
    const fontFamily = property(child(node, 'rFonts'), 'ascii') || property(child(node, 'rFonts'), 'hAnsi');
    const size = Number(property(child(node, 'sz'), 'val')) / 2;
    const color = property(child(node, 'color'), 'val'), fill = property(child(node, 'shd'), 'fill');
    return { ...(fontFamily ? { fontFamily } : {}), ...(size > 0 ? { fontSize: size } : {}), ...(/^[a-f0-9]{6}$/i.test(color) ? { color: `#${color}` } : {}), ...(/^[a-f0-9]{6}$/i.test(fill) ? { backgroundColor: `#${fill}` } : {}), ...(property(child(node, 'lang'), 'val') ? { language: property(child(node, 'lang'), 'val') } : {}) };
  };
  const paragraphStyle = node => {
    const spacing = child(node, 'spacing'), indent = child(node, 'ind'), result = {};
    const pageBreak = child(node, 'pageBreakBefore');
    if (pageBreak) result.pageBreakBefore = !['0', 'false', 'off'].includes(property(pageBreak, 'val'));
    const after = property(spacing, 'after'), line = property(spacing, 'line'), rule = property(spacing, 'lineRule');
    if (after !== '' && Number.isFinite(Number(after))) result.spaceAfter = Number(after) / 20;
    if (line && Number(line) > 0) result.lineHeight = rule && rule !== 'auto' ? `${Number(line) / 20}pt` : Number(line) / 240;
    const first = property(indent, 'firstLine'), hanging = property(indent, 'hanging');
    if (first !== '' && Number.isFinite(Number(first))) result.firstLineIndent = Number(first) / 20;
    else if (hanging !== '' && Number.isFinite(Number(hanging))) result.firstLineIndent = -Number(hanging) / 20;
    const alignment = property(child(node, 'jc'), 'val');
    if (alignment) result.textAlign = ({ both: 'justify', start: 'left', end: 'right' })[alignment] || alignment;
    return result;
  };
  const styleMap = new Map(styles ? [...styles.getElementsByTagNameNS(word, 'style')].map(style => [property(style, 'styleId'), style]) : []);
  const defaultNode = styles?.getElementsByTagNameNS(word, 'docDefaults')[0];
  const runDefaults = runStyle(child(child(defaultNode, 'rPrDefault'), 'rPr'));
  const paraDefaults = paragraphStyle(child(child(defaultNode, 'pPrDefault'), 'pPr'));
  const normal = [...styleMap.values()].find(style => property(style, 'type') === 'paragraph' && property(style, 'default') === '1');
  function resolved(id, seen = new Set()) {
    const style = styleMap.get(id);
    if (!style || seen.has(id)) return {};
    seen.add(id);
    return { ...resolved(property(child(style, 'basedOn'), 'val'), seen), ...runStyle(child(style, 'rPr')), ...paragraphStyle(child(style, 'pPr')) };
  }
  const base = { ...runDefaults, ...paraDefaults, ...resolved(property(normal, 'styleId')) };
  const rawParagraphs = [...xml.getElementsByTagNameNS(word, 'p')].map(paragraph => {
    const properties = child(paragraph, 'pPr');
    const style = { ...base, ...resolved(property(child(properties, 'pStyle'), 'val')), ...paragraphStyle(properties) };
    let offset = 0;
    const runs = [...paragraph.getElementsByTagNameNS(word, 'r')].map(run => {
      const value = [...run.children].map(node => node.localName === 't' ? node.textContent : node.localName === 'tab' ? '\t' : '').join('');
      const start = offset; offset += value.length;
      const runProperties = child(run, 'rPr');
      return { start, end: offset, value, style: { ...style, ...resolved(property(child(runProperties, 'rStyle'), 'val')), ...runStyle(runProperties) } };
    });
    const value = runs.map(run => run.value).join('');
    return { text: value.replace(/\s+/g, ' ').trim(), value, runs, style };
  });
  const container = document.createElement('div'); container.innerHTML = html;
  let cursor = 0;
  for (const paragraph of container.querySelectorAll('p,h1,h2,h3,h4,h5,h6')) {
    const text = paragraph.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const index = rawParagraphs.findIndex((candidate, position) => position >= cursor && candidate.text === text);
    if (index < 0) continue;
    cursor = index + 1; const candidate = rawParagraphs[index], style = candidate.style;
    if (style.lineHeight != null) paragraph.style.lineHeight = String(style.lineHeight);
    if (style.spaceAfter != null) paragraph.style.marginBottom = `${style.spaceAfter}pt`;
    if (style.firstLineIndent != null) paragraph.style.textIndent = `${style.firstLineIndent}pt`;
    if (style.pageBreakBefore) paragraph.style.breakBefore = 'page';
    if (['left', 'center', 'right', 'justify'].includes(style.textAlign)) paragraph.style.textAlign = style.textAlign;
    if (paragraph.textContent === candidate.value) {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT), texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      let start = 0;
      for (const node of texts) {
        const end = start + node.textContent.length, fragment = document.createDocumentFragment();
        for (const run of candidate.runs) {
          const a = Math.max(start, run.start), b = Math.min(end, run.end);
          if (a >= b) continue;
          const span = document.createElement('span'); span.textContent = node.textContent.slice(a - start, b - start);
          for (const property of ['fontFamily', 'color', 'backgroundColor']) if (run.style[property]) span.style[property] = run.style[property];
          if (run.style.fontSize) span.style.fontSize = `${run.style.fontSize}pt`;
          fragment.append(span);
        }
        if (fragment.childNodes.length) node.replaceWith(fragment);
        start = end;
      }
    } else if (style.fontFamily || style.fontSize) {
      const span = document.createElement('span');
      if (style.fontFamily) span.style.fontFamily = style.fontFamily;
      if (style.fontSize) span.style.fontSize = `${style.fontSize}pt`;
      while (paragraph.firstChild) span.append(paragraph.firstChild);
      paragraph.append(span);
    }
  }
  return { html: container.innerHTML, language: base.language, documentStyle: { fontFamily: base.fontFamily || DEFAULT_DOCUMENT_STYLE.fontFamily, fontSize: base.fontSize || DEFAULT_DOCUMENT_STYLE.fontSize, lineHeight: lineRatio(base.lineHeight) } };
}

async function importDOCX(bytes, extensions) {
  const zip = await loadOfficePackage(bytes), mammoth = await import('mammoth/mammoth.browser');
  const original = await zip.file('word/document.xml')?.async('string');
  if (!original) throw new Error('This DOCX has no document content.');
  const structure = await readStructure(zip, 'word/document.xml'), warnings = new Set();
  const convert = async data => {
    const array = data instanceof Uint8Array ? data : new Uint8Array(data);
    const result = await mammoth.convertToHtml({ arrayBuffer: array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength) }, { styleMap: ['u => u', 'strike => s'], ignoreEmptyParagraphs: false });
    for (const message of result.messages) warnings.add(message.message);
    const typography = await docxTypography(array, safeHTML(result.value));
    return { ...typography, content: generateJSON(safeHTML(typography.html), extensions) };
  };
  const result = await convert(bytes);
  if (structure) {
    const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const originalXML = parseXML(original), originalBody = originalXML.getElementsByTagNameNS(word, 'body')[0], nodes = [...originalBody.children];
    result.chapters = [];
    for (const chapter of structure.chapters) {
      const xml = parseXML(original), body = xml.getElementsByTagNameNS(word, 'body')[0];
      while (body.firstChild) body.removeChild(body.firstChild);
      nodes.slice(chapter.start, chapter.end).forEach(node => body.append(xml.importNode(node, true)));
      const section = nodes.find(node => node.localName === 'sectPr');
      if (section) body.append(xml.importNode(section, true));
      zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
      const converted = await convert(await zip.generateAsync({ type: 'uint8array' }));
      result.chapters.push({ id: chapter.id, title: chapter.title, status: chapter.status || 'Draft', content: converted.content });
    }
    result.title = structure.title;
  } else {
    const xml = parseXML(original), word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    for (const [tag, warning] of [
      ['ins', 'Tracked insertions become ordinary text; their revision history is not retained.'],
      ['del', 'Tracked deletions and their revision history are not retained.'],
      ['fldChar', 'Dynamic fields become their current displayed text and no longer update.'],
      ['fldSimple', 'Dynamic fields become their current displayed text and no longer update.'],
      ['tabs', 'Custom tab stops are replaced by default tab spacing.'],
      ['txbxContent', 'Floating text boxes are flattened or omitted.'],
      ['commentRangeStart', 'Anchored comments are not retained.'],
      ['footnoteReference', 'Footnotes are converted to ordinary text; their page positioning is not retained.'],
      ['endnoteReference', 'Endnotes are converted to ordinary text.'],
      ['object', 'Embedded objects are not supported.'],
      ['bookmarkStart', 'Document bookmarks are not retained.'],
      ['altChunk', 'Embedded external document content is not supported.'],
      ['sdt', 'Content controls become ordinary editable content.'],
      ['vanish', 'Hidden run formatting is not retained; review any hidden content.'],
      ['vertAlign', 'Superscript and subscript text is saved on the ordinary baseline.'],
    ]) if (xml.getElementsByTagNameNS(word, tag).length) warnings.add(warning);
    if (Object.keys(zip.files).some(path => /^word\/header\d*\.xml$/.test(path))) warnings.add('Page headers are not editable and will not be retained when saving.');
    if (Object.keys(zip.files).some(path => /^word\/footer\d*\.xml$/.test(path))) warnings.add('Page footers are not editable and will not be retained when saving.');
    if ([...xml.getElementsByTagNameNS(word, 'cols')].some(node => Number(node.getAttributeNS(word, 'num')) > 1)) warnings.add('Multiple text columns are saved as a single column.');
    if (xml.getElementsByTagNameNS(word, 'sectPr').length) warnings.add('Page sections, size, and margins are replaced by WRAITER’s standard page layout when saving.');
    if (zip.file('word/styles.xml')) warnings.add('Named document styles are saved as direct formatting; the original style definitions are not retained.');
    if ([...xml.getElementsByTagNameNS(word, 'hyperlink')].some(link => link.hasAttributeNS(word, 'anchor'))) warnings.add('Internal document links become ordinary text.');
    if (xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart').length) warnings.add('Charts are not editable and will not be retained when saving.');
    if (xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'oMath').length) warnings.add('Equation objects are not supported.');
    if (xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'anchor').length) warnings.add('Floating image anchoring and text wrapping are not retained.');
  }
  return { ...result, warnings: [...warnings] };
}

export async function importDocument(payload, extensions) {
  const project = newProject(); project.title = payload.name || 'Imported manuscript';
  let content, warning = '', warnings = [], chapters;
  const bytes = new Uint8Array(payload.bytes), extension = payload.extension.toLowerCase();
  const fidelity = { format: extension.replace(/^\./, ''), warnings: [], requiresReview: false };
  if (extension === '.docx') {
    const result = await importDOCX(bytes, extensions);
    content = result.content; chapters = result.chapters; warnings = result.warnings;
    if (result.documentStyle) project.documentStyle = result.documentStyle;
    if (result.language) project.language = result.language;
    if (result.title) project.title = result.title;
  } else if (extension === '.odt') {
    const result = await importODT(bytes);
    content = generateJSON(safeHTML(result.html), extensions); warnings = result.warnings; project.notes = result.notes;
    chapters = result.chapters?.map(chapter => ({ id: chapter.id, title: chapter.title, status: chapter.status || 'Draft', content: generateJSON(safeHTML(chapter.html), extensions) }));
    project.documentStyle = result.documentStyle;
    if (result.language) project.language = result.language;
    if (result.title) project.title = result.title;
  } else {
    let text;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { fidelity.encoding = 'utf-16le'; fidelity.bom = true; text = new TextDecoder('utf-16le').decode(bytes); }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { fidelity.encoding = 'utf-16be'; fidelity.bom = true; text = new TextDecoder('utf-16be').decode(bytes); }
    else {
      fidelity.encoding = 'utf-8'; fidelity.bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { text = new TextDecoder('windows-1252').decode(bytes); warnings.push('This file is not valid UTF-8. It was read using Windows-1252 and will be saved as UTF-8; review accented characters before saving.'); }
    }
    fidelity.lineEnding = text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
    text = text.replace(/\r\n?/g, '\n');
    if (['.html', '.htm'].includes(extension)) {
      content = generateJSON(safeHTML(text), extensions);
      const html = new DOMParser().parseFromString(text, 'text/html'), marker = html.querySelector('meta[name="wraiter:document"]');
      if (marker) try {
        const meta = JSON.parse(marker.content);
        if (meta.version === 1) {
          if (typeof meta.title === 'string') project.title = meta.title;
          if (meta.documentStyle && typeof meta.documentStyle.fontFamily === 'string' && Number(meta.documentStyle.fontSize) >= 6 && Number(meta.documentStyle.fontSize) <= 96 && Number(meta.documentStyle.lineHeight) >= 0.8 && Number(meta.documentStyle.lineHeight) <= 3) project.documentStyle = meta.documentStyle;
          if (html.documentElement.lang) project.language = html.documentElement.lang;
          chapters = [...html.body.querySelectorAll('section[data-wraiter-chapter]')].map(section => {
            const heading = section.querySelector(':scope > [data-wraiter-chapter-title]'); if (heading) heading.remove();
            return { id: section.dataset.wraiterChapter || uid(), title: section.dataset.title || 'Manuscript', status: 'Draft', content: generateJSON(safeHTML(section.innerHTML), extensions) };
          });
        }
      } catch { /* Unknown application metadata never overrides visible HTML. */ }
      if (!marker) warnings.push('Custom HTML stylesheets, page layouts, active content, and externally linked images are not retained.');
      if (html.querySelector('script,iframe,object,embed,form,video,audio')) warnings.push('Active or embedded HTML content is removed.');
      if ([...html.querySelectorAll('img')].some(image => !RASTER_DATA.test(image.getAttribute('src') || ''))) warnings.push('Externally linked or unsupported images are replaced by labelled placeholders.');
    } else if (['.md', '.markdown'].includes(extension)) {
      const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false, breaks: false });
      content = generateJSON(safeHTML(markdown.render(text)), extensions);
      if (/<(?:iframe|script|style|video|audio|object)\b/i.test(text)) warnings.push('Embedded active HTML is removed from Markdown.');
      if (/!\[[^\]]*\]\((?!<?data:image\/)/.test(text)) warnings.push('Externally linked Markdown images are replaced with labelled placeholders.');
    } else content = { type: 'doc', content: text.split('\n').map(paragraph) };
  }
  if (!content.content?.length) content.content = [paragraph('')];
  project.chapters = chapters?.length ? chapters : [{ id: uid(), title: 'Manuscript', status: 'Draft', content }];
  for (const chapter of project.chapters) if (!chapter.content.content?.length) chapter.content.content = [paragraph('')];
  fidelity.warnings = warnings; fidelity.requiresReview = warnings.length > 0; warning = warnings.join(' ');
  if (['md', 'markdown'].includes(fidelity.format)) {
    for (const loss of formatLosses(project, 'md')) if (!fidelity.warnings.includes(loss)) fidelity.warnings.push(loss);
    fidelity.requiresReview = fidelity.warnings.length > 0; warning = fidelity.warnings.join(' ');
  }
  return { project, warning, fidelity };
}

export function publicationHTML(project, extensions, options = {}) {
  const titles = titleOptions(options), preset = options.pdfPreset || 'standard', dark = options.colorMode === 'dark';
  const pages = { standard: { size: 'A4', margin: '22mm', width: '720px', sizeScale: 1 }, desktop: { size: '180mm 255mm', margin: '18mm', width: '680px', sizeScale: 1.08 }, mobile: { size: '105mm 187mm', margin: '9mm 8mm', width: '100%', sizeScale: 1 } };
  const page = pages[preset] || pages.standard;
  const body = project.chapters.map(c => `<section data-wraiter-chapter="${escape(c.id)}" data-title="${escape(c.title)}">${titles.includeChapterTitles ? `<h1 data-wraiter-chapter-title="true">${escape(c.title)}</h1>` : ''}${safeHTML(generateHTML(c.content, extensions))}</section>`).join('');
  const style = documentStyle(project), metadata = { version: 1, title: project.title, documentStyle: style };
  return `<!doctype html><html lang="${escape(project.language || 'en-US')}"><head><meta charset="utf-8"><meta name="wraiter:document" content="${escape(JSON.stringify(metadata))}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escape(project.title)}</title><style>@page{size:${page.size};margin:${page.margin};background:${dark ? '#1b1d20' : '#fff'}}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:${dark ? '#1b1d20' : '#fff'}}body{font-family:"${cssString(style.fontFamily)}",serif;font-size:${Number((style.fontSize * page.sizeScale).toFixed(2))}pt;line-height:${style.lineHeight};color:${dark ? '#e4e5e7' : '#222'};background:${dark ? '#1b1d20' : 'white'};max-width:${page.width};margin:0 auto;overflow-wrap:break-word}h1,h2,h3{line-height:1.3;break-after:avoid}h1{font-size:${preset === 'mobile' ? '20' : '25'}pt;margin:0 0 1em}.book-title{font-size:${preset === 'mobile' ? '25' : '32'}pt;margin:1em 0 2em}p{orphans:3;widows:3;white-space:pre-wrap;margin:0 0 0.8em}section+section{break-before:page}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin:1em 0;table-layout:fixed}td,th{border:1px solid #999;padding:${preset === 'mobile' ? '3' : '6'}px;overflow-wrap:anywhere}blockquote{border-left:2px solid #aaa;margin-left:0;padding-left:1em}a{color:inherit}hr{border:0;text-align:center}hr:after{content:'*   *   *'}pre{white-space:pre-wrap}ul,ol{padding-left:${preset === 'mobile' ? '1.3' : '2'}em}</style></head><body>${titles.includeTitle ? `<h1 class="book-title">${escape(project.title)}</h1>` : ''}${body}</body></html>`;
}

function colour(value) {
  if (!value) return undefined;
  const span = document.createElement('span'); span.style.color = value;
  const normalized = span.style.color, hex = normalized.match(/^#([a-f0-9]{6})$/i);
  if (hex) return hex[1].toUpperCase();
  const rgb = normalized.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return rgb.slice(1).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase();
  return ({ black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000', yellow: 'FFFF00', gray: '808080' })[normalized];
}
function fontSize(value) {
  const match = String(value || '').match(/^([\d.]+)(px|pt)?$/);
  return match ? Math.max(2, Math.round(Number(match[1]) * (match[2] === 'pt' ? 2 : 1.5))) : undefined;
}
async function imageForDocx(node) {
  const source = node.attrs?.src || '';
  if (!RASTER_DATA.test(source)) return null;
  const image = new Image();
  const decoded = await new Promise(resolve => { const timer = setTimeout(() => resolve(false), 5000); image.onload = () => { clearTimeout(timer); resolve(true); }; image.onerror = () => { clearTimeout(timer); resolve(false); }; image.src = source; });
  if (!decoded || !image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000) return null;
  let dataURL = source;
  if (/^data:image\/webp/i.test(source)) { const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); dataURL = canvas.toDataURL('image/png'); }
  const match = dataURL.match(/^data:image\/(png|jpe?g|gif);base64,([\s\S]+)$/i);
  if (!match) return null;
  const width = Math.min(590, Math.max(1, Number(node.attrs?.width) || image.naturalWidth)), scale = Math.min(1, 900 / (width * image.naturalHeight / image.naturalWidth));
  return { type: match[1].toLowerCase().startsWith('jp') ? 'jpg' : match[1].toLowerCase(), data: Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)), transformation: { width: Math.round(width * scale), height: Math.round(width * image.naturalHeight / image.naturalWidth * scale) }, altText: { title: node.attrs?.title || '', description: node.attrs?.alt || '', name: node.attrs?.alt || 'Image' } };
}
async function toDocx(project, options = {}) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, ImageRun, ExternalHyperlink, LevelFormat, WidthType, ShadingType, LineRuleType } = await import('docx');
  const defaults = documentStyle(project), language = project.language || 'en-US';
  const numbering = [], warnings = new Set(), imageOptions = new Map();
  const collectImages = async node => { if (node.type === 'image') imageOptions.set(node, await imageForDocx(node)); for (const child of node.content || []) await collectImages(child); };
  for (const chapter of project.chapters) await collectImages(chapter.content);
  function inlines(nodes = [], header = false) {
    return nodes.flatMap(node => {
      if (node.type === 'hardBreak') return [new TextRun({ break: 1 })];
      if (node.type !== 'text') return inlines(node.content, header);
      const marks = node.marks || [], style = marks.find(m => m.type === 'textStyle')?.attrs || {};
      const highlight = colour(marks.find(m => m.type === 'highlight')?.attrs?.color || (marks.some(m => m.type === 'highlight') ? 'yellow' : style.backgroundColor));
      const run = new TextRun({ text: node.text, bold: header || marks.some(m => m.type === 'bold'), italics: marks.some(m => m.type === 'italic'), underline: marks.some(m => m.type === 'underline') ? {} : undefined, strike: marks.some(m => m.type === 'strike'), font: marks.some(m => m.type === 'code') ? 'Consolas' : style.fontFamily || undefined, size: fontSize(style.fontSize), color: colour(style.color), shading: highlight ? { type: ShadingType.CLEAR, fill: highlight } : undefined });
      const link = marks.find(m => m.type === 'link')?.attrs?.href;
      if (link && /^(https?:|mailto:|tel:)/i.test(link)) return [new ExternalHyperlink({ link, children: [run] })];
      if (link) warnings.add('Internal or unsupported links retain their text but are not active in DOCX.');
      return [run];
    });
  }
  function paragraphOptions(node, quote, header = false) {
    const attrs = node.attrs || {}, indent = quote ? { left: 360, right: 360 } : {};
    if (attrs.firstLineIndent != null) {
      const value = Math.round(Number(attrs.firstLineIndent) * 20);
      if (value < 0) indent.hanging = Math.abs(value); else indent.firstLine = value;
    }
    const line = attrs.lineHeight || defaults.lineHeight;
    const absoluteLine = /(?:pt|px|in|cm|mm|pc)$/i.test(String(line)) ? points(line) : null;
    const spacing = { after: Math.round(Number(attrs.spaceAfter ?? defaults.fontSize * 0.8) * 20), line: Math.round(absoluteLine != null ? absoluteLine * 20 : lineRatio(line, defaults.lineHeight) * 240), lineRule: absoluteLine != null ? LineRuleType.EXACT : LineRuleType.AUTO };
    return { children: inlines(node.content, header), heading: node.type === 'heading' ? HeadingLevel[`HEADING_${Math.min(6, attrs.level || 1)}`] : undefined, alignment: ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[attrs.textAlign], indent: Object.keys(indent).length ? indent : undefined, spacing, widowControl: true, pageBreakBefore: Boolean(attrs.pageBreakBefore) };
  }
  function blocks(nodes = [], depth = 0, quote = false, header = false) {
    return nodes.flatMap(node => {
      if (node.type === 'table') return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: (node.content || []).map(row => new TableRow({ tableHeader: row.content?.every(cell => cell.type === 'tableHeader'), children: (row.content || []).map(cell => { const heading = cell.type === 'tableHeader', children = blocks(cell.content, 0, false, heading); return new TableCell({ columnSpan: cell.attrs?.colspan || 1, rowSpan: cell.attrs?.rowspan || 1, shading: heading ? { type: ShadingType.CLEAR, fill: 'F2F2F2' } : undefined, children: children.length ? children : [new Paragraph('')] }); }) })) })];
      if (node.type === 'image') {
        const options = imageOptions.get(node);
        if (options) return [new Paragraph({ children: [new ImageRun(options)] })];
        warnings.add('An unsupported or unreadable image was replaced with a labelled placeholder.');
        return [new Paragraph(`[Image omitted: ${node.attrs?.alt || 'unsupported format'}]`)];
      }
      if (node.type === 'horizontalRule') return [new Paragraph({ text: '* * *', alignment: AlignmentType.CENTER })];
      if (node.type === 'bulletList' || node.type === 'orderedList') {
        const reference = `list-${numbering.length + 1}`, level = Math.min(8, depth), ordered = node.type === 'orderedList';
        numbering.push({ reference, levels: Array.from({ length: 9 }, (_, i) => ({ level: i, format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET, text: ordered ? `%${i + 1}.` : '•', start: Math.max(1, Number(node.attrs?.start) || 1), alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (i + 1), hanging: 260 } } } })) });
        return (node.content || []).flatMap(item => {
          let firstParagraph = true;
          return (item.content || []).flatMap(child => {
            if (['paragraph', 'heading'].includes(child.type)) {
              const options = paragraphOptions(child, quote, header);
              if (firstParagraph) { options.numbering = { reference, level }; firstParagraph = false; }
              else options.indent = { left: 360 * (level + 1) };
              return [new Paragraph(options)];
            }
            return blocks([child], depth + 1, quote, header);
          });
        });
      }
      if (node.type === 'paragraph' || node.type === 'heading') return [new Paragraph(paragraphOptions(node, quote, header))];
      if (node.type === 'codeBlock') return [new Paragraph({ children: inlines((node.content || []).map(n => ({ ...n, marks: [...(n.marks || []), { type: 'code' }] }))), spacing: { after: 160 } })];
      return blocks(node.content, depth, quote || node.type === 'blockquote', header);
    });
  }
  const titles = titleOptions(options), children = [], chapters = [];
  if (titles.includeTitle) children.push(new Paragraph({ text: project.title, heading: HeadingLevel.TITLE }));
  for (const chapter of project.chapters) {
    if (titles.includeChapterTitles) children.push(new Paragraph({ text: chapter.title, heading: HeadingLevel.HEADING_1, pageBreakBefore: chapters.length > 0 }));
    const start = children.length; children.push(...blocks(chapter.content.content));
    if (children.length === start) children.push(new Paragraph(''));
    chapters.push({ id: chapter.id, title: chapter.title, status: chapter.status || 'Draft', start, end: children.length });
  }
  const document = new Document({ creator: 'WRAITER', title: project.title, numbering: { config: numbering }, styles: { default: { document: { run: { font: defaults.fontFamily, size: Math.round(defaults.fontSize * 2), language: { value: language } }, paragraph: { spacing: { line: Math.round(defaults.lineHeight * 240), lineRule: LineRuleType.AUTO, after: Math.round(defaults.fontSize * 16) } } } } }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1247, right: 1247, bottom: 1247, left: 1247 } } }, children }] });
  const zip = await JSZip.loadAsync(await (await Packer.toBlob(document)).arrayBuffer());
  await addStructure(zip, 'word/document.xml', project, chapters);
  return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), warning: [...warnings].join(' ') };
}
function textEncoding(data, options) {
  const prefs = options.fidelity || options;
  if (prefs.lineEnding && prefs.lineEnding !== '\n') data = data.replace(/\r\n?|\n/g, prefs.lineEnding);
  if (['utf-16le', 'utf-16be'].includes(prefs.encoding)) {
    const start = prefs.bom === false ? 0 : 2, bytes = new Uint8Array(data.length * 2 + start), little = prefs.encoding === 'utf-16le';
    if (start) { bytes[0] = little ? 255 : 254; bytes[1] = little ? 254 : 255; }
    for (let i = 0; i < data.length; i++) { const value = data.charCodeAt(i); bytes[start + i * 2] = little ? value & 255 : value >> 8; bytes[start + i * 2 + 1] = little ? value >> 8 : value & 255; }
    return bytes;
  }
  return prefs.bom ? '\ufeff' + data : data;
}
export async function exportPayload(source, format, extensions, options = {}) {
  const aliases = { markdown: 'md', htm: 'html', 'bbcode-txt': 'bbcode', 'pdf-desktop': 'pdf', 'pdf-mobile': 'pdf' };
  if (format === 'pdf-desktop') options = { ...options, pdfPreset: 'desktop' };
  if (format === 'pdf-mobile') options = { ...options, pdfPreset: 'mobile' };
  format = aliases[format] || format;
  const project = exportScope(source, options), titles = titleOptions(options), lossWarnings = formatLosses(project, format);
  if (['pdf', 'html'].includes(format)) { const html = publicationHTML(project, extensions, options); return { format, title: project.title, html, data: textEncoding(html, options), lossWarnings, ...(format === 'pdf' ? { pdfOptions: { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false }, pdfPreset: options.pdfPreset || 'standard' } : {}) }; }
  if (format === 'docx') { const result = await toDocx(project, options); return { format, title: project.title, ...result, lossWarnings: result.warning ? [result.warning] : [] }; }
  if (format === 'odt') { const result = await toODT(project, options); return { format, title: project.title, ...result, lossWarnings: result.warning ? [result.warning] : [] }; }
  if (format === 'epub') { const result = await toEPUB(project, chapter => safeHTML(generateHTML(chapter.content, extensions)), options); return { format, title: project.title, ...result, lossWarnings: result.warning ? [result.warning] : [] }; }
  if (format === 'txt') return { format, title: project.title, lossWarnings, data: textEncoding([...(titles.includeTitle ? [project.title] : []), ...project.chapters.flatMap(chapter => [...(titles.includeChapterTitles ? [chapter.title] : []), nodeText(chapter.content, '\n', true)])].join('\n\n'), options), warning: 'Plain text preserves manuscript wording without formatting; images become labelled placeholders.' };
  if (!['md', 'bbcode'].includes(format)) throw new Error(`Unsupported export format: ${format}`);
  return { format, title: project.title, lossWarnings, data: textEncoding(`${titles.includeTitle ? `${format === 'md' ? '# ' : ''}${inlineMarkup({ text: project.title }, format)}\n\n` : ''}${project.chapters.map(c => `${titles.includeChapterTitles ? `${format === 'md' ? '## ' : ''}${inlineMarkup({ text: c.title }, format)}\n\n` : ''}${blockMarkup(c.content, format)}`).join('\n')}`, options), warning: format === 'md' ? 'Markdown does not preserve fonts, colours, underlining, page layout, or merged table cells. Tables use their first row as a header; embedded images may not display in every Markdown reader.' : 'BBCode preserves basic emphasis, lists, and links. Fonts, colours, page layout, and table structure are simplified; images become placeholders. Numbered lists start at 1.' };
}
