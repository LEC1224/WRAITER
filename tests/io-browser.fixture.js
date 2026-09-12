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
  const native = newProject(); native.title = 'Native format roundtrip'; native.language = 'sv-SE'; native.documentStyle = project.documentStyle;
  native.chapters = [
    { id: 'chapter-a', title: 'Invisible chapter title one', status: 'Draft', content: { type: 'doc', content: [paragraph('Exact  spacing\twith a tab.  '), project.chapters[0].content.content[0], list, table, { type: 'image', attrs: { src: picture, alt: 'Tall rectangle' } }] } },
    { id: 'chapter-b', title: 'Invisible chapter title two', status: 'Revised', content: { type: 'doc', content: [paragraph('Second chapter: Så börjar det.'), paragraph(''), paragraph('A paragraph after an empty line.'), paragraph('')] } },
  ];
  for (const format of ['odt', 'docx']) await test(`Native ${format.toUpperCase()} saves preserve chapters, wording, typography and private-data boundaries`, async () => {
    const encoded = await exportPayload(native, format, extensions, { nativeSave: true });
    const zip = await JSZip.loadAsync(encoded.data), part = format === 'odt' ? 'content.xml' : 'word/document.xml', source = await zip.file(part).async('string');
    assert(!source.includes('Native format roundtrip') && !source.includes('Invisible chapter title'), 'Native save inserted publication titles into manuscript');
    assert(zip.file('wraiter/structure.json'), 'Chapter structure metadata absent');
    const restored = await importDocument({ name: 'filename', extension: `.${format}`, bytes: encoded.data }, extensions);
    importedProjects.push(restored.project);
    assert(restored.project.chapters.length === 2 && restored.project.chapters[1].id === 'chapter-b', 'Chapter split or identity lost');
    assert(nodeText(restored.project.chapters[1].content) === 'Second chapter: Så börjar det.\n\nA paragraph after an empty line.\n', 'Chapter text or empty paragraphs changed');
    assert(nodeText(restored.project.chapters[0].content).startsWith('Exact  spacing\twith a tab.  '), 'Repeated spaces, tab, or trailing spaces changed');
    const formatted = all(restored.project.chapters[0].content).find(n => n.type === 'text' && n.text === 'Formatted link');
    assert(formatted?.marks?.some(m => m.type === 'textStyle' && m.attrs.fontFamily === 'Arial' && ['18pt', '24px'].includes(m.attrs.fontSize)), 'Individual run font/size lost');
    assert(!restored.fidelity.requiresReview, 'Own supported document unexpectedly marked lossy: ' + restored.warning);
    if (format === 'odt') {
      assert(await zip.file('mimetype').async('string') === 'application/vnd.oasis.opendocument.text', 'ODT mimetype invalid');
      assert(source.includes('table:covered-table-cell') && source.includes('Pictures/image-1.png'), 'ODT merged cells or embedded image missing');
      const manifest = new DOMParser().parseFromString(await zip.file('META-INF/manifest.xml').async('string'), 'application/xml');
      assert(!manifest.querySelector('parsererror'), 'ODT manifest is invalid XML');
    }
    // External edits invalidate offsets. Import every visible block instead of
    // silently applying stale chapter boundaries to an edited document.
    zip.file(part, source.replace('Så', 'Över'));
    const edited = await importDocument({ name: 'external', extension: `.${format}`, bytes: await zip.generateAsync({ type: 'uint8array' }) }, extensions);
    assert(edited.project.chapters.length === 1 && nodeText(edited.project.chapters[0].content).includes('Second chapter: Över'), 'Stale package metadata overrode visible external edit');
    const tampered = await JSZip.loadAsync(encoded.data), metadata = JSON.parse(await tampered.file('wraiter/structure.json').async('string'));
    metadata.chapters[0].start += 1; tampered.file('wraiter/structure.json', JSON.stringify(metadata));
    const safe = await importDocument({ name: 'metadata changed', extension: `.${format}`, bytes: await tampered.generateAsync({ type: 'uint8array' }) }, extensions);
    assert(safe.project.chapters.length === 1 && nodeText(safe.project.chapters[0].content).includes('Exact  spacing'), 'Malformed chapter metadata hid visible manuscript text');
    const styleEdit = await JSZip.loadAsync(encoded.data), stylePart = format === 'odt' ? 'styles.xml' : 'word/styles.xml';
    styleEdit.file(stylePart, (await styleEdit.file(stylePart).async('string')).replace('Palatino Linotype', 'Times New Roman'));
    const editedStyles = await importDocument({ name: 'external style edit', extension: `.${format}`, bytes: await styleEdit.generateAsync({ type: 'uint8array' }) }, extensions);
    assert(editedStyles.project.documentStyle.fontFamily === 'Times New Roman' && editedStyles.fidelity.requiresReview, 'Style-only external edit incorrectly trusted original package metadata');
  });
  await test('All export scopes isolate selected or chapter content', async () => {
    const selected = { type: 'doc', content: [paragraph('ONLY THIS SELECTION')] };
    const selection = await exportPayload(native, 'txt', extensions, { scope: 'selection', chapterId: 'chapter-a', selectionDoc: selected });
    assert(selection.data === 'ONLY THIS SELECTION', 'Selected text export gained titles or unrelated text');
    const chapter = await exportPayload(native, 'txt', extensions, { scope: 'chapter', chapterId: 'chapter-b' });
    assert(chapter.data.includes('Second chapter: Så') && !chapter.data.includes('Exact') && !chapter.data.includes(native.title), 'Chapter export leaked other manuscript content');
    const docx = await exportPayload(native, 'docx', extensions, { scope: 'selection', selectionDoc: selected });
    const zip = await JSZip.loadAsync(docx.data), source = await zip.file('word/document.xml').async('string');
    assert(source.includes('ONLY THIS SELECTION') && !source.includes('Invisible chapter') && !source.includes('Exact'), 'Selected DOCX content scope incorrect');
  });
  await test('Native HTML and Markdown roundtrips retain actual formatting without title growth', async () => {
    const html = await exportPayload(native, 'html', extensions, { nativeSave: true });
    const restored = await importDocument({ name: 'native html', extension: '.html', bytes: new TextEncoder().encode(html.data) }, extensions);
    importedProjects.push(restored.project);
    assert(restored.project.chapters.length === 2 && restored.project.documentStyle.fontFamily === 'Palatino Linotype', 'Native HTML chapter/font metadata lost');
    assert(!nodeText(restored.project.chapters[0].content).includes('Invisible chapter title'), 'Native HTML title became manuscript text');
    const markdown = '# Heading\n\nA **bold** word and *italic* [link](https://example.com).\n\n3. One\n4. Two\n\n> A quotation\n';
    const imported = await importDocument({ name: 'Markdown', extension: '.md', bytes: new TextEncoder().encode(markdown) }, extensions);
    const nodes = all(imported.project.chapters[0].content);
    assert(nodes.some(n => n.type === 'orderedList' && n.attrs.start === 3) && nodes.some(n => n.type === 'text' && n.text === 'bold' && n.marks.some(m => m.type === 'bold')), 'Markdown syntax was left as literal text');
    const exported = await exportPayload(imported.project, 'md', extensions, { nativeSave: true });
    const twice = await importDocument({ name: 'Markdown', extension: '.md', bytes: new TextEncoder().encode(exported.data) }, extensions);
    assert(nodeText(twice.project.chapters[0].content) === nodeText(imported.project.chapters[0].content), 'Repeated Markdown save changed visible wording: ' + JSON.stringify([nodeText(imported.project.chapters[0].content), nodeText(twice.project.chapters[0].content), exported.data]));
  });
  await test('Native plain text preserves UTF-16 encoding, line endings and trailing newline', async () => {
    const value = 'Första raden\r\nSecond line\r\n';
    const bytes = new Uint8Array([255, 254, ...Array.from(value).flatMap(c => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]);
    const imported = await importDocument({ name: 'Plain text', extension: '.txt', bytes }, extensions);
    const result = await exportPayload(imported.project, 'txt', extensions, { nativeSave: true, fidelity: imported.fidelity });
    assert(result.data instanceof Uint8Array && result.data.length === bytes.length && result.data.every((n, i) => n === bytes[i]), 'Native UTF-16 text was not losslessly saved');
  });
  await test('Native save loss warnings describe actual unsupported content, without prompting on plain edits', async () => {
    const simple = newProject(); simple.chapters[0].content = { type: 'doc', content: [paragraph('Just words.'), paragraph('And another paragraph.')] };
    for (const format of ['txt', 'md', 'html', 'odt', 'docx']) assert((await exportPayload(simple, format, extensions, { nativeSave: true })).lossWarnings.length === 0, `Representable ${format} content incorrectly warns of loss`);
    simple.chapters[0].content.content[0].content[0].marks = [{ type: 'bold' }];
    assert((await exportPayload(simple, 'txt', extensions, { nativeSave: true })).lossWarnings.some(warning => warning.includes('inline formatting')), 'Rich plain text save has no actionable warning');
    assert((await exportPayload(simple, 'md', extensions, { nativeSave: true })).lossWarnings.length === 0, 'Markdown bold is unnecessarily flagged as a loss');
    simple.chapters[0].content.content[0].content[0].marks.push({ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '18pt' } });
    assert((await exportPayload(simple, 'md', extensions, { nativeSave: true })).lossWarnings.some(warning => warning.includes('individual fonts')), 'Markdown font loss is not reported');
    assert((await exportPayload(simple, 'html', extensions, { nativeSave: true })).lossWarnings.length === 0, 'HTML font support is incorrectly marked lossy');
  });
  await test('EPUB has an uncompressed first mimetype, valid package, complete spine and embedded assets', async () => {
    const payload = await exportPayload(native, 'epub', extensions);
    const bytes = payload.data, zip = await JSZip.loadAsync(bytes), header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert(header.getUint32(0, true) === 0x04034b50 && header.getUint16(8, true) === 0, 'EPUB first entry must be uncompressed');
    assert(new TextDecoder().decode(bytes.slice(30, 30 + header.getUint16(26, true))) === 'mimetype', 'EPUB mimetype is not first entry');
    assert(await zip.file('mimetype').async('string') === 'application/epub+zip', 'EPUB mimetype incorrect');
    const xml = new DOMParser().parseFromString(await zip.file('EPUB/package.opf').async('string'), 'application/xml');
    assert(!xml.querySelector('parsererror') && xml.documentElement.getAttribute('version') === '3.0', 'EPUB package is not valid EPUB3 XML');
    const opf = 'http://www.idpf.org/2007/opf', entries = [...xml.getElementsByTagNameNS(opf, 'item')];
    for (const entry of entries) assert(zip.file('EPUB/' + entry.getAttribute('href')), 'EPUB manifest references missing asset');
    assert(xml.getElementsByTagNameNS(opf, 'itemref').length === 3 && entries.some(item => item.getAttribute('properties') === 'nav'), 'EPUB chapter spine or navigation missing');
    const chapter = await zip.file('EPUB/chapter-1.xhtml').async('string');
    assert(!new DOMParser().parseFromString(chapter, 'application/xml').querySelector('parsererror'), 'EPUB chapter is not valid XHTML');
    assert(chapter.includes('images/image-1.png') && !chapter.includes('data:image') && !chapter.includes('PRIVATE'), 'EPUB image not packaged or private context leaked');
  });
  await test('PDF presets provide distinct page sizes, dark screen mode and scoped wording', async () => {
    const standard = await exportPayload(native, 'pdf', extensions), desktop = await exportPayload(native, 'pdf', extensions, { pdfPreset: 'desktop' }), mobile = await exportPayload(native, 'pdf', extensions, { pdfPreset: 'mobile', colorMode: 'dark', scope: 'chapter', chapterId: 'chapter-b' });
    assert(standard.html.includes('size:A4') && desktop.html.includes('size:180mm 255mm') && mobile.html.includes('size:105mm 187mm'), 'PDF presets share page dimensions');
    assert(mobile.html.includes('#1b1d20') && mobile.pdfOptions.printBackground && mobile.pdfOptions.preferCSSPageSize, 'Dark mobile PDF print settings missing');
    assert(!mobile.html.includes('Exact') && mobile.html.includes('Second chapter: Så'), 'PDF scope includes another chapter');
  });
  return { passed, docxBytes: docx.data.length, importedProjects };
}
