const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

(async () => {
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  const output = await fs.mkdtemp(path.join(root, 'test-output', 'print-preview-'));
  const env = { ...process.env, WRAITER_USER_DATA: path.join(output, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await _electron.launch({ args: [root], env, timeout: 60000 });
  try {
    const page = await application.firstWindow();
    await page.waitForFunction(() => Boolean(window.wraiter));
    await application.evaluate(({ app }, temp) => app.setPath('temp', temp), output);
    const html = '<!doctype html><style>@page{size:letter landscape;margin:20mm;@top-center{content:"My manuscript"}@bottom-center{content:"Page " counter(page)}}</style><p>Preview test text</p>';
    await page.evaluate(html => window.wraiter.previewPDF({ format: 'pdf', html }), html);
    const state = await application.evaluate(({ BrowserWindow }) => {
      const preview = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Print preview' || window.webContents.getURL().endsWith('/preview.pdf'));
      return preview && { visible: preview.isVisible(), url: preview.webContents.getURL() };
    });
    assert(state?.visible && state.url.endsWith('/preview.pdf'), 'PDF preview must be visible');
    const previewPage = application.windows().find(window => window.url().endsWith('/preview.pdf'));
    assert(previewPage, 'Preview browser page is missing');
    await previewPage.waitForTimeout(2500); // The built-in PDF plugin renders after loadFile resolves.
    await previewPage.screenshot({ path: path.join(output, 'preview.png') });
    const directories = (await fs.readdir(output)).filter(name => name.startsWith('wraiter-preview-'));
    assert.equal(directories.length, 1);
    const bytes = await fs.readFile(path.join(output, directories[0], 'preview.pdf'));
    assert(bytes.toString('latin1', 0, 5) === '%PDF-');
    const inspected = JSON.parse(execFileSync('python', ['-c', 'import fitz,json,sys; d=fitz.open(sys.argv[1]); p=d[0]; print(json.dumps({"text":p.get_text(),"width":p.rect.width,"height":p.rect.height}))', path.join(output, directories[0], 'preview.pdf')], { encoding: 'utf8' }));
    assert(inspected.width > inspected.height, 'Landscape page orientation was lost');
    assert(inspected.text.includes('My manuscript') && inspected.text.includes('Page 1'), 'Printable header/footer or page number was lost');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().endsWith('/preview.pdf')).forEach(window => window.close()));
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!(await fs.readdir(output)).includes(directories[0])) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(!(await fs.readdir(output)).includes(directories[0]), 'Preview temporary document must be removed when closed');
    console.log('PASS PDF preview window and temporary-file cleanup');
  } finally {
    try { await (await application.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {}
    await application.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
