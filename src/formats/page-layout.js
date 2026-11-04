import { normalizePrintLayout } from '../print-layout.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const S = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0', F = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const parse = source => new DOMParser().parseFromString(source, 'application/xml');
function sizeFor(width, height) {
  const small = Math.min(width, height), large = Math.max(width, height);
  return Object.entries({ A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] }).find(([, size]) => Math.abs(size[0] - small) < 1 && Math.abs(size[1] - large) < 1)?.[0];
}
function odtText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.namespaceURI === T && node.localName === 'page-number') return '{page}';
  if (node.namespaceURI === T && node.localName === 'page-count') return '{pages}';
  if (node.namespaceURI === T && node.localName === 's') return ' '.repeat(Math.max(1, Math.min(500, Number(node.getAttributeNS(T, 'c')) || 1)));
  if (node.namespaceURI === T && node.localName === 'tab') return '\t';
  if (node.namespaceURI === T && node.localName === 'line-break') return '\n';
  return [...node.childNodes].map(odtText).join('');
}
function mm(value) { const m = String(value).match(/^([\d.]+)(mm|cm|in|pt)$/); return m ? Number(m[1]) * ({ mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 })[m[2]] : null; }
export async function odtPageLayout(zip) {
  const source = await zip.file('styles.xml')?.async('string'); if (!source) return null;
  const xml = parse(source), props = xml.getElementsByTagNameNS(S, 'page-layout-properties')[0]; if (!props) return null;
  const width = mm(props.getAttributeNS(F, 'page-width')), height = mm(props.getAttributeNS(F, 'page-height')), size = sizeFor(width, height); if (!size) return null;
  const settings = { size, orientation: width > height ? 'landscape' : 'portrait' };
  for (const side of ['top', 'right', 'bottom', 'left']) settings[side] = mm(props.getAttributeNS(F, `margin-${side}`) || props.getAttributeNS(F, 'margin')) ?? 22;
  for (const kind of ['header', 'footer']) { const node = xml.getElementsByTagNameNS(S, kind)[0]; settings[kind] = node ? [...node.getElementsByTagNameNS(T, 'p')].map(odtText).join('\n') : ''; }
  return normalizePrintLayout(settings);
}
function wordText(xml) {
  const token = instruction => /\bNUMPAGES\b/i.test(instruction) ? '{pages}' : /\bPAGE\b/i.test(instruction) ? '{page}' : '';
  return [...xml.getElementsByTagNameNS(W, 'p')].map(paragraph => {
    let text = ''; const fields = [];
    const append = value => { if (fields.length) fields.at(-1).result += value; else text += value; };
    function visit(node) {
      if (node.namespaceURI === W) {
        if (node.localName === 'fldSimple') { const value = token(node.getAttributeNS(W, 'instr') || ''); if (value) { append(value); return; } }
        if (node.localName === 'fldChar') {
          const type = node.getAttributeNS(W, 'fldCharType');
          if (type === 'begin') fields.push({ instruction: '', result: '' });
          else if (type === 'end' && fields.length) { const field = fields.pop(); append(token(field.instruction) || field.result); }
          return;
        }
        if (node.localName === 'instrText') { if (fields.length) fields.at(-1).instruction += node.textContent; return; }
        if (node.localName === 't') { append(node.textContent); return; }
        if (node.localName === 'tab') { append('\t'); return; }
        if (['br', 'cr'].includes(node.localName)) { append('\n'); return; }
      }
      for (const child of node.childNodes) visit(child);
    }
    visit(paragraph);
    while (fields.length) { const field = fields.pop(); append(token(field.instruction) || field.result); }
    return text;
  }).join('\n');
}
export async function docxPageLayout(zip, documentXML) {
  const xml = parse(documentXML), section = xml.getElementsByTagNameNS(W, 'sectPr')[0], page = section?.getElementsByTagNameNS(W, 'pgSz')[0], margins = section?.getElementsByTagNameNS(W, 'pgMar')[0];
  if (!page) return null;
  const width = Number(page.getAttributeNS(W, 'w')) * 25.4 / 1440, height = Number(page.getAttributeNS(W, 'h')) * 25.4 / 1440, size = sizeFor(width, height); if (!size) return null;
  const settings = { size, orientation: width > height ? 'landscape' : 'portrait' };
  for (const side of ['top', 'right', 'bottom', 'left']) { const value = margins?.getAttributeNS(W, side); settings[side] = value ? Number(value) * 25.4 / 1440 : 22; }
  const relSource = await zip.file('word/_rels/document.xml.rels')?.async('string'), relationships = relSource ? [...parse(relSource).getElementsByTagName('Relationship')] : [];
  for (const kind of ['header', 'footer']) {
    const reference = section?.getElementsByTagNameNS(W, `${kind}Reference`)[0], id = reference?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = relationships.find(item => item.getAttribute('Id') === id && item.getAttribute('TargetMode') !== 'External'), target = rel?.getAttribute('Target') || '';
    if (target && !target.includes('..') && !target.includes('://')) { const source = await zip.file('word/' + target.replace(/^\//, '').replace(/^word\//, ''))?.async('string'); if (source) settings[kind] = wordText(parse(source)); }
  }
  return normalizePrintLayout(settings);
}
