// Synthetic fixtures only. Uses an isolated headless browser, with no AI calls.
const path = require('node:path');
const { chromium } = require('playwright');
const { validateProject } = require('../electron/core.cjs');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  server.middlewares.use('/__io-tests', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>IO test harness</body></html>'); });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__io-tests`);
    const result = await page.evaluate(async () => (await import('/tests/io-browser.fixture.js')).runIOTests());
    result.importedProjects.forEach(project => validateProject(project));
    result.passed.forEach(name => console.log(`PASS ${name}`));
    console.log(`PASS ${result.importedProjects.length} imported projects satisfy native save validation`);
    console.log(`${result.passed.length} IO regression checks passed; synthetic DOCX ${result.docxBytes} bytes.`);
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
