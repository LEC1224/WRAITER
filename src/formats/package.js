import JSZip from 'jszip';

export const xmlEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
export const metadataPath = 'wraiter/structure.json';

async function digest(source) {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
const contentParts = zip => Object.values(zip.files).filter(file => !file.dir && ![metadataPath, 'META-INF/manifest.xml', '[Content_Types].xml'].includes(file.name)).sort((a, b) => a.name.localeCompare(b.name));

// Only document structure is stored here. Private notes, references, history and a
// second copy of manuscript prose are never placed in an exported office file.
export async function addStructure(zip, sourcePath, project, chapters) {
  const source = await zip.file(sourcePath).async('string');
  const partHashes = {};
  for (const part of contentParts(zip)) partHashes[part.name] = await digest(await part.async('uint8array'));
  zip.file(metadataPath, JSON.stringify({ version: 1, sourceHash: await digest(source), partHashes, title: project.title, chapters }));
  if (sourcePath === 'word/document.xml') {
    const contentTypes = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', contentTypes.replace('</Types>', '<Override PartName="/wraiter/structure.json" ContentType="application/json"/></Types>'));
  }
}

export async function readStructure(zip, sourcePath) {
  const part = zip.file(metadataPath), source = zip.file(sourcePath);
  if (!part || !source) return null;
  try {
    if (part._data?.uncompressedSize > 1024 * 1024) return null;
    const value = JSON.parse(await part.async('string'));
    if (value.version !== 1 || typeof value.title !== 'string' || value.title.length > 500 || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > 1000) return null;
    if (value.chapters.some(c => typeof c.id !== 'string' || c.id.length > 200 || typeof c.title !== 'string' || c.title.length > 500 || !Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start < 0 || c.end < c.start)) return null;
    // An external editor may alter the document. Never apply stale block offsets
    // after that happens; import its complete visible content instead.
    if (value.sourceHash !== await digest(await source.async('string'))) return null;
    const parts = contentParts(zip);
    if (!value.partHashes || Object.keys(value.partHashes).length !== parts.length) return null;
    for (const part of parts) if (value.partHashes[part.name] !== await digest(await part.async('uint8array'))) return null;
    const xml = new DOMParser().parseFromString(await source.async('string'), 'application/xml');
    const office = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const body = sourcePath === 'content.xml' ? xml.getElementsByTagNameNS(office, 'text')[0] : xml.getElementsByTagNameNS(word, 'body')[0];
    if (!body) return null;
    const nodes = [...body.children].filter(node => node.localName !== 'sectPr');
    const visibleText = node => node.nodeType === 3 ? node.textContent : node.localName === 's' ? ' '.repeat(Math.min(10000, Number(node.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'c')) || 1)) : [...node.childNodes].map(visibleText).join('');
    let cursor = 0;
    const ids = new Set();
    for (let index = 0; index < value.chapters.length; index++) {
      const chapter = value.chapters[index];
      if (ids.has(chapter.id) || chapter.end <= chapter.start || chapter.start < cursor || chapter.end > nodes.length) return null;
      ids.add(chapter.id);
      const gap = nodes.slice(cursor, chapter.start);
      // Only publication title blocks may sit outside editable chapter content.
      // Invalid or tampered metadata must never hide arbitrary visible prose.
      if (gap.length > (index === 0 ? 2 : 1)) return null;
      if (gap.length) {
        const expected = index === 0 && gap.length === 2 ? [value.title, chapter.title] : [chapter.title];
        if (index === 0 && gap.length === 1 && visibleText(gap[0]) === value.title) expected[0] = value.title;
        if (gap.some((node, i) => !['h', 'p'].includes(node.localName) || visibleText(node) !== expected[i])) return null;
      }
      cursor = chapter.end;
    }
    if (cursor !== nodes.length) return null;
    return value;
  } catch { return null; }
}

export async function loadOfficePackage(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  if (names.length > 20000) throw new Error('The document contains too many package parts.');
  const expanded = Object.values(zip.files).reduce((sum, file) => sum + (file._data?.uncompressedSize || 0), 0);
  if (expanded > 150 * 1024 * 1024) throw new Error('The expanded document is too large to open safely.');
  return zip;
}
