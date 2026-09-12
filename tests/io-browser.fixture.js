import { importDocument, exportPayload, safeHTML, publicationHTML } from '../src/io.js';
import { newProject, paragraph, nodeText, blockMarkup, inlineMarkup } from '../src/document.js';
import { extensions } from '../src/Editor.jsx';
import JSZip from 'jszip';

export async function runIOTests() {
  const passed = [], importedProjects = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, run) => { await run(); passed.push(name); };
  const all = node => [node, ...(node.content || []).flatMap(all)];
  const text = value => ({ type: 'text', text: value });
  const item = (...content) => ({ type: 'listItem', content });
  const list = { type: 'orderedList', attrs: { start: 7 }, content: [item(paragraph('First item'), paragraph('Same item continued'), { type: 'bulletList', content: [item(paragraph('Nested item'))] }), item(paragraph('Second item'))] };
  const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, rowspan: 1 }, content: [paragraph('Wide header')] }] }, { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [paragraph('Cell one'), paragraph('Second paragraph')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [paragraph('Cell two')] }] }] };
  const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 160; canvas.getContext('2d').fillRect(0, 0, 80, 160);
  const picture = canvas.toDataURL('image/png');
  const project = newProject(); project.title = 'Synthetic <test> & manuscript'; project.notes = 'PRIVATE NOTES'; project.references = [{ id: 'ref', title: 'PRIVATE REFERENCE', text: 'Not publication content.' }];
  project.documentStyle = { fontFamily: 'Palatino Linotype', fontSize: 14, lineHeight: 1.6 }; project.language = 'sv-SE';
  project.chapters[0].content = { type: 'doc', content: [
    { type: 'paragraph', attrs: { textAlign: 'center', lineHeight: 1.75, spaceAfter: 6, firstLineIndent: 18 }, content: [{ type: 'text', text: 'Formatted link', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '24px', color: '#aa1122' } }, { type: 'link', attrs: { href: 'https://example.com/page?one=1&two=2' } }] }] },
    { type: 'paragraph', attrs: { lineHeight: '18pt', spaceAfter: 0, firstLineIndent: -9 }, content: [{ type: 'text', text: 'Precise paragraph formatting.', marks: [{ type: 'textStyle', attrs: { fontSize: '11pt' } }] }] },
    list, table, { type: 'image', attrs: { src: picture, alt: 'Tall rectangle' } }, { type: 'blockquote', content: [paragraph('Quoted words')] },
  ] };
  await test('Text extraction keeps list and table paragraph boundaries', () => {
    assert(nodeText(list) === 'First item\nSame item continued\nNested item\nSecond item', 'List wording merged');
    assert(nodeText(table).includes('Cell one\nSecond paragraph\tCell two'), 'Table wording merged');
  });
  await test('Markdown numbering, nesting, literal syntax and BBCode quotes', () => {
    const md = blockMarkup(list);
    assert(md.startsWith('7. First item') && md.includes('8. Second item') && md.includes('   - Nested item'), 'List numbering or indentation changed');
    assert(inlineMarkup(text('[literal] *star*')) === '\\[literal\\] \\*star\\*', 'Literal Markdown syntax changed meaning');
    assert(blockMarkup(paragraph('1. Ordinary sentence')).startsWith('1\\. Ordinary sentence'), 'Literal paragraph became a numbered list');
    assert(blockMarkup({ type: 'hardBreak' }) === '  \n', 'Hard break became a soft Markdown break');
    assert(blockMarkup({ type: 'blockquote', content: [paragraph('Quote')] }, 'bbcode').includes('[quote]Quote[/quote]'), 'BBCode quote was Markdown');
    assert(blockMarkup(table).includes('| --- | --- |'), 'Markdown table missing separator');
  });
  await test('Sanitization retains typography and removes active or external content', () => {
    const html = safeHTML('<p style="color: red; background-image:url(https://example.com/pixel); position:fixed">Text<img src="https://example.com/track" onerror="alert(1)" alt="External"><script>evil()</script></p>');
    assert(!html.includes('<script') && !html.includes('onerror') && !html.includes('url(') && !html.includes('position:'), 'Active HTML or CSS remained');
    assert(!html.includes('<img') && html.includes('Image not embedded: External'), 'Remote image survived');
    assert(html.includes('color: red'), 'Basic typography was lost');
  });
  await test('UTF-16 and CR line endings import without changing Unicode', async () => {
    const encoded = [255, 254, ...Array.from('Aurora’s\r\nSå börjar det.').flatMap(c => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])];
    const result = await importDocument({ name: 'Encoding test', extension: '.txt', bytes: encoded }, extensions);
    importedProjects.push(result.project);
    assert(nodeText(result.project.chapters[0].content) === 'Aurora’s\nSå börjar det.', 'UTF-16 characters or paragraphs changed');
  });
  await test('ODT imports inherited styles, numbers, images, and notes separately', async () => {
    const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
    const zip = new JSZip();
    zip.file('styles.xml', `<office:document-styles ${ns}><office:styles><style:default-style style:family="paragraph"><style:text-properties fo:font-family="Cambria" fo:font-size="13pt" fo:language="sv" fo:country="SE"/><style:paragraph-properties fo:line-height="160%"/></style:default-style><style:style style:name="Base" style:family="paragraph"><style:text-properties fo:font-weight="bold"/><style:paragraph-properties fo:text-align="center" fo:line-height="175%" fo:margin-bottom="0.5cm" fo:text-indent="0.25in"/></style:style></office:styles></office:document-styles>`);
    zip.file('content.xml', `<office:document-content ${ns}><office:automatic-styles><style:style style:name="Derived" style:family="paragraph" style:parent-style-name="Base"><style:text-properties fo:font-style="italic" fo:font-size="14pt"/></style:style><text:list-style style:name="Numbered"><text:list-level-style-number text:level="1" style:num-format="1" text:start-value="3"/></text:list-style></office:automatic-styles><office:body><office:text><text:tracked-changes><text:changed-region><text:p>DELETED SECRET</text:p></text:changed-region></text:tracked-changes><text:h text:outline-level="2">Heading</text:h><text:p text:style-name="Derived">Styled prose<office:annotation><text:p>COMMENT ONLY</text:p></office:annotation><text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>NOTE ONLY</text:p></text:note-body></text:note></text:p><text:list text:style-name="Numbered"><text:list-item><text:p>Numbered entry</text:p></text:list-item></text:list><text:p><draw:frame draw:name="Tall rectangle"><draw:image xlink:href="Pictures/test.png"/></draw:frame></text:p><table:table><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>Merged cell</text:p></table:table-cell><table:covered-table-cell/></table:table-row></table:table></office:text></office:body></office:document-content>`);
    zip.file('Pictures/test.png', picture.split(',')[1], { base64: true });
    const result = await importDocument({ name: 'Synthetic ODT', extension: '.odt', bytes: await zip.generateAsync({ type: 'uint8array' }) }, extensions);
    importedProjects.push(result.project);
    const content = result.project.chapters[0].content, nodes = all(content), prose = nodeText(content);
    assert(!prose.includes('COMMENT ONLY') && !prose.includes('NOTE ONLY') && !prose.includes('DELETED SECRET'), 'Notes or deleted text leaked into manuscript');
    assert(prose.includes('Styled prose[1]') && result.project.notes.includes('NOTE ONLY') && result.project.notes.includes('COMMENT ONLY'), 'Footnote/comment was lost');
    const styled = nodes.find(n => n.type === 'text' && n.text.startsWith('Styled prose'));
    assert(styled.marks.some(m => m.type === 'bold') && styled.marks.some(m => m.type === 'italic'), 'Style inheritance lost');
    assert(nodes.some(n => n.type === 'paragraph' && n.attrs?.textAlign === 'center'), 'Paragraph alignment lost');
    const formatted = nodes.find(n => n.type === 'paragraph' && n.attrs?.textAlign === 'center');
    assert(formatted.attrs.lineHeight === '175%' && Math.abs(formatted.attrs.spaceAfter - 14.1732) < 0.01 && formatted.attrs.firstLineIndent === 18, 'ODT paragraph spacing or units lost');
    assert(result.project.documentStyle.fontFamily === 'Cambria' && result.project.documentStyle.fontSize === 13 && result.project.documentStyle.lineHeight === 1.6 && result.project.language === 'sv-SE', 'ODT document defaults or language lost');
    assert(nodes.some(n => n.type === 'orderedList' && n.attrs.start === 3), 'ODT list was not numbered from 3');
    assert(nodes.some(n => n.type === 'image' && n.attrs.src === picture), 'Embedded image lost');
    assert(nodes.some(n => n.type === 'tableCell' && n.attrs.colspan === 2), 'Merged cell lost');
  });
  let docx;
  await test('DOCX preserves lists, styles, links, merged cells and image aspect ratio', async () => {
    docx = await exportPayload(project, 'docx', extensions);
    const zip = await JSZip.loadAsync(docx.data), source = await zip.file('word/document.xml').async('string'), numbering = await zip.file('word/numbering.xml').async('string');
    const xml = new DOMParser().parseFromString(source, 'application/xml');
    const wordNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    assert(source.includes('w:sz w:val="36"') && source.includes('w:color w:val="AA1122"') && source.includes('w:hyperlink'), 'DOCX font size, colour or link lost');
    assert(numbering.includes('w:numFmt w:val="decimal"') && numbering.includes('w:start w:val="7"'), 'DOCX numbers became bullets or start reset');
    const continuation = [...xml.getElementsByTagNameNS(wordNS, 'p')].find(p => p.textContent === 'Same item continued');
    assert(continuation && continuation.getElementsByTagNameNS(wordNS, 'numPr').length === 0, 'Continuation paragraph became another list item');
    assert(source.includes('w:gridSpan w:val="2"'), 'Merged cell lost');
    const extent = xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
    assert(extent && Number(extent.getAttribute('cx')) / Number(extent.getAttribute('cy')) === 0.5, 'Image aspect ratio distorted');
    assert(!source.includes('PRIVATE NOTES') && !source.includes('PRIVATE REFERENCE'), 'Private project context exported');
  });
  await test('DOCX import keeps wording and underline from generated manuscript', async () => {
    const result = await importDocument({ name: 'DOCX copy', extension: '.docx', bytes: docx.data }, extensions), nodes = all(result.project.chapters[0].content);
    importedProjects.push(result.project);
    assert(nodes.some(n => n.type === 'text' && n.text === 'Formatted link' && n.marks?.some(m => m.type === 'underline')), 'Underline lost on import');
    assert(nodeText(result.project.chapters[0].content).includes('Same item continued'), 'DOCX wording lost');
    assert(nodes.some(n => n.type === 'orderedList'), 'DOCX numbering lost on import');
    assert(result.project.documentStyle.fontFamily === 'Palatino Linotype' && result.project.documentStyle.fontSize === 14 && result.project.documentStyle.lineHeight === 1.6 && result.project.language === 'sv-SE', 'DOCX document defaults or language lost');
    const formatted = nodes.find(n => n.type === 'paragraph' && nodeText(n) === 'Formatted link');
    assert(formatted?.attrs.lineHeight === '1.75' && formatted.attrs.spaceAfter === 6 && formatted.attrs.firstLineIndent === 18, 'DOCX paragraph spacing, alignment, or indentation lost');
  });
  await test('DOCX exports document defaults, point sizes and exact paragraph spacing', async () => {
    const zip = await JSZip.loadAsync(docx.data), styles = await zip.file('word/styles.xml').async('string'), source = await zip.file('word/document.xml').async('string');
    assert(styles.includes('Palatino Linotype') && styles.includes('w:sz w:val="28"') && styles.includes('w:lang w:val="sv-SE"'), 'DOCX defaults differ from manuscript typography');
    assert(source.includes('w:sz w:val="22"'), 'Point size was interpreted as pixels');
    const xml = new DOMParser().parseFromString(source, 'application/xml'), word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const para = [...xml.getElementsByTagNameNS(word, 'p')].find(p => p.textContent === 'Precise paragraph formatting.');
    const spacing = para.getElementsByTagNameNS(word, 'spacing')[0], indent = para.getElementsByTagNameNS(word, 'ind')[0];
    assert(spacing.getAttributeNS(word, 'line') === '360' && spacing.getAttributeNS(word, 'lineRule') === 'exact' && spacing.getAttributeNS(word, 'after') === '0', 'Exact spacing or zero after-space changed');
    assert(indent.getAttributeNS(word, 'hanging') === '180', 'Hanging indent changed');
  });
  await test('Publication exports escape titles and omit private context', () => {
    const html = publicationHTML(project, extensions);
    assert(html.includes('Synthetic &lt;test&gt; &amp; manuscript'), 'Publication title not escaped');
    assert(!html.includes('PRIVATE NOTES') && !html.includes('PRIVATE REFERENCE'), 'Publication includes private context');
    assert(html.includes('data:image/png'), 'Publication image not embedded');
    assert(html.includes('lang="sv-SE"') && html.includes('font-family:"Palatino Linotype"') && html.includes('font-size:14pt;line-height:1.6'), 'Publication ignores document language or font defaults');
    assert(html.includes('line-height: 1.75') && html.includes('margin-bottom: 6pt') && html.includes('text-indent: 18pt'), 'Publication paragraph layout missing');
  });
  await test('Lossy formats report limitations and unknown exports reject', async () => {
    assert((await exportPayload(project, 'bbcode', extensions)).warning.includes('images'), 'Loss warning missing');
    let rejected = false; try { await exportPayload(project, 'unsupported', extensions); } catch { rejected = true; }
    assert(rejected, 'Unknown export was silently accepted');
  });
  return { passed, docxBytes: docx.data.length, importedProjects };
}
