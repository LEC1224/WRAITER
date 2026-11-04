import { loadOfficePackage } from './formats/package.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Convert simple Word text revisions to uniquely delimited ordinary runs for
// Mammoth. The delimiters are removed immediately after conversion. Refuse
// unsupported revision shapes instead of silently throwing deleted text away.
export async function prepareDocxRevisions(bytes, comments = new Map()) {
  const zip = await loadOfficePackage(bytes), entry = zip.file('word/document.xml');
  if (!entry) return { bytes, revisions: [], commentMarkers: [] };
  const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('This Word document has invalid document XML.');
  if (['moveFrom', 'moveTo', 'rPrChange', 'pPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange', 'sectPrChange'].some(name => xml.getElementsByTagNameNS(WORD, name).length)) throw new Error('This Word document contains tracked formatting, moves, or structural changes that WRAITER cannot import safely. Accept or reject those changes in Word first.');
  const wrappers = [...xml.getElementsByTagNameNS(WORD, 'ins'), ...xml.getElementsByTagNameNS(WORD, 'del')];
  if (wrappers.length > 10000) throw new Error('This Word document has too many revisions to import safely.');
  const revisions = [], tokenBase = `WRAITERREV${crypto.randomUUID().replaceAll('-', '')}`;
  function tokenRun(text) {
    const run = xml.createElementNS(WORD, 'w:r'), value = xml.createElementNS(WORD, 'w:t');
    value.textContent = text; run.append(value); return run;
  }
  for (const wrapper of wrappers) {
    const parent = wrapper.parentElement;
    if (!parent || !['p', 'hyperlink'].includes(parent.localName) || [...wrapper.children].some(child => child.namespaceURI !== WORD || child.localName !== 'r')) throw new Error('This Word document contains a structural tracked change that WRAITER cannot import safely. Accept or reject it in Word first.');
    for (const run of wrapper.children) for (const child of run.children) if (child.namespaceURI !== WORD || !['rPr', 't', 'delText', 'tab', 'br', 'cr'].includes(child.localName)) throw new Error('This Word document contains a tracked object or field that WRAITER cannot import safely.');
    const index = revisions.length, start = `${tokenBase}S${index}X`, end = `${tokenBase}E${index}X`;
    const rawDate = wrapper.getAttributeNS(WORD, 'date'), rawAuthor = wrapper.getAttributeNS(WORD, 'author') || 'Unknown author';
    revisions.push({ start, end, id: `revision_${crypto.randomUUID().replaceAll('-', '')}`, kind: wrapper.localName === 'del' ? 'delete' : 'insert', author: rawAuthor.slice(0, 200), date: rawDate && rawDate.length <= 100 ? rawDate : new Date().toISOString() });
    parent.insertBefore(tokenRun(start), wrapper);
    for (const run of [...wrapper.children]) {
      for (const deleted of [...run.getElementsByTagNameNS(WORD, 'delText')]) {
        const replacement = xml.createElementNS(WORD, 'w:t');
        for (const attribute of [...deleted.attributes]) replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        replacement.textContent = deleted.textContent; deleted.replaceWith(replacement);
      }
      parent.insertBefore(run, wrapper);
    }
    parent.insertBefore(tokenRun(end), wrapper); wrapper.remove();
  }
  const commentMarkers = [], commentToken = `WRAITERCOMMENT${crypto.randomUUID().replaceAll('-', '')}`;
  for (const name of ['commentRangeStart', 'commentRangeEnd']) for (const marker of [...xml.getElementsByTagNameNS(WORD, name)]) {
    const originalId = marker.getAttributeNS(WORD, 'id'), id = comments.get(originalId);
    if (!id) continue;
    const token = `${commentToken}${name === 'commentRangeStart' ? 'S' : 'E'}${commentMarkers.length}X`;
    commentMarkers.push({ token, id, open: name === 'commentRangeStart' });
    marker.replaceWith(tokenRun(token));
  }
  for (const reference of [...xml.getElementsByTagNameNS(WORD, 'commentReference')]) if (comments.has(reference.getAttributeNS(WORD, 'id'))) reference.remove();
  if (!revisions.length && !commentMarkers.length) return { bytes, revisions, commentMarkers };
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  return { bytes: await zip.generateAsync({ type: 'uint8array' }), revisions, commentMarkers };
}

export function restoreDocxRevisions(container, revisions) {
  if (!revisions.length) return;
  const map = new Map(revisions.flatMap(revision => [[revision.start, { revision, open: true }], [revision.end, { revision, open: false }]]));
  const pattern = new RegExp([...map.keys()].join('|'), 'g'), walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT), nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let active = null, seen = 0;
  for (const node of nodes) {
    const value = node.nodeValue, fragment = document.createDocumentFragment(); let position = 0, match;
    pattern.lastIndex = 0;
    function append(text) {
      if (!text) return;
      if (!active) fragment.append(document.createTextNode(text));
      else { const span = document.createElement('span'); span.setAttribute('data-wraiter-track-id', active.id); span.setAttribute('data-wraiter-track-kind', active.kind); span.setAttribute('data-wraiter-track-author', active.author); span.setAttribute('data-wraiter-track-date', active.date); span.textContent = text; fragment.append(span); }
    }
    while ((match = pattern.exec(value))) {
      append(value.slice(position, match.index)); const marker = map.get(match[0]);
      if (marker.open ? !!active : active !== marker.revision) throw new Error('Word revision boundaries could not be imported safely.');
      active = marker.open ? marker.revision : null; position = match.index + match[0].length; seen++;
    }
    append(value.slice(position)); node.replaceWith(fragment);
  }
  if (active || seen !== revisions.length * 2) throw new Error('Word revision boundaries could not be imported safely.');
}

export function restoreDocxComments(container, markers) {
  if (!markers.length) return;
  const map = new Map(markers.map(marker => [marker.token, marker]));
  const pattern = new RegExp([...map.keys()].join('|'), 'g'), walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT), nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const active = new Set(); let seen = 0;
  for (const node of nodes) {
    const value = node.nodeValue, fragment = document.createDocumentFragment(); let position = 0, match;
    pattern.lastIndex = 0;
    function append(text) {
      if (!text) return;
      let child = document.createTextNode(text);
      for (const id of active) { const span = document.createElement('span'); span.setAttribute('data-wraiter-import-comment-id', id); span.append(child); child = span; }
      fragment.append(child);
    }
    while ((match = pattern.exec(value))) {
      append(value.slice(position, match.index)); const marker = map.get(match[0]);
      if (marker.open ? active.has(marker.id) : !active.has(marker.id)) throw new Error('Word comment boundaries could not be imported safely.');
      if (marker.open) active.add(marker.id); else active.delete(marker.id);
      position = match.index + match[0].length; seen++;
    }
    append(value.slice(position)); node.replaceWith(fragment);
  }
  if (active.size || seen !== markers.length) throw new Error('Word comment boundaries could not be imported safely.');
}
