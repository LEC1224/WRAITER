// Independent office-reader validation. No author manuscripts are opened.
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const office = process.env.WRAITER_TEST_LIBREOFFICE || 'C:\\Program Files\\LibreOffice\\program\\soffice.com';
  try { await fs.access(office); } catch { console.log('SKIP office interoperability: LibreOffice is unavailable'); return; }
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output', `office-interop-${Date.now()}`);
  await fs.mkdir(output, { recursive: true });
  const { createServer } = await import('vite');
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/test-output/**', '**/release/**'] } }, logLevel: 'error' });
  server.middlewares.use('/__office-tests', (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta charset="utf-8"></head><body>Office codec harness</body></html>'); });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__office-tests`);
    const files = await page.evaluate(async () => {
      const { exportPayload } = await import('/src/io.js'), { newProject, paragraph } = await import('/src/document.js'), { extensions } = await import('/src/Editor.jsx');
      const project = newProject(); project.title = 'PRIVATE APP TITLE'; project.notes = 'PRIVATE NOTES'; project.documentStyle = { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }; project.language = 'sv-SE';
      const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 80; canvas.getContext('2d').fillRect(0, 0, 40, 80);
      project.chapters = [{ id: 'first', title: 'PRIVATE CHAPTER TITLE', status: 'Draft', content: { type: 'doc', content: [
        paragraph('A visible opening paragraph. Så börjar det.'), paragraph(''),
        { type: 'paragraph', content: [{ type: 'text', text: 'A bold passage in Arial.', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '16pt', color: '#334455' } }] }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [paragraph('First numbered item')] }, { type: 'listItem', content: [paragraph('Second numbered item')] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, rowspan: 1 }, content: [paragraph('A merged header')] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('Left cell')] }, { type: 'tableCell', content: [paragraph('Right cell')] }] }] },
        { type: 'image', attrs: { src: canvas.toDataURL('image/png'), alt: 'Synthetic rectangle' } }, { ...paragraph('The final visible paragraph.'), attrs: { pageBreakBefore: true } }
      ] } }];
      return Promise.all(['odt', 'docx'].map(async format => ({ format, bytes: Array.from((await exportPayload(project, format, extensions, { nativeSave: true })).data) })));
    });
    for (const file of files) await fs.writeFile(path.join(output, `native-${file.format}.${file.format}`), Buffer.from(file.bytes));
    const profile = pathToFileURL(path.join(output, 'office-profile')).href;
    const converted = spawnSync(office, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', output, ...files.map(file => path.join(output, `native-${file.format}.${file.format}`))], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert(converted.status === 0, `LibreOffice could not open generated office files: ${converted.stderr || converted.error || converted.stdout}`);
    for (const file of files) {
      const pdf = path.join(output, `native-${file.format}.pdf`); await fs.access(pdf);
      const extracted = spawnSync(process.env.WRAITER_TEST_PYTHON || 'python', ['-c', 'import fitz,json,sys; d=fitz.open(sys.argv[1]); d[0].get_pixmap(matrix=fitz.Matrix(1.1,1.1)).save(sys.argv[2]); print(json.dumps({"text":"\\n".join(p.get_text() for p in d),"pages":len(d),"pageTexts":[p.get_text() for p in d],"fonts":[font[3] for p in d for font in p.get_fonts()]}))', pdf, path.join(output, `native-${file.format}.png`)], { encoding: 'utf8', windowsHide: true });
      assert(extracted.status === 0, 'PyMuPDF is required to inspect independent office rendering');
      const actual = JSON.parse(extracted.stdout);
      for (const text of ['A visible opening paragraph.', 'Så börjar det.', 'A bold passage in Arial.', 'First numbered item', 'Second numbered item', 'A merged header', 'Left cell', 'Right cell', 'The final visible paragraph.']) assert(actual.text.includes(text), `${file.format} lost visible content in independent office rendering: ${text}`);
      assert(actual.pages === 2 && !actual.pageTexts[0].includes('The final visible paragraph.') && actual.pageTexts[1].includes('The final visible paragraph.'), `${file.format} lost the explicit page break`);
      assert(!actual.text.includes('PRIVATE'), `${file.format} inserted app metadata into visible document`);
      assert(actual.fonts.some(name => /Arial/i.test(name)), `${file.format} lost individual run font in office rendering`);
      console.log(`PASS LibreOffice opens ${file.format.toUpperCase()} with native wording, lists, merged table, image and Arial formatting; ${actual.pages} page(s)`);
    }
    console.log(`PASS Independent office-rendered fixtures: ${output}`);
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
