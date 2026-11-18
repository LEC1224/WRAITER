// Synthetic account, cloud documents and provider responses only. No paid AI.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const { defaults } = require('../electron/preferences.cjs');

(async () => {
  const { newProject } = await import('../src/document.js');
  const { createAccountVault, sealDocument, openDocument } = await import('../src/cloud-vault.js');
  const userId = 'synthetic-user', password = 'syntheticpassword2026', { key, vault } = await createAccountVault(userId, password);
  const project = newProject(); project.title = 'Mobile cloud test'; project.chapters[0].content.content[0].content = [{ type: 'text', text: 'A quiet morning.' }];
  let saved = { id: 'cloud1', sealed: await sealDocument(key, userId, 'cloud1', { project, journal: [] }), revision: 1 }, aiRequests = [], hostAIRequests = [];
  const directory = path.resolve(__dirname, '..', process.env.WRAITER_WEB_TEST_DIST || 'dist-web');
  const server = http.createServer(async (req, res) => {
    try {
      const target = path.resolve(directory, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!target.startsWith(directory + path.sep)) { res.writeHead(404); return res.end(); }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' }[path.extname(target)] || 'application/octet-stream';
      res.setHeader('Content-Type', mime); res.end(await fs.readFile(target));
    } catch { res.writeHead(404); res.end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true, timeout: 20000 });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.setDefaultTimeout(15000); const failures = []; page.on('pageerror', error => { failures.push(error.message); console.log('page error:', error.message); });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), method = route.request().method(); let result;
      if (url.pathname === '/api/auth/me' || url.pathname === '/api/auth/login') result = { sessionCacheTag: 'synthetic-session-tag', user: { id: userId, email: 'mobile@example.test', verified: true }, usedBytes: 500, quotaBytes: 1000000000, settings: { ...defaults, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'synthetic', enabled: true, taskProfiles: {}, setupComplete: true, tutorialComplete: true } };
      else if (url.pathname === '/api/vault') result = { vault, revision: 1, legacyDocuments: 0 };
      else if (url.pathname === '/api/documents' && method === 'GET') result = { documents: [{ id: 'cloud1', encrypted: true, metadata: saved.sealed.metadata, updatedAt: project.updatedAt, revision: saved.revision, bytes: 500 }], usedBytes: 500, quotaBytes: 1000000000 };
      else if (url.pathname === '/api/documents/cloud1' && method === 'GET') result = saved;
      else if (url.pathname.startsWith('/api/documents') && ['POST', 'PUT'].includes(method)) { const incoming = route.request().postDataJSON(); assert.ok(incoming.sealed && !incoming.project && !incoming.journal); assert.doesNotMatch(JSON.stringify(incoming), /quiet morning|bird began|Mobile cloud/); saved = { ...incoming, revision: saved.revision + 1 }; result = { id: 'cloud1', revision: saved.revision, bytes: 600, updatedAt: new Date().toISOString() }; }
      else if (url.pathname === '/api/settings') result = { settings: route.request().postDataJSON() };
      else if (url.pathname.startsWith('/api/ai')) { hostAIRequests.push(url.pathname); return route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ error: 'Use direct browser inference.' }) }); }
      else result = {};
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
    });
    await page.route('https://api.openai.com/v1/responses', async route => { aiRequests.push({ body: route.request().postDataJSON(), headers: route.request().headers() }); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'A bird began to sing.' }] }] }) }); });
    await page.goto(`http://127.0.0.1:${server.address().port}/web.html`, { timeout: 20000, waitUntil: 'domcontentloaded' });
    await page.locator('input[name=password]').fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    console.log('page loaded'); await page.locator('.web-doc-open').filter({ hasText: 'Mobile cloud test' }).click(); console.log('document opened');
    const editor = page.locator('.manuscript[contenteditable="true"]'); await editor.waitFor();
    const toolbar = page.getByRole('toolbar', { name: 'Quick writing tools' }); await toolbar.waitFor(); console.log('mobile bar ready');
    assert.equal(await page.locator('.writer-toolbar').isVisible(), false, 'formatting starts collapsed');
    assert.equal(await page.locator('.sidebar').count(), 0, 'chapters start closed');
    // A breakpoint may temporarily close mobile drawers; it must preserve the
    // desktop layout, including panels deliberately hidden by the writer.
    const navigation = page.getByRole('navigation', { name: 'Writing controls' });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('.sidebar').waitFor();
    assert.equal(await page.locator('.writer-toolbar').isVisible(), true, 'desktop formatting returns');
    await page.locator('.sidebar').getByRole('button', { name: 'Notes & voice', exact: true }).click();
    await page.locator('.inspector .notes-panel').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.sidebar').waitFor({ state: 'detached' });
    await page.locator('.inspector').waitFor({ state: 'detached' });
    await navigation.getByRole('button', { name: 'Chapters', exact: true }).click();
    await page.locator('.sidebar').waitFor();
    await navigation.getByRole('button', { name: 'Assistant', exact: true }).click();
    await page.locator('.sidebar').waitFor({ state: 'detached' });
    await page.locator('.inspector .chat-session-bar').waitFor();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('.sidebar').waitFor();
    await page.locator('.inspector .notes-panel').waitFor();
    assert.equal(await page.locator('.inspector .chat-session-bar').count(), 0, 'desktop inspector selection returns after mobile drawer use');
    await fs.mkdir(path.join(__dirname, '../test-output/web-cloud'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../test-output/web-cloud/editor-desktop-restored.png'), fullPage: true });
    await page.getByRole('button', { name: 'Toggle manuscript sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Close side panel', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await navigation.getByRole('button', { name: 'Format', exact: true }).click();
    assert.equal(await page.locator('.writer-toolbar').isVisible(), true, 'mobile formatting can be expanded');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('.mobile-tools-open').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.sidebar').count(), 0, 'intentionally closed desktop sidebar stays closed');
    assert.equal(await page.locator('.inspector').count(), 0, 'intentionally closed desktop inspector stays closed');
    assert.equal(await page.locator('.writer-toolbar').isVisible(), true, 'desktop toolbar returns independently of mobile formatting');
    await page.getByRole('button', { name: 'Toggle manuscript sidebar', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.sidebar').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.writer-toolbar').isVisible(), false, 'mobile formatting starts collapsed on the next visit');
    await editor.click(); await page.keyboard.press('Control+End');
    await toolbar.getByRole('button', { name: 'Bold', exact: true }).click(); await page.keyboard.insertText(' Bold words.');
    assert.match(await editor.innerHTML(), /<strong[^>]*> Bold words\.<\/strong>/);
    await toolbar.getByRole('button', { name: 'Bold', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Italic', exact: true }).click(); await page.keyboard.insertText(' Italic words.');
    assert.match(await editor.innerHTML(), /<em[^>]*> Italic words\.<\/em>/);
    await toolbar.getByRole('button', { name: 'Italic', exact: true }).click();
    await page.evaluate(() => window.wraiter.settings({ apiKey: 'synthetic-test-key', apiKeyTask: 'continue' }));
    console.log('formatted'); await toolbar.getByRole('button', { name: 'AI suggestion (Tab)' }).click();
    await toolbar.getByRole('button', { name: 'Accept AI suggestion (Tab)' }).waitFor();
    assert.equal(aiRequests.length, 1); assert.match(aiRequests[0].body.input, /A quiet morning/); assert.equal(aiRequests[0].body.store, false);
    assert.equal(aiRequests[0].headers.authorization, 'Bearer synthetic-test-key'); assert.deepEqual(hostAIRequests, []);
    await toolbar.getByRole('button', { name: 'Accept AI suggestion (Tab)' }).click();
    assert.match(await editor.textContent(), /A bird began to sing\./);
    await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { value: 420, configurable: true }); window.visualViewport.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(75); const bounds = await toolbar.boundingBox(); assert.ok(bounds.y + bounds.height <= 421 && bounds.y >= 360, 'quick bar follows keyboard viewport');
    console.log('AI accepted and viewport checked'); await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByText('View and settings', { exact: true }).click(); await page.getByRole('button', { name: 'AI connection', exact: true }).click();
    await page.getByRole('combobox', { name: 'Autocomplete provider' }).waitFor();
    assert.deepEqual(await page.getByRole('combobox', { name: 'Autocomplete provider' }).locator('option').evaluateAll(options => options.map(option => option.value)), ['openai', 'anthropic', 'compatible']);
    assert.equal(await page.getByRole('tab', { name: 'Local models', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('navigation', { name: 'Writing controls' }).getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('heading', { name: 'Document library', exact: true }).waitFor();
    assert.match(JSON.stringify((await openDocument(key, userId, 'cloud1', saved.sealed)).project), /A bird began to sing/);
    assert.deepEqual(failures, []); console.log('PASS mobile editor: desktop/mobile panel restoration, compact layout, selection-safe formatting, AI Tab preview/accept, keyboard toolbar positioning, cloud-only providers, save before library.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
