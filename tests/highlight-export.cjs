// Synthetic samples through the production exporters; no personal manuscripts.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

(async () => {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output', 'highlight-export');
  await fs.mkdir(output, { recursive: true });
  const { createServer } = await import('vite');
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/test-output/**', '**/release/**'] } }, logLevel: 'error' });
  server.middlewares.use('/__highlight-export', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body>Highlight export tests</body>'); });
  let browser;
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__highlight-export`);
    const result = await page.evaluate(async () => (await import('/tests/highlight-export.fixture.js')).highlightExportFixtures());
    const report = { passed: false, combinations: 0, checks: [], samples: [] };
    const checkHTML = async (html, name, paper) => {
      await page.setContent(html); await page.evaluate(() => document.fonts.ready);
      const actual = await page.evaluate(() => {
        const rgb = colour => { const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); context.fillStyle = colour; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
        const luminance = values => values.slice(0, 3).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        const samples = [...document.querySelectorAll('mark, [data-wraiter-background]')].map(element => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); walker.nextNode();
          const leaf = walker.currentNode?.parentElement || element;
          const style = getComputedStyle(leaf), fg = rgb(style.color), bg = rgb(getComputedStyle(element).backgroundColor);
          const first = luminance(fg), second = luminance(bg);
          return { text: element.textContent, colour: style.color, background: getComputedStyle(element).backgroundColor, rgba: bg, contrast: (Math.max(first, second) + .05) / (Math.min(first, second) + .05) };
        });
        const plain = [...document.querySelectorAll('span')].find(element => element.textContent === 'Unhighlighted coloured text stays unchanged.');
        return { samples, plainColour: plain && getComputedStyle(plain).color };
      });
      for (const sample of actual.samples) {
        assert.ok(sample.contrast >= 4.5, `${name}: ${JSON.stringify(sample)}`);
        assert.ok(['rgb(0, 0, 0)', 'rgb(255, 255, 255)'].includes(sample.colour), `${name}: nonautomatic highlighted text`);
        assert.equal(sample.rgba[3], 255, `${name}: transparency was not flattened for printing`);
      }
      if (paper) {
        assert.equal(actual.samples.length, 52);
        assert.equal(actual.plainColour, 'rgb(195, 40, 130)');
        const deepBlue = actual.samples.find(sample => sample.text === 'Sample 9 Black');
        assert.equal(deepBlue.background, paper === 'light' ? 'rgb(197, 208, 226)' : 'rgb(28, 41, 61)');
        assert.equal(deepBlue.colour, paper === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
        report.combinations += 48;
      }
      report.samples.push({ format: name, minimumContrast: Math.min(...actual.samples.map(sample => sample.contrast)) });
      return actual;
    };
    for (const mode of ['light', 'dark']) {
      await checkHTML(result[mode], `PDF ${mode}`, mode);
      const filename = `Highlight samples - ${mode === 'light' ? 'White' : 'Dark'}`;
      await fs.writeFile(path.join(output, filename + '.html'), result[mode]);
      await page.pdf({ path: path.join(output, filename + '.pdf'), printBackground: true, preferCSSPageSize: true });
      const inspected = spawnSync(process.env.WRAITER_TEST_PYTHON || 'python', ['-c', 'import fitz,json,sys; d=fitz.open(sys.argv[1]); print(json.dumps({"text":" ".join(" ".join(p.get_text() for p in d).split()),"spans":[{"text":s["text"],"colour":s["color"]} for p in d for b in p.get_text("dict")["blocks"] if "lines" in b for l in b["lines"] for s in l["spans"]],"fills":[x["fill"] for p in d for x in p.get_drawings() if x.get("fill")]}))', path.join(output, filename + '.pdf')], { encoding: 'utf8', windowsHide: true });
      assert.equal(inspected.status, 0, inspected.stderr || 'PDF inspection failed');
      const pdf = JSON.parse(inspected.stdout);
      for (let index = 1; index <= 16; index++) for (const colour of ['Black', 'White', 'Pink']) assert.ok(pdf.text.includes(`Sample ${index} ${colour}`), 'Printed sample text missing');
      const printedSamples = pdf.spans.filter(span => span.text.includes('Sample '));
      assert.equal(printedSamples.length, 48);
      assert.ok(printedSamples.every(span => span.colour === (mode === 'light' ? 0 : 0xffffff)), 'Printed text colour differs from export preview');
      const expectedFill = mode === 'light' ? [197, 208, 226] : [28, 41, 61];
      assert.ok(pdf.fills.some(fill => fill.every((n, i) => Math.abs(n * 255 - expectedFill[i]) <= 1)), 'Printed PDF lost the blended blue background');
      const rendered = spawnSync('pdftoppm', ['-scale-to', '1400', '-png', path.join(output, filename + '.pdf'), path.join(output, filename)], { encoding: 'utf8', windowsHide: true });
      assert.equal(rendered.status, 0, rendered.stderr || 'PDF rendering failed');
    }
    const cells = await checkHTML(result.cellHTML, 'Cell backgrounds');
    assert.equal(cells.samples[0].colour, 'rgb(255, 255, 255)'); assert.equal(cells.samples[1].colour, 'rgb(0, 0, 0)');
    for (const file of result.files) {
      if (file.bytes) await fs.writeFile(path.join(output, 'Highlight samples.' + file.format), Buffer.from(file.bytes));
      if (file.html) await checkHTML(file.html, file.format, 'light');
      if (file.format === 'epub') {
        const JSZip = require('jszip'), zip = await JSZip.loadAsync(file.bytes);
        const html = await zip.file('EPUB/chapter-1.xhtml').async('string');
        const css = await zip.file('EPUB/styles.css').async('string');
        await checkHTML(html.replace('</head>', `<style>${css}</style></head>`), 'EPUB', 'light');
      }
    }
    assert.deepEqual(errors, []);
    report.passed = true;
    report.checks = ['16 highlight colours × 3 source text colours on white and dark pages', 'PDF, HTML, rich clipboard, EPUB, DOCX and ODT publication output', 'Native HTML/DOCX/ODT saves retain original colours', 'Named styles, links, imported and layered backgrounds, and dark/light table cells', 'Unhighlighted text and source manuscript unchanged'];
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, output }, null, 2));
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
