import JSZip from 'jszip';
import { XML_HEADER, xmlEscape as esc } from './package.js';
import { titleOptions } from './scope.js';

export async function toEPUB(project, chapterHTML, options = {}) {
  const zip = new JSZip(), entries = [], spine = [], nav = [], images = new Map(), warnings = new Set();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `${XML_HEADER}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const language = project.language || 'en-US', titles = titleOptions(options);
  const style = { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5, ...project.documentStyle };
  zip.file('EPUB/styles.css', `body{font-family:serif;line-height:${style.lineHeight};margin:5%;overflow-wrap:break-word}h1,h2,h3{line-height:1.25;page-break-after:avoid}p{white-space:pre-wrap;margin:0 0 .8em;widows:2;orphans:2}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #888;padding:.35em}blockquote{margin-left:1em;padding-left:1em;border-left:2px solid #888}pre{white-space:pre-wrap}a{color:inherit}`);
  entries.push('<item id="style" href="styles.css" media-type="text/css"/>');
  const xhtml = (title, body) => `${XML_HEADER}<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(language)}" xml:lang="${esc(language)}"><head><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body>${body}</body></html>`;
  async function bodyHTML(html) {
    const root = document.createElement('div'); root.innerHTML = html;
    for (const image of root.querySelectorAll('img')) {
      const data = image.getAttribute('src') || '';
      if (!images.has(data)) {
        const match = data.match(/^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i);
        if (!match) { image.replaceWith(document.createTextNode(`[Image: ${image.alt || 'unavailable'}]`)); warnings.add('An unsupported image was replaced by a labelled placeholder.'); continue; }
        let type = match[1].toLowerCase().replace('jpg', 'jpeg'), base64 = match[2];
        if (type === 'webp') {
          const decoded = new Image();
          const valid = await new Promise(resolve => { const timer = setTimeout(() => resolve(false), 5000); decoded.onload = () => { clearTimeout(timer); resolve(true); }; decoded.onerror = () => { clearTimeout(timer); resolve(false); }; decoded.src = data; });
          if (!valid || decoded.naturalWidth * decoded.naturalHeight > 32_000_000) { image.replaceWith(document.createTextNode('[Image unavailable]')); warnings.add('An unreadable image was replaced by a labelled placeholder.'); continue; }
          const canvas = document.createElement('canvas'); canvas.width = decoded.naturalWidth; canvas.height = decoded.naturalHeight; canvas.getContext('2d').drawImage(decoded, 0, 0); base64 = canvas.toDataURL('image/png').split(',')[1]; type = 'png';
        }
        const id = `image-${images.size + 1}`, href = `images/${id}.${type === 'jpeg' ? 'jpg' : type}`;
        images.set(data, href); zip.file(`EPUB/${href}`, base64, { base64: true }); entries.push(`<item id="${id}" href="${href}" media-type="image/${type}"/>`);
      }
      image.setAttribute('src', images.get(data)); image.setAttribute('alt', image.alt || '');
    }
    // XMLSerializer closes HTML void elements and escapes text for valid XHTML.
    return [...root.childNodes].map(node => new XMLSerializer().serializeToString(node)).join('');
  }
  if (titles.includeTitle) {
    zip.file('EPUB/title.xhtml', xhtml(project.title, `<section epub:type="titlepage"><h1>${esc(project.title)}</h1>${options.author ? `<p>${esc(options.author)}</p>` : ''}</section>`));
    entries.push('<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>'); spine.push('<itemref idref="title"/>');
  }
  for (let index = 0; index < project.chapters.length; index++) {
    const chapter = project.chapters[index], id = `chapter-${index + 1}`, href = `${id}.xhtml`;
    const content = await bodyHTML(chapterHTML(chapter));
    zip.file(`EPUB/${href}`, xhtml(chapter.title, `<section epub:type="chapter">${titles.includeChapterTitles ? `<h1>${esc(chapter.title)}</h1>` : ''}${content}</section>`));
    entries.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`); spine.push(`<itemref idref="${id}"/>`); nav.push(`<li><a href="${href}">${esc(chapter.title)}</a></li>`);
  }
  zip.file('EPUB/nav.xhtml', xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${nav.join('')}</ol></nav>`));
  entries.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  const identifier = `urn:uuid:${crypto.randomUUID()}`, modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  zip.file('EPUB/package.opf', `${XML_HEADER}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${esc(language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${esc(project.title)}</dc:title><dc:language>${esc(language)}</dc:language>${options.author ? `<dc:creator>${esc(options.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${modified}</meta></metadata><manifest>${entries.join('')}</manifest><spine>${spine.join('')}</spine></package>`);
  return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), warning: [...warnings].join(' ') };
}
