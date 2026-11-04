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
import { chatDocument, chatFormats } from './formats/chat.js';
import { stripCommentAnchors } from '../electron/comments.mjs';
import { acceptTrackedJSON } from '../electron/tracked-changes.mjs';
import { prepareDocxRevisions, restoreDocxRevisions, restoreDocxComments } from './docx-revisions.js';
import { imageDimensions } from './document-ux.js';
import { namedStyleCSS, sanitizeNamedStyles } from './named-styles.js';
import { officeStyleId, docxStyleDefinitions } from './formats/named-office.js';
import { printLayoutCSS, normalizePrintLayout, pageDimensions } from './print-layout.js';
import { odtPageLayout, docxPageLayout } from './formats/page-layout.js';
import { withExportContents } from './formats/contents.js';
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
function namedAttrsFromCSS(properties) {
  const result = {}, setNum = (key, value, min, max) => { if (Number.isFinite(value) && value >= min && value <= max) result[key] = value; };
  const family = properties['font-family']; if (family && family.length <= 200 && !/[<>\x00-\x1f]/.test(family)) result.fontFamily = family;
  setNum('fontSize', points(properties['font-size']), 6, 96);
  if (/^#[0-9a-f]{6}$/i.test(properties.color || '')) result.color = properties.color;
  if (properties['font-weight']) result.bold = properties['font-weight'] === 'bold' || Number(properties['font-weight']) >= 600;
  if (properties['font-style']) result.italic = properties['font-style'] === 'italic';
  if (properties['text-decoration']) result.underline = /underline/.test(properties['text-decoration']);
  if (properties['line-height']) setNum('lineHeight', lineRatio(properties['line-height'], NaN), 1, 3);
  for (const [key, name, min, max] of [['spaceBefore','margin-top',0,72],['spaceAfter','margin-bottom',0,72],['leftIndent','margin-left',-144,144],['rightIndent','margin-right',-144,144],['firstLineIndent','text-indent',-144,144]]) setNum(key, points(properties[name]), min, max);
  if (['left','center','right','justify'].includes(properties['text-align'])) result.textAlign = properties['text-align'];
  return result;
}
function importedStyleId(family, name) {
  let hash = 0x811c9dc5; for (const c of `${family}:${name}`) hash = Math.imul(hash ^ c.codePointAt(0), 0x01000193);
  return `office-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
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
  const allowed = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'background-color', 'text-align', 'text-decoration', 'text-decoration-line', 'white-space', 'line-height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'text-indent', 'break-before', 'page-break-before', 'vertical-align', 'float', 'border', 'border-color', 'border-style', 'border-width']);
  for (const element of fragment.querySelectorAll('[style]')) {
    for (const property of [...element.style]) {
      const value = element.style.getPropertyValue(property);
      if (!allowed.has(property) || (property === 'float' && (element.tagName !== 'IMG' || !['left', 'right'].includes(value))) || /url\s*\(|expression\s*\(|var\s*\(/i.test(value)) element.style.removeProperty(property);
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
  const importedComments = [], commentStarts = new Map(), commentEnds = new Map(), commentMarkers = [];
  const commentToken = `WRAITERODTCOMMENT${crypto.randomUUID().replaceAll('-', '')}`;
  const annotationEnds = new Set(elements(xml, 'office', 'annotation-end').map(node => attr(node, 'office:name')).filter(Boolean));
  for (const annotation of elements(xml, 'office', 'annotation')) {
    if (importedComments.length >= 5000) { losses.add('Only the first 5,000 comments were imported.'); break; }
    const name = attr(annotation, 'office:name'), author = annotation.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]?.textContent || 'Unknown author';
    const text = elements(annotation, 'text', 'p').map(paragraph => xmlText(paragraph)).join('\n').trim();
    if (!text) continue;
    const comment = { id: uid(), origin: 'odt', author: author.slice(0, 500), text: text.slice(0, 19000) }; importedComments.push(comment);
    if (name && annotationEnds.has(name)) {
      if (commentEnds.has(name)) throw new Error('This OpenDocument file contains duplicate comment names.');
      const start = `${commentToken}S${commentMarkers.length}X`, end = `${commentToken}E${commentMarkers.length}X`;
      commentStarts.set(annotation, start); commentEnds.set(name, end);
      commentMarkers.push({ token: start, id: comment.id, open: true }, { token: end, id: comment.id, open: false });
    }
  }
  const revisions = new Map(), tokenBase = `WRAITERODTREV${crypto.randomUUID().replaceAll('-', '')}`;
  for (const region of elements(xml, 'text', 'changed-region')) {
    const originalId = region.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id') || attr(region, 'text:id');
    const changes = [...region.children].filter(node => node.namespaceURI === NS.text && ['insertion', 'deletion', 'format-change'].includes(node.localName));
    if (!originalId) { notes.push(`Unreferenced tracked content\n${xmlText(region).trim()}`); losses.add('Unreferenced tracked content was preserved in Project notes.'); continue; }
    if (revisions.has(originalId) || changes.length !== 1 || changes[0].localName === 'format-change') throw new Error('This OpenDocument file has tracked formatting or structural changes that WRAITER cannot safely import. Accept or reject them in Writer first.');
    const change = changes[0], info = elements(change, 'office', 'change-info')[0], author = info?.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]?.textContent || 'Unknown author', date = info?.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'date')[0]?.textContent || new Date().toISOString();
    const paragraphs = [...change.children].filter(child => child.namespaceURI === NS.text && child.localName === 'p');
    if (change.localName === 'deletion' && (paragraphs.length !== 1 || [...change.children].some(child => child !== paragraphs[0] && child !== info))) throw new Error('This OpenDocument file contains a structural tracked deletion that WRAITER cannot safely import.');
    if (paragraphs[0] && [...paragraphs[0].getElementsByTagName('*')].some(child => child.namespaceURI !== NS.text || !['span', 's', 'tab', 'line-break', 'a'].includes(child.localName))) throw new Error('This OpenDocument file contains a tracked object that WRAITER cannot safely import.');
    const index = revisions.size;
    revisions.set(originalId, { id: `revision_${crypto.randomUUID().replaceAll('-', '')}`, kind: change.localName === 'deletion' ? 'delete' : 'insert', author: author.slice(0, 200), date: date.slice(0, 100), start: `${tokenBase}S${index}X`, end: `${tokenBase}E${index}X`, paragraph: paragraphs[0] });
  }
  for (const [id, revision] of revisions) {
    const count = name => elements(xml, 'text', name).filter(item => attr(item, 'text:change-id') === id).length;
    if (revision.kind === 'insert' ? count('change-start') !== 1 || count('change-end') !== 1 || count('change') !== 0 : count('change') !== 1 || count('change-start') !== 0 || count('change-end') !== 0) throw new Error('An OpenDocument tracked change has missing or unsupported boundaries.');
  }
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
    const position = attr(props, 'style:text-position').split(/\s+/)[0];
    if (position === 'super' || position === 'sub') result['vertical-align'] = position;
    else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(position)) {
      const offset = Number.parseFloat(position);
      if (offset) { result['vertical-align'] = offset > 0 ? 'super' : 'sub'; losses.add('Custom raised or lowered text positions are approximated with superscript or subscript.'); }
    } else if (position) losses.add('An unsupported text-position setting may be simplified.');
    const align = attr(para, 'fo:text-align');
    if (align) result['text-align'] = ({ start: 'left', end: 'right' })[align] || align;
    const line = attr(para, 'fo:line-height');
    const tabNodes = para ? elements(para, 'style', 'tab-stop') : [];
    const stops = tabNodes.filter(item => !attr(item, 'style:type') || attr(item, 'style:type') === 'left').map(item => points(attr(item, 'style:position'))).filter(value => value > 0 && value <= 1000);
    if (tabNodes.length !== stops.length || stops.length > 32) losses.add('Only the first 32 left-aligned tab stops within the supported range are retained.');
    if (stops.length) result['tab-stops'] = [...new Set(stops)].sort((a,b) => a-b).slice(0,32);
    if (attr(para, 'fo:break-before') === 'page') result['break-before'] = 'page';
    if (line && line !== 'normal') result['line-height'] = line;
    for (const name of ['margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'text-indent']) {
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
  const namedStyles = [], namedMap = new Map();
  for (const [key, item] of styles) {
    const family = attr(item, 'style:family'), name = attr(item, 'style:name');
    const own = /^WS_[A-Za-z0-9_-]{1,100}$/.test(name), custom = item.parentElement?.localName === 'styles' && !!attr(item, 'style:display-name');
    if (!['paragraph','text'].includes(family) || (!own && !custom) || namedStyles.length >= 500) continue;
    const id = own ? name.slice(3) : importedStyleId(family, name); if (namedStyles.some(style => style.id === id)) continue;
    const entry = { id, name: (attr(item, 'style:display-name').trim() || name).slice(0,100), kind: family === 'text' ? 'character' : 'paragraph', attrs: namedAttrsFromCSS(own ? styleProperties(item) : resolvedStyle(name, family)) };
    namedStyles.push(entry); namedMap.set(key, entry);
  }
  function styleRoot(name, family, seen = new Set()) {
    const key = `${family}:${name}`; if (seen.has(key)) return null; seen.add(key);
    if (namedMap.has(key)) return namedMap.get(key);
    const parent = attr(styles.get(key), 'style:parent-style-name'); return parent ? styleRoot(parent, family, seen) : null;
  }
  function directStyle(name, family, seen = new Set()) {
    const key = `${family}:${name}`; if (seen.has(key) || namedMap.has(key)) return {}; seen.add(key);
    const item = styles.get(key); if (!item) return {};
    const parent = attr(item, 'style:parent-style-name'); return { ...(parent ? directStyle(parent, family, seen) : {}), ...styleProperties(item) };
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
    if (tag === 'text:tracked-changes') return '';
    if (['text:change', 'text:change-start', 'text:change-end'].includes(tag)) {
      const revision = revisions.get(attr(node, 'text:change-id'));
      if (!revision) throw new Error('An OpenDocument tracked change has no matching definition.');
      if (tag === 'text:change-start' && revision.kind === 'insert') return revision.start;
      if (tag === 'text:change-end' && revision.kind === 'insert') return revision.end;
      if (tag === 'text:change' && revision.kind === 'delete') {
        const body = [...revision.paragraph.childNodes].map(child => convert(child, listDepth)).join('');
        return `<span data-wraiter-track-id="${escape(revision.id)}" data-wraiter-track-kind="delete" data-wraiter-track-author="${escape(revision.author)}" data-wraiter-track-date="${escape(revision.date)}">${body}</span>`;
      }
      throw new Error('This OpenDocument tracked change has an unsupported boundary.');
    }
    if (tag === 'text:hidden-text') { notes.push(`Imported hidden text\n${xmlText(node).trim()}`); losses.add('Hidden text is kept in Project notes instead of being exposed in the manuscript.'); return ''; }
    if (['text:sequence-decls', 'text:variable-decls', 'text:user-field-decls', 'office:forms'].includes(tag)) return '';
    if (tag === 'office:annotation') return commentStarts.get(node) || '';
    if (tag === 'office:annotation-end') return commentEnds.get(attr(node, 'office:name')) || '';
    if (tag === 'text:note') {
      const body = elements(node, 'text', 'note-body')[0], kind = attr(node, 'text:note-class') === 'endnote' ? 'endnote' : 'footnote';
      const text = body ? xmlText(body).trim() : '';
      if (body && elements(body, 'text', 'p').length > 1) losses.add('Note paragraphs and formatting are simplified to plain text.');
      return `<span data-wraiter-note="" data-note-kind="${kind}" data-note-text="${escape(text)}">${kind === 'endnote' ? '‡' : '†'}</span>`;
    }
    if (tag === 'text:s') return ' '.repeat(boundedCount(attr(node, 'text:c'), 10000, 'space repeat count'));
    if (tag === 'text:tab') return '\t';
    if (tag === 'text:line-break') return '<br>';
    if (tag === 'svg:desc' || tag === 'svg:title') return '';
    if (tag === 'draw:image') {
      const width = points(attr(node.parentElement, 'svg:width')), height = points(attr(node.parentElement, 'svg:height'));
      return images.has(node) ? `<img src="${images.get(node)}" alt="${escape(elements(node.parentElement, 'svg', 'desc')[0]?.textContent || attr(node.parentElement, 'draw:name') || 'Imported image')}"${width ? ` width="${width / 0.75}"` : ''}${height ? ` height="${height / 0.75}"` : ''}>` : '[Image not imported]';
    }
    if (tag === 'table:covered-table-cell') return '';
    let inner = [...node.childNodes].map(child => convert(child, tag === 'text:list' ? listDepth + 1 : listDepth)).join('');
    const family = ['text:p', 'text:h'].includes(tag) ? 'paragraph' : 'text', styleName = attr(node, 'text:style-name'), named = styleRoot(styleName, family), properties = named ? directStyle(styleName, family) : resolvedStyle(styleName, family);
    const paragraphProperties = new Set(['text-align', 'line-height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'text-indent', 'break-before', 'tab-stops']);
    const css = Object.entries(properties).filter(([name]) => !paragraphProperties.has(name)).map(([name, value]) => `${name}:${value}`).join(';');
    if (css && ['text:p', 'text:h', 'text:span'].includes(tag)) inner = `<span style="${escape(css)}">${inner}</span>`;
    if (tag === 'text:span' && named) inner = `<span data-character-style="${escape(named.id)}">${inner}</span>`;
    const paragraphCSS = Object.entries(properties).filter(([name]) => paragraphProperties.has(name) && name !== 'tab-stops').map(([name, value]) => `${name}:${value}`).join(';');
    const alignment = ` style="white-space:pre-wrap;${escape(paragraphCSS)}"${family === 'paragraph' && named ? ` data-paragraph-style="${escape(named.id)}"` : ''}${family === 'paragraph' && properties['tab-stops']?.length ? ` data-tab-stops="${properties['tab-stops'].join(',')}"` : ''}`;
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
  function restoreODTRevisions(value) {
    const container = document.createElement('div'); container.innerHTML = value;
    const selected = [...revisions.values()].filter(revision => revision.kind === 'insert' && (value.includes(revision.start) || value.includes(revision.end)));
    restoreDocxRevisions(container, selected);
    restoreDocxComments(container, commentMarkers.filter(marker => value.includes(marker.token)));
    return container.innerHTML;
  }
  const html = restoreODTRevisions(convert(body));
  const defaultParagraph = defaults.get('paragraph'), defaultProperties = styleProperties(defaultParagraph);
  const runProperties = defaultParagraph && elements(defaultParagraph, 'style', 'text-properties')[0];
  const languageCode = attr(runProperties, 'fo:language'), country = attr(runProperties, 'fo:country');
  const language = languageCode && languageCode !== 'none' ? `${languageCode}${country && country !== 'none' ? '-' + country : ''}` : undefined;
  const structure = await readStructure(zip, 'content.xml');
  if (!structure) {
    const present = (prefix, name) => sources.some(source => elements(source, prefix, name).length);
    for (const [prefix, name, message] of [
      ['style', 'header', 'Page headers are simplified to plain text and page-number fields; advanced header formatting is not retained.'],
      ['style', 'footer', 'Page footers are simplified to plain text and page-number fields; advanced footer formatting is not retained.'],
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
    if (sources.some(source => elements(source, 'style', 'page-layout-properties').length)) losses.add('Supported paper sizes and margins are imported; advanced page styles are simplified to a single page setup.');
    if (sources.some(source => elements(source, 'style', 'style').length)) losses.add('Some imported style properties may be simplified; review formatting and style definitions.');
    if (elements(xml, 'draw', 'frame').some(frame => attr(frame, 'text:anchor-type') && attr(frame, 'text:anchor-type') !== 'as-char')) losses.add('Floating images are placed in the text flow; their page anchoring and wrapping are not retained.');
  }
  const chapters = structure?.chapters.map(chapter => ({ ...chapter, html: restoreODTRevisions([...body.children].slice(chapter.start, chapter.end).map(node => convert(node)).join('')) }));
  return { html, chapters, title: structure?.title, language, namedStyles, importedComments, printLayout: await odtPageLayout(zip), documentStyle: { fontFamily: defaultProperties['font-family'] || DEFAULT_DOCUMENT_STYLE.fontFamily, fontSize: points(defaultProperties['font-size']) || DEFAULT_DOCUMENT_STYLE.fontSize, lineHeight: lineRatio(defaultProperties['line-height']) }, notes: notes.join('\n\n'), warnings: [...losses] };
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
    const tabNodes = children(child(node, 'tabs'), 'tab'), stops = tabNodes.filter(item => ['left','start'].includes(property(item, 'val'))).map(item => Number(property(item, 'pos')) / 20).filter(value => value > 0 && value <= 1000);
    if (stops.length) result.tabStops = [...new Set(stops)].sort((a,b) => a-b).slice(0,32);
    if (pageBreak) result.pageBreakBefore = !['0', 'false', 'off'].includes(property(pageBreak, 'val'));
    const before = property(spacing, 'before'), after = property(spacing, 'after'), line = property(spacing, 'line'), rule = property(spacing, 'lineRule');
    if (before !== '' && Number.isFinite(Number(before))) result.spaceBefore = Number(before) / 20;
    if (after !== '' && Number.isFinite(Number(after))) result.spaceAfter = Number(after) / 20;
    if (line && Number(line) > 0) result.lineHeight = rule && rule !== 'auto' ? `${Number(line) / 20}pt` : Number(line) / 240;
    const first = property(indent, 'firstLine'), hanging = property(indent, 'hanging');
    const left = property(indent, 'left') || property(indent, 'start'), right = property(indent, 'right') || property(indent, 'end');
    if (left !== '' && Number.isFinite(Number(left))) result.leftIndent = Number(left) / 20;
    if (right !== '' && Number.isFinite(Number(right))) result.rightIndent = Number(right) / 20;
    if (first !== '' && Number.isFinite(Number(first))) result.firstLineIndent = Number(first) / 20;
    else if (hanging !== '' && Number.isFinite(Number(hanging))) result.firstLineIndent = -Number(hanging) / 20;
    const alignment = property(child(node, 'jc'), 'val');
    if (alignment) result.textAlign = ({ both: 'justify', start: 'left', end: 'right' })[alignment] || alignment;
    return result;
  };
  const styleMap = new Map(styles ? [...styles.getElementsByTagNameNS(word, 'style')].map(style => [property(style, 'styleId'), style]) : []);
  const namedStyles = [], namedMap = new Map();
  function inheritedRunFlags(id, seen = new Set()) {
    const item = styleMap.get(id); if (!item || seen.has(id)) return {}; seen.add(id);
    const flags = inheritedRunFlags(property(child(item, 'basedOn'), 'val'), seen), run = child(item, 'rPr');
    for (const [tag, key] of [['b','bold'],['i','italic'],['u','underline']]) { const element = child(run, tag); if (element) flags[key] = !['0','false','off','none'].includes(property(element, 'val')); }
    return flags;
  }
  for (const [officeId, item] of styleMap) {
    const kind = property(item, 'type');
    const own = /^WS_[A-Za-z0-9_-]{1,100}$/.test(officeId), custom = ['1','true','on'].includes(property(item, 'customStyle'));
    if ((!own && !custom) || !['paragraph','character'].includes(kind) || namedStyles.length >= 500) continue;
    const id = own ? officeId.slice(3) : importedStyleId(kind, officeId), run = child(item, 'rPr'), formatting = own ? { ...runStyle(run), ...(kind === 'paragraph' ? paragraphStyle(child(item, 'pPr')) : {}) } : resolved(officeId), attrs = {};
    if (typeof formatting.fontFamily === 'string' && formatting.fontFamily.length <= 200 && !/[<>\x00-\x1f]/.test(formatting.fontFamily)) attrs.fontFamily = formatting.fontFamily;
    for (const [key, min, max] of [['fontSize',6,96],['lineHeight',1,3],['spaceBefore',0,72],['spaceAfter',0,72],['leftIndent',-144,144],['rightIndent',-144,144],['firstLineIndent',-144,144]]) if (typeof formatting[key] === 'number' && Number.isFinite(formatting[key]) && formatting[key] >= min && formatting[key] <= max) attrs[key] = formatting[key];
    if (/^#[0-9a-f]{6}$/i.test(formatting.color || '')) attrs.color = formatting.color;
    if (['left','center','right','justify'].includes(formatting.textAlign)) attrs.textAlign = formatting.textAlign;
    Object.assign(attrs, own ? Object.fromEntries([['b','bold'],['i','italic'],['u','underline']].flatMap(([tag,key]) => { const element = child(run, tag); return element ? [[key, !['0','false','off','none'].includes(property(element, 'val'))]] : []; })) : inheritedRunFlags(officeId));
    const entry = { id, name: (property(child(item, 'name'), 'val').trim() || id).slice(0,100), kind, attrs };
    if (!namedStyles.some(style => style.id === id)) { namedStyles.push(entry); namedMap.set(officeId, entry); }
  }
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
    const outlineText = property(child(properties, 'outlineLvl'), 'val'), outline = outlineText === '' ? null : Number(outlineText);
    const paragraphNamed = namedMap.get(property(child(properties, 'pStyle'), 'val'));
    const style = paragraphNamed ? paragraphStyle(properties) : { ...base, ...resolved(property(child(properties, 'pStyle'), 'val')), ...paragraphStyle(properties) };
    let offset = 0;
    const runs = [...paragraph.getElementsByTagNameNS(word, 'r')].map(run => {
      const value = [...run.children].map(node => node.localName === 't' ? node.textContent : node.localName === 'tab' ? '\t' : '').join('');
      const start = offset; offset += value.length;
      const runProperties = child(run, 'rPr');
      const characterNamed = namedMap.get(property(child(runProperties, 'rStyle'), 'val'));
      return { start, end: offset, value, characterNamed, style: characterNamed ? runStyle(runProperties) : { ...style, ...resolved(property(child(runProperties, 'rStyle'), 'val')), ...runStyle(runProperties) } };
    });
    const value = runs.map(run => run.value).join('');
    return { text: value.replace(/\s+/g, ' ').trim(), value, runs, style, paragraphNamed, headingLevel: Number.isInteger(outline) && outline >= 0 && outline < 3 ? outline + 1 : null };
  });
  const container = document.createElement('div'); container.innerHTML = html;
  const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', graphic = 'http://schemas.openxmlformats.org/drawingml/2006/main', relation = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relationships = zip.file('word/_rels/document.xml.rels') ? parseXML(await zip.file('word/_rels/document.xml.rels').async('string')) : null;
  const targets = new Map([...(relationships?.getElementsByTagName('Relationship') || [])].filter(item => item.getAttribute('TargetMode') !== 'External').map(item => [item.getAttribute('Id'), item.getAttribute('Target')]));
  const availableImages = [...container.querySelectorAll('img')];
  for (const object of xml.getElementsByTagNameNS(word, 'drawing')) {
    const blip = object.getElementsByTagNameNS(graphic, 'blip')[0], target = targets.get(blip?.getAttributeNS(relation, 'embed'));
    const entry = target && /^media\/[^/]+$/.test(target) ? zip.file(`word/${target}`) : null;
    if (!entry) continue;
    const base64 = await entry.async('base64'), index = availableImages.findIndex(image => image.getAttribute('src')?.split(',')[1]?.replace(/\s/g, '') === base64);
    if (index < 0) continue;
    const image = availableImages.splice(index, 1)[0], extent = object.getElementsByTagNameNS(drawing, 'extent')[0], properties = object.getElementsByTagNameNS(drawing, 'docPr')[0];
    const width = Number(extent?.getAttribute('cx')) / 9525, height = Number(extent?.getAttribute('cy')) / 9525;
    if (width > 0 && height > 0) { image.setAttribute('width', String(width)); image.setAttribute('height', String(height)); }
    if (properties?.hasAttribute('descr')) image.setAttribute('alt', properties.getAttribute('descr'));
  }
  let cursor = 0;
  for (let paragraph of container.querySelectorAll('p,h1,h2,h3,h4,h5,h6')) {
    const text = paragraph.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const index = rawParagraphs.findIndex((candidate, position) => position >= cursor && candidate.text === text);
    if (index < 0) continue;
    cursor = index + 1; const candidate = rawParagraphs[index], style = candidate.style;
    if (candidate.headingLevel && paragraph.tagName === 'P') { const heading = document.createElement(`h${candidate.headingLevel}`); for (const attribute of [...paragraph.attributes]) heading.setAttribute(attribute.name, attribute.value); while (paragraph.firstChild) heading.append(paragraph.firstChild); paragraph.replaceWith(heading); paragraph = heading; }
    if (candidate.paragraphNamed) paragraph.setAttribute('data-paragraph-style', candidate.paragraphNamed.id);
    if (style.tabStops?.length) paragraph.setAttribute('data-tab-stops', style.tabStops.join(','));
    if (style.lineHeight != null) paragraph.style.lineHeight = String(style.lineHeight);
    if (style.spaceBefore != null) paragraph.style.marginTop = `${style.spaceBefore}pt`;
    if (style.spaceAfter != null) paragraph.style.marginBottom = `${style.spaceAfter}pt`;
    if (style.leftIndent != null) paragraph.style.marginLeft = `${style.leftIndent}pt`;
    if (style.rightIndent != null) paragraph.style.marginRight = `${style.rightIndent}pt`;
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
          if (run.characterNamed) span.setAttribute('data-character-style', run.characterNamed.id);
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
  return { html: container.innerHTML, language: base.language, namedStyles, documentStyle: { fontFamily: base.fontFamily || DEFAULT_DOCUMENT_STYLE.fontFamily, fontSize: base.fontSize || DEFAULT_DOCUMENT_STYLE.fontSize, lineHeight: lineRatio(base.lineHeight) } };
}

async function importDOCX(bytes, extensions) {
  const zip = await loadOfficePackage(bytes), mammoth = await import('mammoth/mammoth.browser');
  const original = await zip.file('word/document.xml')?.async('string');
  if (!original) throw new Error('This DOCX has no document content.');
  const structure = await readStructure(zip, 'word/document.xml'), warnings = new Set();
  // Even files generated by WRAITER can contain explicitly shared comments.
  // Chapter metadata does not mean that their Word anchors are editable here.
  const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const importedComments = [];
  if (zip.file('word/comments.xml')) {
    const commentXml = parseXML(await zip.file('word/comments.xml').async('string'));
    for (const entry of commentXml.getElementsByTagNameNS(wordNamespace, 'comment')) {
      if (importedComments.length >= 5000) { warnings.add('Only the first 5,000 comments were imported.'); break; }
      const author = entry.getAttributeNS(wordNamespace, 'author') || 'Unknown author';
      const text = [...entry.getElementsByTagNameNS(wordNamespace, 'p')].map(p => p.textContent).join('\n').trim();
      if (!text) continue;
      if (text.length > 19000) warnings.add('Long imported comments were shortened.');
      importedComments.push({ id: uid(), officeId: entry.getAttributeNS(wordNamespace, 'id'), author: author.slice(0, 500), text: text.slice(0, 19000) });
    }
  }
  const commentIds = new Map(importedComments.map(comment => [comment.officeId, comment.id]));
  if ([...parseXML(original).getElementsByTagNameNS(wordNamespace, 'commentRangeStart')].some(marker => !commentIds.has(marker.getAttributeNS(wordNamespace, 'id')))) warnings.add('Some Word comment anchors have no corresponding comment and were omitted.');
  const convert = async data => {
    const prepared = await prepareDocxRevisions(data, commentIds);
    const array = prepared.bytes instanceof Uint8Array ? prepared.bytes : new Uint8Array(prepared.bytes);
    const result = await mammoth.convertToHtml({ arrayBuffer: array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength) }, { styleMap: ['u => u', 'strike => s'], ignoreEmptyParagraphs: false });
    for (const message of result.messages) warnings.add(message.message);
    const noteContainer = document.createElement('div'); noteContainer.innerHTML = result.value;
    for (const reference of [...noteContainer.querySelectorAll('a[href^="#footnote-"],a[href^="#endnote-"]')]) {
      const target = reference.getAttribute('href').slice(1), entry = [...noteContainer.querySelectorAll('li[id]')].find(item => item.id === target);
      if (!entry) continue;
      const body = entry.cloneNode(true); body.querySelectorAll('a[href^="#footnote-ref-"],a[href^="#endnote-ref-"]').forEach(link => link.remove());
      const marker = document.createElement('span'); marker.setAttribute('data-wraiter-note', ''); marker.setAttribute('data-note-kind', target.startsWith('endnote-') ? 'endnote' : 'footnote'); marker.setAttribute('data-note-text', body.textContent.trim()); marker.textContent = target.startsWith('endnote-') ? '‡' : '†';
      const parent = reference.parentElement; if (parent?.tagName === 'SUP' && parent.childNodes.length === 1) parent.replaceWith(marker); else reference.replaceWith(marker);
      const list = entry.parentElement; entry.remove(); if (list && !list.children.length) list.remove();
      warnings.add('Note formatting is simplified to plain text.');
    }
    const typography = await docxTypography(array, safeHTML(noteContainer.innerHTML));
    const revisionContainer = document.createElement('div'); revisionContainer.innerHTML = safeHTML(typography.html);
    restoreDocxRevisions(revisionContainer, prepared.revisions);
    restoreDocxComments(revisionContainer, prepared.commentMarkers);
    return { ...typography, content: generateJSON(safeHTML(revisionContainer.innerHTML), extensions) };
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
      ['fldChar', 'Dynamic fields become their current displayed text and no longer update.'],
      ['fldSimple', 'Dynamic fields become their current displayed text and no longer update.'],
      ['txbxContent', 'Floating text boxes are flattened or omitted.'],
      ['object', 'Embedded objects are not supported.'],
      ['bookmarkStart', 'Document bookmarks are not retained.'],
      ['altChunk', 'Embedded external document content is not supported.'],
      ['sdt', 'Content controls become ordinary editable content.'],
      ['vanish', 'Hidden run formatting is not retained; review any hidden content.'],
    ]) if (xml.getElementsByTagNameNS(word, tag).length) warnings.add(warning);
    if (Object.keys(zip.files).some(path => /^word\/header\d*\.xml$/.test(path))) warnings.add('Page headers are simplified to plain text and page-number fields; advanced header formatting is not retained.');
    if (Object.keys(zip.files).some(path => /^word\/footer\d*\.xml$/.test(path))) warnings.add('Page footers are simplified to plain text and page-number fields; advanced footer formatting is not retained.');
    if ([...xml.getElementsByTagNameNS(word, 'cols')].some(node => Number(node.getAttributeNS(word, 'num')) > 1)) warnings.add('Multiple text columns are saved as a single column.');
    if (xml.getElementsByTagNameNS(word, 'sectPr').length) warnings.add('Multiple page sections and advanced page settings are simplified to a single page setup.');
    for (const tabs of xml.getElementsByTagNameNS(word, 'tabs')) if (tabs.children.length > 32 || [...tabs.children].some(tab => !['left','start'].includes(tab.getAttributeNS(word, 'val')) || Number(tab.getAttributeNS(word, 'pos')) <= 0 || Number(tab.getAttributeNS(word, 'pos')) > 20000 || tab.hasAttributeNS(word, 'leader'))) warnings.add('Only the first 32 left-aligned tab stops within the supported range are retained; tab leaders are not retained.');
    if (zip.file('word/styles.xml')) warnings.add('Some imported style properties may be simplified; review formatting and style definitions.');
    if ([...xml.getElementsByTagNameNS(word, 'hyperlink')].some(link => link.hasAttributeNS(word, 'anchor'))) warnings.add('Internal document links become ordinary text.');
    if (xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart').length) warnings.add('Charts are not editable and will not be retained when saving.');
    if (xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'oMath').length) warnings.add('Equation objects are not supported.');
    if (xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'anchor').length) warnings.add('Floating image anchoring and text wrapping are not retained.');
  }
  return { ...result, printLayout: await docxPageLayout(zip, original), importedComments, warnings: [...warnings] };
}

export async function importDocument(payload, extensions) {
  const project = newProject(); project.title = payload.name || 'Imported manuscript';
  // Only our Office converters may introduce private anchor/revision tags.
  // Arbitrary HTML and ordinary rich-text paste use the editor's strict schema.
  const officeExtensions = extensions.map(extension => extension.name === 'commentAnchor' ? extension.configure({ allowImportedAnchors: true }) : extension.name === 'trackedChange' ? extension.configure({ allowImportedChanges: true }) : extension);
  let content, warning = '', warnings = [], chapters, importedComments;
  const bytes = new Uint8Array(payload.bytes), extension = payload.extension.toLowerCase();
  const fidelity = { format: extension.replace(/^\./, ''), warnings: [], requiresReview: false };
  if (extension === '.docx') {
    const result = await importDOCX(bytes, officeExtensions);
    content = result.content; chapters = result.chapters; warnings = result.warnings;
    if (result.documentStyle) project.documentStyle = result.documentStyle;
    if (result.printLayout) project.printLayout = result.printLayout;
    if (result.namedStyles?.length) project.namedStyles = result.namedStyles;
    if (result.language) project.language = result.language;
    if (result.title) project.title = result.title;
    importedComments = result.importedComments;
  } else if (extension === '.odt') {
    const result = await importODT(bytes);
    content = generateJSON(safeHTML(result.html), officeExtensions); warnings = result.warnings; project.notes = result.notes;
    importedComments = result.importedComments;
    chapters = result.chapters?.map(chapter => ({ id: chapter.id, title: chapter.title, status: chapter.status || 'Draft', content: generateJSON(safeHTML(chapter.html), officeExtensions) }));
    project.documentStyle = result.documentStyle;
    if (result.printLayout) project.printLayout = result.printLayout;
    if (result.namedStyles?.length) project.namedStyles = result.namedStyles;
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
          if (meta.namedStyles !== undefined) { const valid = sanitizeNamedStyles(meta.namedStyles); if (valid) project.namedStyles = valid; else warnings.push('Invalid embedded named styles were ignored.'); }
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
  if (importedComments?.length) {
    const now = new Date().toISOString();
    project.comments = importedComments.map(comment => {
      let chapterId = project.chapters[0].id, quote = '';
      for (const chapter of project.chapters) {
        let found = false;
        const visit = node => { if (node.marks?.some(mark => mark.type === 'commentAnchor' && mark.attrs?.id === comment.id)) { found = true; quote += node.text || ''; } for (const child of node.content || []) visit(child); };
        visit(chapter.content); if (found) { chapterId = chapter.id; break; }
      }
      if (!quote) warnings.push('An Office comment without a text range was imported as a detached private note.');
      return { id: comment.id, chapterId, text: comment.text, author: comment.author, origin: comment.origin || 'docx', quote: quote.slice(0, 2000), createdAt: now, updatedAt: now, resolved: false };
    });
  }
  for (const chapter of project.chapters) if (!chapter.content.content?.length) chapter.content.content = [paragraph('')];
  fidelity.warnings = warnings; fidelity.requiresReview = warnings.length > 0; warning = warnings.join(' ');
  if (['md', 'markdown'].includes(fidelity.format)) {
    for (const loss of formatLosses(project, 'md')) if (!fidelity.warnings.includes(loss)) fidelity.warnings.push(loss);
    fidelity.requiresReview = fidelity.warnings.length > 0; warning = fidelity.warnings.join(' ');
  }
  return { project, warning, fidelity };
}

function publicationProject(source) {
  const project = { ...source, chapters: source.chapters.map(chapter => ({ ...chapter, content: stripCommentAnchors(acceptTrackedJSON(chapter.content)) })) };
  delete project.comments;
  return project;
}

export function publicationHTML(project, extensions, options = {}) {
  project = publicationProject(project);
  const titles = titleOptions(options), preset = options.pdfPreset || 'standard', dark = options.colorMode === 'dark';
  const pages = { standard: { size: 'A4', margin: '22mm', width: '720px', sizeScale: 1 }, desktop: { size: '180mm 255mm', margin: '18mm', width: '680px', sizeScale: 1.08 }, mobile: { size: '105mm 187mm', margin: '9mm 8mm', width: '100%', sizeScale: 1 } };
  const page = pages[preset] || pages.standard;
  const notes = [];
  const body = project.chapters.map(c => {
    const container = document.createElement('div'); container.innerHTML = safeHTML(generateHTML(c.content, extensions));
    for (const marker of container.querySelectorAll('[data-wraiter-note]')) { notes.push({ kind: marker.getAttribute('data-note-kind'), text: marker.getAttribute('data-note-text') || '' }); marker.textContent = `[${notes.length}]`; }
    return `<section data-wraiter-chapter="${escape(c.id)}" data-title="${escape(c.title)}">${titles.includeChapterTitles ? `<h1 data-wraiter-chapter-title="true">${escape(c.title)}</h1>` : ''}${container.innerHTML}</section>`;
  }).join('') + (notes.length && options.renderNotes ? `<section class="document-notes"><h1>Notes</h1><ol>${notes.map(note => `<li>${escape(note.text)}</li>`).join('')}</ol></section>` : '');
  const style = documentStyle(project), metadata = { version: 1, title: project.title, documentStyle: style, namedStyles: project.namedStyles || [] };
  return `<!doctype html><html lang="${escape(project.language || 'en-US')}"><head><meta charset="utf-8"><meta name="wraiter:document" content="${escape(JSON.stringify(metadata))}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escape(project.title)}</title><style>@page{size:${page.size};margin:${page.margin};background:${dark ? '#1b1d20' : '#fff'}}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:${dark ? '#1b1d20' : '#fff'}}body{font-family:"${cssString(style.fontFamily)}",serif;font-size:${Number((style.fontSize * page.sizeScale).toFixed(2))}pt;line-height:${style.lineHeight};color:${dark ? '#e4e5e7' : '#222'};background:${dark ? '#1b1d20' : 'white'};max-width:${page.width};margin:0 auto;overflow-wrap:break-word}h1,h2,h3{line-height:1.3;break-after:avoid}h1{font-size:${preset === 'mobile' ? '20' : '25'}pt;margin:0 0 1em}.book-title{font-size:${preset === 'mobile' ? '25' : '32'}pt;margin:1em 0 2em}p{orphans:3;widows:3;white-space:pre-wrap;margin:0 0 0.8em}section+section{break-before:page}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin:1em 0;table-layout:fixed}td,th{border:1px solid #999;padding:${preset === 'mobile' ? '3' : '6'}px;overflow-wrap:anywhere}blockquote{border-left:2px solid #aaa;margin-left:0;padding-left:1em}a{color:inherit}hr{border:0;text-align:center}hr:after{content:'*   *   *'}pre{white-space:pre-wrap}ul,ol{padding-left:${preset === 'mobile' ? '1.3' : '2'}em}${printLayoutCSS({ ...options, printLayout: options.printLayout || (preset === 'standard' ? project.printLayout : null) })}${namedStyleCSS(project.namedStyles)}</style></head><body>${titles.includeTitle ? `<h1 class="book-title">${escape(project.title)}</h1>` : ''}${body}</body></html>`;
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
  const size = imageDimensions(node.attrs, image.naturalWidth, image.naturalHeight);
  return { type: match[1].toLowerCase().startsWith('jp') ? 'jpg' : match[1].toLowerCase(), data: Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)), transformation: { width: size.width, height: size.height }, altText: { title: node.attrs?.title || '', description: node.attrs?.alt || '', name: node.attrs?.alt || 'Image' } };
}
async function toDocx(project, options = {}) {
  const { Document, Packer, Paragraph, TextRun, InsertedTextRun, DeletedTextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, ImageRun, ExternalHyperlink, LevelFormat, WidthType, ShadingType, LineRuleType, CommentRangeStart, CommentRangeEnd, CommentReference, FootnoteReferenceRun, EndnoteReferenceRun, Header, Footer, PageNumber } = await import('docx');
  const defaults = documentStyle(project), language = project.language || 'en-US';
  const numbering = [], warnings = new Set(), imageOptions = new Map(), comments = [], footnotes = {}, endnotes = {};
  const sharedComments = new Map((project.comments || []).filter(comment => options.includeComments || (options.nativeSave && comment.origin === 'docx')).map(comment => [comment.id, comment])), revisionIds = new Map();
  const collectImages = async node => { if (node.type === 'image') { if (node.attrs?.wrap) warnings.add('Image text wrapping is not retained in Word documents.'); imageOptions.set(node, await imageForDocx(node)); } if (['tableCell', 'tableHeader'].includes(node.type) && (node.attrs?.cellBackground || node.attrs?.cellBorder)) warnings.add('Custom table cell colours are not retained in Word documents.'); for (const child of node.content || []) await collectImages(child); };
  for (const chapter of project.chapters) await collectImages(chapter.content);
  function inlines(nodes = [], header = false) {
    return nodes.flatMap(node => {
      if (node.type === 'hardBreak') return [new TextRun({ break: 1 })];
      if (node.type === 'note') {
        const endnote = node.attrs?.kind === 'endnote', collection = endnote ? endnotes : footnotes;
        const id = Object.keys(collection).length + 1;
        collection[id] = { children: [new Paragraph(String(node.attrs?.text || ''))] };
        return [endnote ? new EndnoteReferenceRun(id) : new FootnoteReferenceRun(id)];
      }
      if (node.type !== 'text') return inlines(node.content, header);
      const marks = node.marks || [], style = marks.find(m => m.type === 'textStyle')?.attrs || {};
      const highlight = colour(marks.find(m => m.type === 'highlight')?.attrs?.color || (marks.some(m => m.type === 'highlight') ? 'yellow' : style.backgroundColor));
      const runOptions = { style: officeStyleId(marks.find(m => m.type === 'namedStyle')?.attrs?.id), text: node.text, bold: header || marks.some(m => m.type === 'bold') || undefined, italics: marks.some(m => m.type === 'italic') || undefined, underline: marks.some(m => m.type === 'underline') ? {} : undefined, strike: marks.some(m => m.type === 'strike'), superScript: marks.some(m => m.type === 'superscript'), subScript: marks.some(m => m.type === 'subscript'), font: marks.some(m => m.type === 'code') ? 'Consolas' : style.fontFamily || undefined, size: fontSize(style.fontSize), color: colour(style.color), shading: highlight ? { type: ShadingType.CLEAR, fill: highlight } : undefined };
      const revision = options.includeTrackedChanges && marks.find(mark => mark.type === 'trackedChange');
      if (revision && !revisionIds.has(revision.attrs.id)) revisionIds.set(revision.attrs.id, revisionIds.size + 1);
      const run = revision ? new (revision.attrs.kind === 'delete' ? DeletedTextRun : InsertedTextRun)({ ...runOptions, id: revisionIds.get(revision.attrs.id), author: revision.attrs.author, date: revision.attrs.date }) : new TextRun(runOptions);
      const link = marks.find(m => m.type === 'link')?.attrs?.href;
      const content = link && /^(https?:|mailto:|tel:)/i.test(link) ? new ExternalHyperlink({ link, children: [run] }) : run;
      if (link && content === run) warnings.add('Internal or unsupported links retain their text but are not active in DOCX.');
      const attached = marks.filter(mark => mark.type === 'commentAnchor' && sharedComments.has(mark.attrs?.id)).map(mark => {
        const item = sharedComments.get(mark.attrs.id), id = comments.length;
        comments.push({ id, author: item.author || 'WRAITER', date: new Date(item.createdAt), resolved: !!item.resolved, children: [new Paragraph(item.text)] });
        return id;
      });
      return [...attached.map(id => new CommentRangeStart(id)), content, ...attached.slice().reverse().flatMap(id => [new CommentRangeEnd(id), new CommentReference(id)])];
    });
  }
  function paragraphOptions(node, quote, header = false) {
    const attrs = node.attrs || {}, indent = quote ? { left: 360, right: 360 } : {};
    if (attrs.leftIndent != null) indent.left = Math.round(Number(attrs.leftIndent) * 20);
    if (attrs.rightIndent != null) indent.right = Math.round(Number(attrs.rightIndent) * 20);
    if (attrs.firstLineIndent != null) {
      const value = Math.round(Number(attrs.firstLineIndent) * 20);
      if (value < 0) indent.hanging = Math.abs(value); else indent.firstLine = value;
    }
    const line = attrs.lineHeight || (attrs.namedStyle ? null : defaults.lineHeight);
    const absoluteLine = /(?:pt|px|in|cm|mm|pc)$/i.test(String(line)) ? points(line) : null;
    const spacing = { ...(attrs.spaceBefore != null ? { before: Math.round(Number(attrs.spaceBefore) * 20) } : {}), after: attrs.spaceAfter != null || !attrs.namedStyle ? Math.round(Number(attrs.spaceAfter ?? defaults.fontSize * 0.8) * 20) : undefined, line: line != null ? Math.round(absoluteLine != null ? absoluteLine * 20 : lineRatio(line, defaults.lineHeight) * 240) : undefined, lineRule: line != null ? (absoluteLine != null ? LineRuleType.EXACT : LineRuleType.AUTO) : undefined };
    return { style: officeStyleId(attrs.namedStyle), children: inlines(node.content, header), heading: node.type === 'heading' && !attrs.namedStyle ? HeadingLevel[`HEADING_${Math.min(6, attrs.level || 1)}`] : undefined, outlineLevel: node.type === 'heading' && attrs.namedStyle ? Math.min(5, (attrs.level || 1) - 1) : undefined, alignment: ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[attrs.textAlign], indent: Object.keys(indent).length ? indent : undefined, tabStops: attrs.tabStops?.map(position => ({ type: 'left', position: Math.round(position * 20) })), spacing, widowControl: true, pageBreakBefore: Boolean(attrs.pageBreakBefore) };
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
  const pageSetup = project.printLayout ? normalizePrintLayout(project.printLayout) : null;
  const mmToTwip = value => Math.round(value * 1440 / 25.4);
  const dimensions = pageSetup ? pageDimensions({ ...pageSetup, orientation: 'portrait' }) : null;
  const pageProperties = pageSetup ? { size: { width: mmToTwip(dimensions.width), height: mmToTwip(dimensions.height), orientation: pageSetup.orientation }, margin: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, mmToTwip(pageSetup[side])])) } : { size: { width: 11906, height: 16838 }, margin: { top: 1247, right: 1247, bottom: 1247, left: 1247 } };
  const runningText = text => new Paragraph({ alignment: AlignmentType.CENTER, children: String(text).split(/(\{page\}|\{pages\})/g).filter(Boolean).map(part => new TextRun(part === '{page}' ? { children: [PageNumber.CURRENT] } : part === '{pages}' ? { children: [PageNumber.TOTAL_PAGES] } : part)) });
  const document = new Document({ creator: 'WRAITER', title: project.title, numbering: { config: numbering }, ...(comments.length ? { comments: { children: comments } } : {}), ...(Object.keys(footnotes).length ? { footnotes } : {}), ...(Object.keys(endnotes).length ? { endnotes } : {}), styles: { ...docxStyleDefinitions(project), default: { document: { run: { font: defaults.fontFamily, size: Math.round(defaults.fontSize * 2), language: { value: language } }, paragraph: { spacing: { line: Math.round(defaults.lineHeight * 240), lineRule: LineRuleType.AUTO, after: Math.round(defaults.fontSize * 16) } } } } }, sections: [{ properties: { page: pageProperties }, ...(pageSetup?.header ? { headers: { default: new Header({ children: [runningText(pageSetup.header)] }) } } : {}), ...(pageSetup?.footer ? { footers: { default: new Footer({ children: [runningText(pageSetup.footer)] }) } } : {}), children }] });
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
  const pendingRevisions = source.chapters.some(chapter => { let found = false; const visit = node => { if (node.marks?.some(mark => mark.type === 'trackedChange')) found = true; if (!found) (node.content || []).forEach(visit); }; visit(chapter.content); return found; });
  if (options.nativeSave && pendingRevisions && !['docx', 'odt'].includes(format)) throw new Error('Pending tracked changes cannot yet be saved safely in this file format. Save a .wraiter, .docx or .odt copy, or resolve the changes first; the complete draft remains in recovery.');
  if (options.nativeSave && pendingRevisions && ['docx', 'odt'].includes(format)) options = { ...options, includeTrackedChanges: true };
  const aliases = { markdown: 'md', htm: 'html', 'bbcode-txt': 'bbcode', 'pdf-desktop': 'pdf', 'pdf-mobile': 'pdf' };
  if (format === 'pdf-desktop') options = { ...options, pdfPreset: 'desktop' };
  if (format === 'pdf-mobile') options = { ...options, pdfPreset: 'mobile' };
  format = aliases[format] || format;
  // Strip after scoping: a selected document can contain anchors independently
  // of the source chapters. Native JSON and companion state keep the originals.
  const exportedScope = exportScope(source, options);
  const retainChanges = ['docx', 'odt'].includes(format) && options.includeTrackedChanges;
  const retainComments = ['docx', 'odt'].includes(format) && (options.includeComments || options.nativeSave);
  const scoped = retainChanges || retainComments ? { ...exportedScope, chapters: exportedScope.chapters.map(chapter => ({ ...chapter, content: (retainComments ? value => value : stripCommentAnchors)(retainChanges ? chapter.content : acceptTrackedJSON(chapter.content)) })) } : publicationProject(exportedScope), titles = titleOptions(options);
  const project = options.includeContents && ['pdf', 'docx', 'odt'].includes(format) && options.scope !== 'selection' ? withExportContents(scoped, titles) : scoped;
  const lossWarnings = formatLosses(project, format);
  if (format === 'rich-text') {
    const html = (titles.includeTitle ? `<h1>${escape(project.title)}</h1>` : '') + project.chapters.map(chapter => (titles.includeChapterTitles ? `<h2>${escape(chapter.title)}</h2>` : '') + safeHTML(generateHTML(chapter.content, extensions))).join('');
    const container = document.createElement('div'); container.innerHTML = html;
    for (const img of container.querySelectorAll('img')) img.replaceWith(document.createTextNode(`[Image: ${img.alt || 'image omitted'}]`));
    const fragment = container.innerHTML;
    const text = [...(titles.includeTitle ? [project.title] : []), ...project.chapters.flatMap(chapter => [...(titles.includeChapterTitles ? [chapter.title] : []), nodeText(chapter.content, '\n', true)])].join('\n\n');
    return { format, title: project.title, data: `<!doctype html><html><head><meta charset="utf-8"><title>${escape(project.title)}</title></head><body>${fragment}</body></html>`, clipboardHTML: fragment, clipboardText: text, lossWarnings };
  }
  if (chatFormats.includes(format)) return { format, title: project.title, data: chatDocument(project, format, titles), lossWarnings };
  if (['pdf', 'html'].includes(format)) { const html = publicationHTML(project, extensions, { ...options, renderNotes: format === 'pdf' }); return { format, title: project.title, html, data: textEncoding(html, options), lossWarnings, ...(format === 'pdf' ? { pdfOptions: { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false }, pdfPreset: options.pdfPreset || 'standard' } : {}) }; }
  if (format === 'docx') { const result = await toDocx(project, options); return { format, title: project.title, ...result, lossWarnings: result.warning ? [result.warning] : [] }; }
  if (format === 'odt') { const result = await toODT(project, options); return { format, title: project.title, ...result, lossWarnings: result.warning ? [result.warning] : [] }; }
  if (format === 'epub') { const result = await toEPUB(project, chapter => safeHTML(generateHTML(chapter.content, extensions)), options); return { format, title: project.title, ...result, lossWarnings: result.warning ? [result.warning] : [] }; }
  if (format === 'txt') return { format, title: project.title, lossWarnings, data: textEncoding([...(titles.includeTitle ? [project.title] : []), ...project.chapters.flatMap(chapter => [...(titles.includeChapterTitles ? [chapter.title] : []), nodeText(chapter.content, '\n', true)])].join('\n\n'), options), warning: 'Plain text preserves manuscript wording without formatting; images become labelled placeholders.' };
  if (!['md', 'bbcode'].includes(format)) throw new Error(`Unsupported export format: ${format}`);
  return { format, title: project.title, lossWarnings, data: textEncoding(`${titles.includeTitle ? `${format === 'md' ? '# ' : ''}${inlineMarkup({ text: project.title }, format)}\n\n` : ''}${project.chapters.map(c => `${titles.includeChapterTitles ? `${format === 'md' ? '## ' : ''}${inlineMarkup({ text: c.title }, format)}\n\n` : ''}${blockMarkup(c.content, format)}`).join('\n')}`, options), warning: format === 'md' ? 'Markdown does not preserve fonts, colours, underlining, page layout, or merged table cells. Tables use their first row as a header; embedded images may not display in every Markdown reader.' : 'BBCode preserves basic emphasis, lists, and links. Fonts, colours, page layout, and table structure are simplified; images become placeholders. Numbered lists start at 1.' };
}
