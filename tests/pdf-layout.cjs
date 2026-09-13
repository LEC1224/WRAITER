// Actual Chromium PDF layout checks using synthetic wording and isolated data.
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', process.env.WRAITER_PDF_USER_DATA);
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    await window.loadURL(process.env.WRAITER_PDF_TEST_URL);
  });
} else {
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const { spawnSync } = require('node:child_process');
  const assert = require('node:assert/strict');
  const { _electron } = require('playwright');
  (async () => {
    const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output', `pdf-layout-${Date.now()}`);
    await fs.mkdir(output, { recursive: true });
    const { createServer } = await import('vite');
    const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/test-output/**', '**/release/**'] } }, logLevel: 'error' });
    server.middlewares.use('/__pdf-layout', (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta charset="utf-8"></head><body>PDF layout harness</body></html>'); });
    let application;
    try {
      await server.listen();
      application = await _electron.launch({ args: [__filename], env: { ...process.env, WRAITER_PDF_USER_DATA: path.join(output, 'profile'), WRAITER_PDF_TEST_URL: `http://127.0.0.1:${server.httpServer.address().port}/__pdf-layout` } });
      const page = await application.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      const payloads = await page.evaluate(async () => {
        const { exportPayload } = await import('/src/io.js');
        const { newProject, paragraph } = await import('/src/document.js');
        const { extensions } = await import('/src/Editor.jsx');
        const project = newProject(); project.title = 'Synthetic PDF layout';
        project.notes = 'PRIVATE CONTEXT MUST NOT PRINT';
        project.chapters = [{ id: 'first', title: 'Only printable chapter', status: 'Draft', content: { type: 'doc', content: Array.from({ length: 55 }, (_, index) => paragraph(`Paragraph ${index + 1}. The reader follows a clear line of text across the page. This synthetic sentence tests how the same words flow into different paper sizes without changing their content.`)) } }];
        return Promise.all(['standard', 'desktop', 'mobile'].map(pdfPreset => exportPayload(project, 'pdf', extensions, { pdfPreset })));
      });
      const results = [];
      for (const payload of payloads) {
        assert(!payload.html.includes('PRIVATE CONTEXT'), 'Private notes leaked into PDF HTML');
        const data = await application.evaluate(async ({ BrowserWindow }, html) => {
          const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
          try {
            await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
            await window.webContents.executeJavaScript('document.fonts.ready');
            const words = await window.webContents.executeJavaScript('document.body.innerText');
            const bytes = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 }, preferCSSPageSize: true, displayHeaderFooter: false });
            return { bytes: Array.from(bytes), words };
          } finally { window.destroy(); }
        }, payload.html);
        assert(data.words.includes('Paragraph 1.') && data.words.includes('Paragraph 55.'), 'PDF layout lost beginning or end of synthetic manuscript');
        const bytes = Buffer.from(data.bytes), pdf = bytes.toString('latin1');
        const box = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
        assert(box, 'PDF has no readable MediaBox');
        const [width, height] = box.slice(1).map(Number), pageCount = (pdf.match(/\/Type\s*\/Page\b/g) || []).length;
        const expected = { standard: [210, 297], desktop: [180, 255], mobile: [105, 187] }[payload.pdfPreset];
        assert(Math.abs(width - expected[0] / 25.4 * 72) < 1.2 && Math.abs(height - expected[1] / 25.4 * 72) < 1.2, `${payload.pdfPreset} actual PDF dimensions differ from its preset: ${width}×${height}`);
        assert(pageCount > 0 && pageCount < 80, 'Unexpected blank or excessive PDF pages');
        const file = path.join(output, `${payload.pdfPreset}.pdf`);
        await fs.writeFile(file, bytes);
        const extracted = spawnSync(process.env.WRAITER_TEST_PYTHON || 'python', ['-c', 'import fitz,json,sys; d=fitz.open(sys.argv[1]); d[0].get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(sys.argv[2]); print(json.dumps({"text":"\\n".join(p.get_text() for p in d)}))', file, path.join(output, `${payload.pdfPreset}.png`)], { encoding: 'utf8', windowsHide: true });
        if (extracted.status === 0) {
          const actualText = JSON.parse(extracted.stdout).text;
          for (let index = 1; index <= 55; index++) assert(new RegExp(`Paragraph\\s+${index}\\.`).test(actualText), `Printed PDF omitted paragraph ${index}`);
          assert(!actualText.includes('PRIVATE CONTEXT'), 'Printed PDF contains private context');
          console.log(`PASS ${payload.pdfPreset} extracted PDF retains all 55 paragraphs`);
        } else console.log('SKIP optional PDF text extraction: Python with PyMuPDF is unavailable');
        results.push({ preset: payload.pdfPreset, width, height, pageCount });
        console.log(`PASS ${payload.pdfPreset} actual PDF ${width} × ${height} pt; ${pageCount} pages`);
      }
      assert(results[2].pageCount > results[0].pageCount, 'Mobile preset did not reflow into more pages');
      const manual = await page.evaluate(async () => {
        const { exportPayload } = await import('/src/io.js'), { newProject, paragraph } = await import('/src/document.js'), { extensions } = await import('/src/Editor.jsx');
        const project=newProject();project.chapters[0].content={type:'doc',content:[paragraph('First manual page.'),{...paragraph('Second manual page.'),attrs:{pageBreakBefore:true}}]};
        return exportPayload(project,'pdf',extensions,{includeTitle:false,includeChapterTitles:false});
      });
      const manualBytes=await application.evaluate(async({BrowserWindow},html)=>{
        const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        try{await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await window.webContents.executeJavaScript('document.fonts.ready');return Array.from(await window.webContents.printToPDF({preferCSSPageSize:true,printBackground:true}))}finally{window.destroy()}
      },manual.html);
      const manualPDF=Buffer.from(manualBytes);assert.equal((manualPDF.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,2,'Manual break did not create a second printed page');
      await fs.writeFile(path.join(output,'manual-break.pdf'),manualPDF);console.log('PASS manual paragraph break produces exactly two PDF pages');
      console.log(`PASS PDF presets render without clipping manuscript endpoints; saved in ${output}`);
    } finally { await application?.close(); await server.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
