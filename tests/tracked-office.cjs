// Independent LibreOffice conversion of synthetic tracked text.
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('playwright');
const JSZip = require('jszip');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '..');
(async () => {
  const { createServer } = await import('vite'), server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-tracked-office-')); let browser;
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    const data = await page.evaluate(async () => {
      const { exportPayload } = await import('/src/io.js'), { newProject } = await import('/src/document.js'), { extensions } = await import('/src/Editor.jsx');
      const input = newProject(), date = new Date().toISOString(); input.chapters[0].content = { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'old', marks: [{ type: 'trackedChange', attrs: { id: 'revision_old', kind: 'delete', author: 'Writer', date } }] },
        { type: 'text', text: 'new', marks: [{ type: 'trackedChange', attrs: { id: 'revision_new', kind: 'insert', author: 'Writer', date } }] },
        { type: 'text', text: ' anchor', marks: [{ type: 'commentAnchor', attrs: { id: 'sample_comment' } }] }
      ] }] };
      input.comments = [{ id: 'sample_comment', chapterId: input.chapters[0].id, text: 'synthetic note', quote: ' anchor', author: 'Reviewer', origin: 'odt', createdAt: date, updatedAt: date, resolved: false }];
      return Array.from((await exportPayload(input, 'odt', extensions, { nativeSave: true })).data);
    });
    const file = path.join(temp, 'tracked.odt'); await fs.writeFile(file, Buffer.from(data));
    const executable = process.env.WRAITER_LIBREOFFICE || 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
    await execute(executable, [`-env:UserInstallation=${pathToFileURL(path.join(temp, 'profile')).href}`, '--headless', '--convert-to', 'docx', '--outdir', temp, file], { timeout: 60000 });
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(temp, 'tracked.docx'))), xml = await zip.file('word/document.xml').async('string');
    if (!/<w:ins\b/.test(xml) || !/<w:del\b/.test(xml) || !xml.includes('old') || !xml.includes('new')) throw new Error('LibreOffice did not retain both tracked changes in its Word conversion.');
    const comments = zip.file('word/comments.xml') && await zip.file('word/comments.xml').async('string');
    if (!/<w:commentRangeStart\b/.test(xml) || !comments?.includes('synthetic note')) throw new Error('LibreOffice did not retain the anchored comment in its Word conversion.');
    console.log('LibreOffice retained tracked insertions, deletions and anchored comments when converting ODT to DOCX.');
  } finally { await browser?.close(); await server.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
