import { exportPayload, importDocument, publicationHTML } from '../src/io.js';
import { newProject, paragraph } from '../src/document.js';
import { extensions } from '../src/Editor.jsx';
import JSZip from 'jszip';

const assert = (value, message) => { if (!value) throw new Error(message); };
export const samples = [
  ['Yellow', '#fff29b'], ['Green', '#8de5a1'], ['Blue', '#8bc7ff'], ['Pink', '#ff9ecb'],
  ['Orange', '#ffbe79'], ['Purple', '#c6adff'], ['Red', '#ff9292'], ['Grey', '#b9c0ca'],
  ['Deep blue', '#204b8f'], ['Black', '#000000'], ['White', '#ffffff'], ['Burgundy', '#61213f'],
  ['Named navy', 'navy'], ['RGB green', 'rgb(20, 95, 55)'], ['HSL red', 'hsl(0, 90%, 40%)'], ['Half-alpha red', '#ff000080']
];
const sourceTextColours = [['Black', '#000000'], ['White', '#ffffff'], ['Pink', '#c32882']];
const text = (value, marks = []) => ({ type: 'text', text: value, marks });
const cell = (value, header = false) => ({ type: header ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: Array.isArray(value) ? value : [text(value)] }] });
const mark = value => ({ type: 'highlight', attrs: { color: value } });
const style = attrs => ({ type: 'textStyle', attrs });
const all = node => [node, ...(node.content || []).flatMap(all)];

export async function highlightExportFixtures() {
  const project = newProject(); project.title = 'Highlight colour samples'; project.documentStyle = { fontFamily: 'Cambria', fontSize: 10, lineHeight: 1.35 };
  project.namedStyles = [{ id: 'red-words', name: 'Red words', kind: 'character', attrs: { color: '#ff0000', italic: true } }];
  const rows = [{ type: 'tableRow', content: ['Highlight', 'Black source text', 'White source text', 'Pink source text'].map(label => cell(label, true)) },
    ...samples.map(([name, colour], index) => ({ type: 'tableRow', content: [cell(name), ...sourceTextColours.map(([name, color]) => cell([text(`Sample ${index + 1} ${name}`, [style({ color }), mark(colour)])]))] }))];
  project.chapters[0].content = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Highlight colour samples')] },
    paragraph('Each highlight keeps the editor’s 26% strength. Text automatically becomes black or white for readability.'),
    { type: 'table', content: rows },
    { type: 'paragraph', content: [text('Imported background', [style({ backgroundColor: '#204b8f', color: '#204b8f' })])] },
    { type: 'paragraph', content: [text('Layered highlights', [style({ backgroundColor: '#0000ff', color: '#ff0000' }), mark('#00ff00')])] },
    { type: 'paragraph', content: [text('Named style and link', [{ type: 'namedStyle', attrs: { id: 'red-words' } }, { type: 'link', attrs: { href: 'https://example.com' } }, style({ color: '#ff0000' }), mark('#204b8f')])] },
    { type: 'paragraph', content: [text('Unhighlighted coloured text stays unchanged.', [style({ color: '#c32882' })])] }
  ] };
  const original = JSON.stringify(project), options = { includeTitle: false, includeChapterTitles: false };
  const light = await exportPayload(project, 'pdf', extensions, { ...options, colorMode: 'light' });
  const dark = await exportPayload(project, 'pdf', extensions, { ...options, colorMode: 'dark' });
  const files = [];
  for (const format of ['html', 'rich-text', 'epub', 'docx', 'odt']) {
    const result = await exportPayload(project, format, extensions, options);
    if (['docx', 'odt', 'epub'].includes(format)) files.push({ format, bytes: [...result.data] });
    else files.push({ format, html: result.html || result.clipboardHTML });
  }
  assert(JSON.stringify(project) === original, 'Publication export mutated the original manuscript');

  // Verify the actual external Office XML, not just our importer's view of it.
  for (const file of files.filter(item => ['docx', 'odt'].includes(item.format))) {
    const zip = await JSZip.loadAsync(file.bytes), xml = await zip.file(file.format === 'docx' ? 'word/document.xml' : 'content.xml').async('string');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    assert(!dom.querySelector('parsererror'), `${file.format} XML is malformed`);
    if (file.format === 'docx') {
      const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      for (const run of dom.getElementsByTagNameNS(ns, 'r')) {
        const shading = run.getElementsByTagNameNS(ns, 'shd')[0];
        if (shading) {
          assert(run.getElementsByTagNameNS(ns, 'color')[0]?.getAttributeNS(ns, 'val') === '000000', 'DOCX failed automatic text colour');
          assert(shading.getAttributeNS(ns, 'fill').toLowerCase() !== '204b8f', 'DOCX kept opaque deep blue');
        }
      }
      assert(xml.includes('C5D0E2'), 'DOCX deep blue did not flatten at 26% onto white');
    } else {
      const fo = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
      const ns = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
      for (const props of dom.getElementsByTagNameNS(ns, 'text-properties')) if (props.hasAttributeNS(fo, 'background-color')) {
        assert(props.getAttributeNS(fo, 'color') === '#000000', 'ODT failed automatic text colour');
      }
      assert(xml.includes('#c5d0e2'), 'ODT deep blue did not flatten at 26% onto white');
    }
  }

  // Regular saves must retain original colours rather than baking publication appearance.
  const native = newProject(); native.chapters[0].content = { type: 'doc', content: [
    { type: 'paragraph', content: [text('Original colours', [style({ color: '#ffffff' }), mark('#204b8f')])] }
  ] };
  for (const format of ['html', 'docx', 'odt']) {
    const result = await exportPayload(native, format, extensions, { nativeSave: true });
    const restored = await importDocument({ name: 'Native colours', extension: '.' + format, bytes: format === 'html' ? new TextEncoder().encode(result.data) : result.data }, extensions);
    const node = all(restored.project.chapters[0].content).find(node => node.text === 'Original colours');
    const colours = node.marks.flatMap(mark => [mark.attrs?.color, mark.attrs?.backgroundColor]).filter(Boolean);
    const context = document.createElement('canvas').getContext('2d');
    const normalized = colours.map(value => { context.fillStyle = value; return context.fillStyle; });
    assert(normalized.includes('#ffffff') && normalized.includes('#204b8f'), `${format} native save changed original colours`);
  }

  // Custom cell backgrounds also affect the colour actually under a highlight.
  const cells = newProject(); cells.chapters[0].content = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [
    { ...cell([text('Dark cell', [style({ color: '#000000' }), mark('#ffffff')])]), attrs: { cellBackground: '#000000' } },
    { ...cell([text('Light cell', [style({ color: '#ffffff' }), mark('#000000')])]), attrs: { cellBackground: '#ffffff' } }
  ] }] }] };
  const cellHTML = publicationHTML(cells, extensions, { includeTitle: false, includeChapterTitles: false });
  return { light: light.html, dark: dark.html, cellHTML, files, samples };
}
