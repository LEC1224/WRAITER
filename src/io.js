import DOMPurify from 'dompurify';
import { generateHTML, generateJSON } from '@tiptap/core';
import JSZip from 'jszip';
import { newProject, uid, paragraph, exportText, blockMarkup, inlineMarkup } from './document.js';

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

// Imports are self-contained; opening one must not fetch external image URLs.
export function safeHTML(html) {
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'form', 'video', 'audio'], FORBID_ATTR: ['srcset'] });
  for (const img of fragment.querySelectorAll('img')) {
    if (!RASTER_DATA.test(img.getAttribute('src') || '')) img.replaceWith(document.createTextNode(`[Image not embedded: ${img.getAttribute('alt') || 'external or unsupported image'}]`));
    else img.setAttribute('src', img.getAttribute('src').replace(/^data:image\/jpg;/i, 'data:image/jpeg;'));
  }
  for (const link of fragment.querySelectorAll('a[href]')) if (!/^(https?:|mailto:)/i.test(link.getAttribute('href'))) link.removeAttribute('href');
  const allowed = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'background-color', 'text-align', 'text-decoration', 'text-decoration-line', 'white-space', 'line-height', 'margin-bottom', 'text-indent']);
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
  const zip = await JSZip.loadAsync(bytes), entry = zip.file('content.xml');
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
    if (tag === 'draw:image') return images.has(node) ? `<img src="${images.get(node)}" alt="${escape(attr(node.parentElement, 'draw:name') || 'Imported image')}">` : '[Image not imported]';
    if (tag === 'table:covered-table-cell') return '';
    let inner = [...node.childNodes].map(child => convert(child, tag === 'text:list' ? listDepth + 1 : listDepth)).join('');
    const family = ['text:p', 'text:h'].includes(tag) ? 'paragraph' : 'text', properties = resolvedStyle(attr(node, 'text:style-name'), family);
    const paragraphProperties = new Set(['text-align', 'line-height', 'margin-bottom', 'text-indent']);
    const css = Object.entries(properties).filter(([name]) => !paragraphProperties.has(name)).map(([name, value]) => `${name}:${value}`).join(';');
    if (css && ['text:p', 'text:h', 'text:span'].includes(tag)) inner = `<span style="${escape(css)}">${inner}</span>`;
    const paragraphCSS = Object.entries(properties).filter(([name]) => paragraphProperties.has(name)).map(([name, value]) => `${name}:${value}`).join(';');
    const alignment = ` style="white-space:pre-wrap;${escape(paragraphCSS)}"`;
    if (tag === 'text:p') return `<p${alignment}>${inner}</p>`;
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
      return `<td colspan="${colspan}" rowspan="${rowspan}">${inner || '<p></p>'}</td>`.repeat(boundedCount(attr(node, 'table:number-columns-repeated'), 100, 'table column repeat count'));
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
  return { html, language, documentStyle: { fontFamily: defaultProperties['font-family'] || DEFAULT_DOCUMENT_STYLE.fontFamily, fontSize: points(defaultProperties['font-size']) || DEFAULT_DOCUMENT_STYLE.fontSize, lineHeight: lineRatio(defaultProperties['line-height']) }, notes: notes.join('\n\n'), warning: 'Imported an ODT copy. Basic text, headings, emphasis, paragraph spacing and indents, links, embedded raster images, lists, and simple tables are supported. Page layout, tabs, advanced styles, and fields need review. Your original ODT is unchanged. ' + [...losses].join(' ') };
}

// Mammoth retains document structure. Enrich matching paragraphs with their OOXML layout,
// rather than rebuilding lists, hyperlinks, notes, tables, and images a second time.
async function docxTypography(bytes, html) {
  const zip = await JSZip.loadAsync(bytes), word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
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
    return { ...(fontFamily ? { fontFamily } : {}), ...(size > 0 ? { fontSize: size } : {}), ...(property(child(node, 'lang'), 'val') ? { language: property(child(node, 'lang'), 'val') } : {}) };
  };
  const paragraphStyle = node => {
    const spacing = child(node, 'spacing'), indent = child(node, 'ind'), result = {};
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
    const value = [...paragraph.getElementsByTagNameNS(word, 't')].map(node => node.textContent).join('');
    return { text: value.replace(/\s+/g, ' ').trim(), style: { ...base, ...resolved(property(child(properties, 'pStyle'), 'val')), ...paragraphStyle(properties) } };
  });
  const container = document.createElement('div'); container.innerHTML = html;
  let cursor = 0;
  for (const paragraph of container.querySelectorAll('p,h1,h2,h3,h4,h5,h6')) {
    const text = paragraph.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const index = rawParagraphs.findIndex((candidate, position) => position >= cursor && candidate.text === text);
    if (index < 0) continue;
    cursor = index + 1; const style = rawParagraphs[index].style;
    if (style.lineHeight != null) paragraph.style.lineHeight = String(style.lineHeight);
    if (style.spaceAfter != null) paragraph.style.marginBottom = `${style.spaceAfter}pt`;
    if (style.firstLineIndent != null) paragraph.style.textIndent = `${style.firstLineIndent}pt`;
    if (['left', 'center', 'right', 'justify'].includes(style.textAlign)) paragraph.style.textAlign = style.textAlign;
    if (style.fontFamily || style.fontSize) {
      const span = document.createElement('span');
      if (style.fontFamily) span.style.fontFamily = style.fontFamily;
      if (style.fontSize) span.style.fontSize = `${style.fontSize}pt`;
      while (paragraph.firstChild) span.append(paragraph.firstChild);
      paragraph.append(span);
    }
  }
  return { html: container.innerHTML, language: base.language, documentStyle: { fontFamily: base.fontFamily || DEFAULT_DOCUMENT_STYLE.fontFamily, fontSize: base.fontSize || DEFAULT_DOCUMENT_STYLE.fontSize, lineHeight: lineRatio(base.lineHeight) } };
}

export async function importDocument(payload, extensions) {
  const project = newProject(); project.title = payload.name || 'Imported manuscript';
  let content, warning = '';
  const bytes = new Uint8Array(payload.bytes), extension = payload.extension.toLowerCase();
  if (extension === '.docx') {
    const mammoth = await import('mammoth/mammoth.browser');
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer }, { styleMap: ['u => u', 'strike => s'] });
    const typography = await docxTypography(bytes, safeHTML(result.value));
    content = generateJSON(safeHTML(typography.html), extensions);
    if (typography.documentStyle) project.documentStyle = typography.documentStyle;
    if (typography.language) project.language = typography.language;
    warning = 'Imported a DOCX copy. Basic text, emphasis, document font, paragraph spacing and indents, headings, lists, images, external links, and tables are supported. Page layout, individual run fonts, comments, tracked changes, and advanced fields may not transfer; footnotes become ordinary text. Your original file is unchanged.';
    if (result.messages.length) warning += ` The converter reported ${result.messages.length} item(s) to review: ${result.messages.slice(0, 4).map(item => item.message).join(' ')}`;
  } else if (extension === '.odt') {
    const result = await importODT(bytes);
    content = generateJSON(safeHTML(result.html), extensions); warning = result.warning; project.notes = result.notes;
    project.documentStyle = result.documentStyle;
    if (result.language) project.language = result.language;
  } else {
    let text;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
    else text = new TextDecoder().decode(bytes);
    text = text.replace(/\r\n?/g, '\n');
    if (['.html', '.htm'].includes(extension)) {
      content = generateJSON(safeHTML(text), extensions);
      warning = 'Imported an HTML copy. Supported text formatting is retained; external images, custom layouts, and embedded content are replaced or omitted.';
    } else if (extension === '.md') {
      const html = text.split(/\n\n/).map(block => {
        const heading = block.match(/^(#{1,3})\s+(.+)$/);
        return heading ? `<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>` : `<p>${escape(block).replace(/\n/g, '<br>')}</p>`;
      }).join('');
      content = generateJSON(html, extensions);
      warning = 'Basic Markdown imported. Headings and paragraphs are recognised; other Markdown syntax is preserved as text.';
    } else content = { type: 'doc', content: text.split('\n').map(paragraph) };
  }
  if (!content.content?.length) content.content = [paragraph('')];
  project.chapters = [{ id: uid(), title: 'Manuscript', status: 'Draft', content }];
  return { project, warning };
}

export function publicationHTML(project, extensions) {
  const body = project.chapters.map(c => `<section><h1>${escape(c.title)}</h1>${safeHTML(generateHTML(c.content, extensions))}</section>`).join('');
  const style = documentStyle(project);
  return `<!doctype html><html lang="${escape(project.language || 'en-US')}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escape(project.title)}</title><style>@page{size:A4;margin:22mm}body{font-family:"${cssString(style.fontFamily)}",serif;font-size:${style.fontSize}pt;line-height:${style.lineHeight};color:#222;background:white;max-width:720px;margin:0 auto}h1,h2,h3{line-height:1.3;break-after:avoid}h1{font-size:25pt;margin:0 0 1em}.book-title{font-size:32pt;margin:1em 0 2em}p{orphans:3;widows:3;white-space:pre-wrap;margin:0 0 0.8em}section+section{break-before:page}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #aaa;padding:6px}blockquote{border-left:2px solid #aaa;margin-left:0;padding-left:1em}a{color:inherit}hr{border:0;text-align:center}hr:after{content:'*   *   *'}pre{white-space:pre-wrap}ul,ol{padding-left:2em}</style></head><body><h1 class="book-title">${escape(project.title)}</h1>${body}</body></html>`;
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
async function toDocx(project) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, ImageRun, ExternalHyperlink, LevelFormat, WidthType, ShadingType, LineRuleType } = await import('docx');
  const defaults = documentStyle(project), language = project.language || 'en-US';
  const numbering = [], warnings = new Set(), imageOptions = new Map();
  const collectImages = async node => { if (node.type === 'image') imageOptions.set(node, await imageForDocx(node)); for (const child of node.content || []) await collectImages(child); };
  for (const chapter of project.chapters) await collectImages(chapter.content);
  function inlines(nodes = []) {
    return nodes.flatMap(node => {
      if (node.type === 'hardBreak') return [new TextRun({ break: 1 })];
      if (node.type !== 'text') return inlines(node.content);
      const marks = node.marks || [], style = marks.find(m => m.type === 'textStyle')?.attrs || {};
      const highlight = colour(marks.find(m => m.type === 'highlight')?.attrs?.color || (marks.some(m => m.type === 'highlight') ? 'yellow' : style.backgroundColor));
      const run = new TextRun({ text: node.text, bold: marks.some(m => m.type === 'bold'), italics: marks.some(m => m.type === 'italic'), underline: marks.some(m => m.type === 'underline') ? {} : undefined, strike: marks.some(m => m.type === 'strike'), font: marks.some(m => m.type === 'code') ? 'Consolas' : style.fontFamily || undefined, size: fontSize(style.fontSize), color: colour(style.color), shading: highlight ? { type: ShadingType.CLEAR, fill: highlight } : undefined });
      const link = marks.find(m => m.type === 'link')?.attrs?.href;
      if (link && /^(https?:|mailto:|tel:)/i.test(link)) return [new ExternalHyperlink({ link, children: [run] })];
      if (link) warnings.add('Internal or unsupported links retain their text but are not active in DOCX.');
      return [run];
    });
  }
  function paragraphOptions(node, quote) {
    const attrs = node.attrs || {}, indent = quote ? { left: 360, right: 360 } : {};
    if (attrs.firstLineIndent != null) {
      const value = Math.round(Number(attrs.firstLineIndent) * 20);
      if (value < 0) indent.hanging = Math.abs(value); else indent.firstLine = value;
    }
    const line = attrs.lineHeight || defaults.lineHeight;
    const absoluteLine = /(?:pt|px|in|cm|mm|pc)$/i.test(String(line)) ? points(line) : null;
    const spacing = { after: Math.round(Number(attrs.spaceAfter ?? defaults.fontSize * 0.8) * 20), line: Math.round(absoluteLine != null ? absoluteLine * 20 : lineRatio(line, defaults.lineHeight) * 240), lineRule: absoluteLine != null ? LineRuleType.EXACT : LineRuleType.AUTO };
    return { children: inlines(node.content), heading: node.type === 'heading' ? HeadingLevel[`HEADING_${Math.min(6, attrs.level || 1)}`] : undefined, alignment: ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[attrs.textAlign], indent: Object.keys(indent).length ? indent : undefined, spacing, widowControl: true };
  }
  function blocks(nodes = [], depth = 0, quote = false) {
    return nodes.flatMap(node => {
      if (node.type === 'table') return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: (node.content || []).map(row => new TableRow({ tableHeader: row.content?.every(cell => cell.type === 'tableHeader'), children: (row.content || []).map(cell => { const children = blocks(cell.content); return new TableCell({ columnSpan: cell.attrs?.colspan || 1, rowSpan: cell.attrs?.rowspan || 1, children: children.length ? children : [new Paragraph('')] }); }) })) })];
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
              const options = paragraphOptions(child, quote);
              if (firstParagraph) { options.numbering = { reference, level }; firstParagraph = false; }
              else options.indent = { left: 360 * (level + 1) };
              return [new Paragraph(options)];
            }
            return blocks([child], depth + 1, quote);
          });
        });
      }
      if (node.type === 'paragraph' || node.type === 'heading') return [new Paragraph(paragraphOptions(node, quote))];
      if (node.type === 'codeBlock') return [new Paragraph({ children: inlines((node.content || []).map(n => ({ ...n, marks: [...(n.marks || []), { type: 'code' }] }))), spacing: { after: 160 } })];
      return blocks(node.content, depth, quote || node.type === 'blockquote');
    });
  }
  const children = [new Paragraph({ text: project.title, heading: HeadingLevel.TITLE }), ...project.chapters.flatMap((c, index) => [new Paragraph({ text: c.title, heading: HeadingLevel.HEADING_1, pageBreakBefore: index > 0 }), ...blocks(c.content.content)])];
  const document = new Document({ creator: 'WRAITER', title: project.title, numbering: { config: numbering }, styles: { default: { document: { run: { font: defaults.fontFamily, size: Math.round(defaults.fontSize * 2), language: { value: language } }, paragraph: { spacing: { line: Math.round(defaults.lineHeight * 240), lineRule: LineRuleType.AUTO, after: Math.round(defaults.fontSize * 16) } } } } }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1247, right: 1247, bottom: 1247, left: 1247 } } }, children }] });
  return { data: new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer()), warning: [...warnings].join(' ') };
}
export async function exportPayload(project, format, extensions) {
  if (['pdf', 'html'].includes(format)) { const html = publicationHTML(project, extensions); return { format, title: project.title, html, data: html }; }
  if (format === 'docx') return { format, title: project.title, ...await toDocx(project) };
  if (format === 'txt') return { format, title: project.title, data: exportText(project), warning: 'Plain text preserves manuscript wording without formatting; images become labelled placeholders.' };
  if (!['md', 'bbcode'].includes(format)) throw new Error(`Unsupported export format: ${format}`);
  return { format, title: project.title, data: `${format === 'md' ? '# ' : ''}${inlineMarkup({ text: project.title }, format)}\n\n${project.chapters.map(c => `${format === 'md' ? '## ' : ''}${inlineMarkup({ text: c.title }, format)}\n\n${blockMarkup(c.content, format)}`).join('\n')}`, warning: format === 'md' ? 'Markdown does not preserve fonts, colours, underlining, page layout, or merged table cells. Tables use their first row as a header; embedded images may not display in every Markdown reader.' : 'BBCode preserves basic emphasis, lists, and links. Fonts, colours, page layout, and table structure are simplified; images become placeholders. Numbered lists start at 1.' };
}
