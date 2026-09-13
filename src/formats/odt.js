import JSZip from 'jszip';
import { XML_HEADER, xmlEscape as esc, addStructure } from './package.js';
import { titleOptions } from './scope.js';

const namespaces = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
const mime = 'application/vnd.oasis.opendocument.text';
const attributes = object => Object.entries(object).filter(([, value]) => value != null).map(([name, value]) => ` ${name}="${esc(value)}"`).join('');
const preservedText = value => String(value || '').split(/( +|\t|\n)/).map(part => /^ +$/.test(part) ? `<text:s text:c="${part.length}"/>` : part === '\t' ? '<text:tab/>' : part === '\n' ? '<text:line-break/>' : esc(part)).join('');
function cssColour(value) {
  if (!value) return null;
  const style = document.createElement('span').style; style.color = value;
  const rgb = style.color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb ? '#' + rgb.slice(1).map(n => (+n).toString(16).padStart(2, '0')).join('') : /^#[a-f\d]{6}$/i.test(style.color) ? style.color : null;
}
function odtSize(value) {
  const match = String(value || '').match(/^([\d.]+)(px|pt)?$/);
  return match ? `${Number(match[1]) * (match[2] === 'px' ? 0.75 : 1)}pt` : null;
}

export async function toODT(project, options = {}) {
  const zip = new JSZip(), warnings = new Set(), styles = [], styleCache = new Map(), pictures = [], imageNodes = new Map();
  const defaults = { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5, ...project.documentStyle };
  zip.file('mimetype', mime, { compression: 'STORE' });
  async function image(node) {
    const source = node.attrs?.src || '', match = source.match(/^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) { warnings.add('An external or unsupported image is replaced by a labelled placeholder.'); return; }
    const picture = new Image();
    const loaded = await new Promise(resolve => { const timer = setTimeout(() => resolve(false), 5000); picture.onload = () => { clearTimeout(timer); resolve(true); }; picture.onerror = () => { clearTimeout(timer); resolve(false); }; picture.src = source; });
    if (!loaded || !picture.naturalWidth || picture.naturalWidth * picture.naturalHeight > 32_000_000) { warnings.add('An unreadable or oversized image is replaced by a labelled placeholder.'); return; }
    let extension = match[1].toLowerCase().replace('jpeg', 'jpg'), base64 = match[2];
    if (extension === 'webp') {
      const canvas = document.createElement('canvas'); canvas.width = picture.naturalWidth; canvas.height = picture.naturalHeight; canvas.getContext('2d').drawImage(picture, 0, 0);
      extension = 'png'; base64 = canvas.toDataURL('image/png').split(',')[1];
    }
    const path = `Pictures/image-${pictures.length + 1}.${extension}`;
    const width = Math.min(600, Math.max(1, Number(node.attrs.width) || picture.naturalWidth));
    const height = Number(node.attrs.height) > 0 ? Number(node.attrs.height) : width * picture.naturalHeight / picture.naturalWidth;
    pictures.push({ path, type: `image/${extension === 'jpg' ? 'jpeg' : extension}` }); zip.file(path, base64, { base64: true });
    imageNodes.set(node, `<draw:frame draw:name="${esc(node.attrs.alt || 'Image')}" text:anchor-type="as-char" svg:width="${width * 0.75}pt" svg:height="${height * 0.75}pt"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${node.attrs.alt ? `<svg:desc>${esc(node.attrs.alt)}</svg:desc>` : ''}</draw:frame>`);
  }
  async function collect(node) { if (node.type === 'image') await image(node); for (const child of node.content || []) await collect(child); }
  for (const chapter of project.chapters) await collect(chapter.content);
  function style(family, para, run, parent) {
    const key = JSON.stringify([family, para, run, parent]);
    if (!styleCache.has(key)) {
      const name = `W${styles.length + 1}`;
      styles.push(`<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}>${para ? `<style:paragraph-properties${attributes(para)}/>` : ''}${run ? `<style:text-properties${attributes(run)}/>` : ''}</style:style>`);
      styleCache.set(key, name);
    }
    return styleCache.get(key);
  }
  function inline(node) {
    if (node.type === 'hardBreak') return '<text:line-break/>';
    if (node.type !== 'text') return (node.content || []).map(inline).join('');
    const marks = node.marks || [], textStyle = marks.find(mark => mark.type === 'textStyle')?.attrs || {}, props = {};
    if (marks.some(m => m.type === 'bold')) props['fo:font-weight'] = 'bold';
    if (marks.some(m => m.type === 'italic')) props['fo:font-style'] = 'italic';
    if (marks.some(m => m.type === 'underline')) props['style:text-underline-style'] = 'solid';
    if (marks.some(m => m.type === 'strike')) props['style:text-line-through-style'] = 'solid';
    if (marks.some(m => m.type === 'code')) props['fo:font-family'] = 'Consolas';
    if (textStyle.fontFamily) props['fo:font-family'] = textStyle.fontFamily;
    if (textStyle.fontSize) props['fo:font-size'] = odtSize(textStyle.fontSize);
    if (textStyle.color) props['fo:color'] = cssColour(textStyle.color);
    const highlight = marks.find(m => m.type === 'highlight');
    if (highlight || textStyle.backgroundColor) props['fo:background-color'] = cssColour(highlight?.attrs?.color || textStyle.backgroundColor || '#ffff00');
    let result = preservedText(node.text);
    if (Object.keys(props).length) result = `<text:span text:style-name="${style('text', null, props)}">${result}</text:span>`;
    const link = marks.find(m => m.type === 'link')?.attrs?.href;
    if (link && /^(https?:|mailto:)/i.test(link)) result = `<text:a xlink:href="${esc(link)}" xlink:type="simple">${result}</text:a>`;
    else if (link) warnings.add('An unsupported link retains its wording but is not active.');
    return result;
  }
  let tableIndex = 0;
  function block(node, quote = false, depth = 1, header = false) {
    const attrs = node.attrs || {}, children = node.content || [];
    if (['paragraph', 'heading'].includes(node.type)) {
      const props = {};
      if (attrs.textAlign) props['fo:text-align'] = attrs.textAlign;
      if (attrs.pageBreakBefore) props['fo:break-before'] = 'page';
      if (attrs.spaceAfter != null) props['fo:margin-bottom'] = `${Number(attrs.spaceAfter)}pt`;
      if (attrs.firstLineIndent != null) props['fo:text-indent'] = `${Number(attrs.firstLineIndent)}pt`;
      if (attrs.lineHeight) props['fo:line-height'] = /^[\d.]+$/.test(String(attrs.lineHeight)) ? `${Number(attrs.lineHeight) * 100}%` : attrs.lineHeight;
      if (quote) { props['fo:margin-left'] = '18pt'; props['fo:margin-right'] = '18pt'; }
      const level = Math.min(6, Math.max(1, Number(attrs.level) || 1)), heading = node.type === 'heading';
      const styleName = style('paragraph', props, header ? { 'fo:font-weight': 'bold' } : null, heading ? `Heading_20_${level}` : quote ? 'Wraiter_Quote' : 'Standard');
      return heading ? `<text:h text:style-name="${styleName}" text:outline-level="${level}">${children.map(inline).join('')}</text:h>` : `<text:p text:style-name="${styleName}">${children.map(inline).join('')}</text:p>`;
    }
    if (node.type === 'image') return `<text:p>${imageNodes.get(node) || esc(`[Image omitted: ${attrs.alt || 'unsupported format'}]`)}</text:p>`;
    if (node.type === 'horizontalRule') return '<text:p text:style-name="Wraiter_Rule"/>';
    if (node.type === 'codeBlock') return `<text:p text:style-name="Wraiter_Code">${children.map(inline).join('')}</text:p>`;
    if (node.type === 'blockquote') return children.map(child => block(child, true, depth)).join('');
    if (['bulletList', 'orderedList'].includes(node.type)) {
      const ordered = node.type === 'orderedList', start = Math.max(1, Number(attrs.start) || 1);
      return `<text:list text:style-name="${ordered ? 'WNumber' : 'WBullet'}">${children.map((item, i) => `<text:list-item${ordered && i === 0 ? ` text:start-value="${start}"` : ''}>${(item.content || []).map(child => block(child, quote, depth + 1)).join('')}</text:list-item>`).join('')}</text:list>`;
    }
    if (node.type === 'table') {
      const occupied = [], table = ++tableIndex; let width = 1;
      const rows = children.map((row, y) => {
        let x = 0, output = '';
        const covered = () => { while (occupied[y]?.[x]) { output += '<table:covered-table-cell/>'; x++; } };
        for (const cell of row.content || []) {
          covered(); const colspan = Math.max(1, Number(cell.attrs?.colspan) || 1), rowspan = Math.max(1, Number(cell.attrs?.rowspan) || 1);
          output += `<table:table-cell table:style-name="${cell.type === 'tableHeader' ? 'WHeaderCell' : 'WCell'}" table:number-columns-spanned="${colspan}" table:number-rows-spanned="${rowspan}" office:value-type="string">${(cell.content || []).map(child => block(child, quote, 1, cell.type === 'tableHeader')).join('') || '<text:p/>'}</table:table-cell>`;
          for (let dy = 1; dy < rowspan; dy++) for (let dx = 0; dx < colspan; dx++) { occupied[y + dy] ||= []; occupied[y + dy][x + dx] = true; }
          x++; for (let dx = 1; dx < colspan; dx++) { output += '<table:covered-table-cell/>'; x++; }
        }
        covered(); width = Math.max(width, x);
        return { xml: `<table:table-row>${output}</table:table-row>`, header: row.content?.length && row.content.every(cell => cell.type === 'tableHeader') };
      });
      let headerCount = 0; while (rows[headerCount]?.header) headerCount++;
      const headerXML = headerCount ? `<table:table-header-rows>${rows.slice(0, headerCount).map(row => row.xml).join('')}</table:table-header-rows>` : '';
      return `<table:table table:name="Table${table}"><table:table-column table:number-columns-repeated="${width}"/>${headerXML}${rows.slice(headerCount).map(row => row.xml).join('')}</table:table>`;
    }
    return children.map(child => block(child, quote, depth)).join('');
  }
  const titles = titleOptions(options), fragments = [], chapters = [];
  if (titles.includeTitle) fragments.push(`<text:h text:style-name="Title" text:outline-level="1">${preservedText(project.title)}</text:h>`);
  for (const chapter of project.chapters) {
    if (titles.includeChapterTitles) fragments.push(`<text:h text:style-name="Heading_20_1" text:outline-level="1">${preservedText(chapter.title)}</text:h>`);
    const start = fragments.length;
    for (const node of chapter.content.content || []) {
      // A quote may serialize as several paragraphs; offsets describe XML blocks.
      const value = block(node), parsed = new DOMParser().parseFromString(`<root ${namespaces}>${value}</root>`, 'application/xml');
      for (const child of [...parsed.documentElement.children]) fragments.push(new XMLSerializer().serializeToString(child));
    }
    if (fragments.length === start) fragments.push('<text:p/>');
    chapters.push({ id: chapter.id, title: chapter.title, status: chapter.status || 'Draft', start, end: fragments.length });
  }
  const listStyles = ['WBullet', 'WNumber'].map(name => `<text:list-style style:name="${name}">${Array.from({ length: 10 }, (_, i) => name === 'WNumber' ? `<text:list-level-style-number text:level="${i + 1}" style:num-format="1" style:num-suffix="."><style:list-level-properties text:space-before="${(i + 1) * 0.5}cm" text:min-label-width="0.4cm"/></text:list-level-style-number>` : `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="•"><style:list-level-properties text:space-before="${(i + 1) * 0.5}cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet>`).join('')}</text:list-style>`).join('');
  zip.file('content.xml', `${XML_HEADER}<office:document-content ${namespaces} office:version="1.3"><office:automatic-styles>${styles.join('')}${listStyles}<style:style style:name="WCell" style:family="table-cell"><style:table-cell-properties fo:padding="0.08in" fo:border="0.5pt solid #aaaaaa"/></style:style><style:style style:name="WHeaderCell" style:family="table-cell"><style:table-cell-properties fo:padding="0.08in" fo:border="0.5pt solid #aaaaaa" fo:background-color="#f2f2f2"/></style:style></office:automatic-styles><office:body><office:text>${fragments.join('')}</office:text></office:body></office:document-content>`);
  const [language = 'en', country = 'US'] = (project.language || 'en-US').split('-');
  zip.file('styles.xml', `${XML_HEADER}<office:document-styles ${namespaces} office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="${defaults.lineHeight * 100}%" fo:margin-bottom="${defaults.fontSize * 0.8}pt"/><style:text-properties fo:font-family="${esc(defaults.fontFamily)}" fo:font-size="${defaults.fontSize}pt" fo:language="${esc(language)}" fo:country="${esc(country)}"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"/><style:style style:name="Title" style:family="paragraph"><style:text-properties fo:font-size="28pt" fo:font-weight="bold"/></style:style>${Array.from({ length: 6 }, (_, index) => `<style:style style:name="Heading_20_${index + 1}" style:family="paragraph"><style:paragraph-properties fo:keep-with-next="always"/><style:text-properties fo:font-size="${24 - index * 2}pt" fo:font-weight="bold"/></style:style>`).join('')}<style:style style:name="Wraiter_Code" style:family="paragraph"><style:text-properties fo:font-family="Consolas"/></style:style><style:style style:name="Wraiter_Quote" style:family="paragraph"/><style:style style:name="Wraiter_Rule" style:family="paragraph"><style:paragraph-properties fo:border-bottom="0.5pt solid #999999"/></style:style></office:styles><office:automatic-styles><style:page-layout style:name="WPage"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin="2.2cm" style:print-orientation="portrait"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="WPage"/></office:master-styles></office:document-styles>`);
  zip.file('meta.xml', `${XML_HEADER}<office:document-meta ${namespaces} xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"><office:meta><meta:generator>WRAITER</meta:generator><dc:title>${esc(project.title)}</dc:title><dc:language>${esc(project.language || 'en-US')}</dc:language></office:meta></office:document-meta>`);
  await addStructure(zip, 'content.xml', project, chapters);
  zip.file('META-INF/manifest.xml', `${XML_HEADER}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${mime}"/>${['content.xml', 'styles.xml', 'meta.xml'].map(path => `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="text/xml"/>`).join('')}<manifest:file-entry manifest:full-path="wraiter/structure.json" manifest:media-type="application/json"/>${pictures.map(picture => `<manifest:file-entry manifest:full-path="${picture.path}" manifest:media-type="${picture.type}"/>`).join('')}</manifest:manifest>`);
  return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), warning: [...warnings].join(' ') };
}
