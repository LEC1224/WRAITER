// Find result paging in a headless browser, using synthetic UI state only.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const waitFor = async (fn, label) => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(label); };
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser;
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage(), errors = [], passed = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/search-panel.html`);
    await page.getByLabel('Find text', { exact: true }).waitFor();
    const paging = () => page.locator('.manuscript-search-pages').last(), active = () => page.locator('.manuscript-search-result[aria-current="true"]');
    const currentPage = async text => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await waitFor(async () => (await paging().innerText()).includes(text), `Expected result range ${text}`);
    };
    await currentPage('Showing 2401–2405 of 2405'); assert.equal(await active().count(), 1); assert.match(await active().innerText(), /Paragraph 2405/);
    await page.evaluate(() => window.searchPanelFixture.refresh());
    await currentPage('Showing 2401–2405 of 2405');
    // Wait past the effects as well as the initial render: a stale range could
    // briefly satisfy a check before a result refresh resets its page.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await paging().innerText(), /Showing 2401–2405 of 2405/); assert.equal(await active().count(), 1);
    await page.getByLabel('Find text', { exact: true }).fill('NEEDLE'); await currentPage('Showing 2401–2405 of 2405');
    await page.getByLabel('Match case', { exact: true }).check(); await currentPage('Showing 2401–2405 of 2405');
    passed.push('Refreshing equivalent results, query and options retains the selected result on its actual page.');
    await page.getByRole('button', { name: 'Previous search results', exact: true }).click(); await currentPage('Showing 2301–2400 of 2405'); assert.equal(await active().count(), 0);
    await page.getByLabel('Replacement text', { exact: true }).fill('target'); await currentPage('Showing 2301–2400 of 2405');
    await page.getByRole('button', { name: 'More search results', exact: true }).click(); await currentPage('Showing 2401–2405 of 2405'); assert.equal(await active().count(), 1);
    await page.evaluate(() => window.searchPanelFixture.setActive(105)); await currentPage('Showing 101–200 of 2405'); assert.match(await active().innerText(), /Paragraph 106/);
    passed.push('Manual paging remains available; replacement edits keep it and changing the selected match reveals its page.');
    await page.evaluate(() => window.searchPanelFixture.removeActive()); await currentPage('Showing 1–100 of 2404'); assert.equal(await active().count(), 0);
    await page.evaluate(() => window.searchPanelFixture.replaceResults(0)); await waitFor(async () => await page.locator('.manuscript-search-pages').count() === 0, 'empty results clear paging'); assert.equal(await page.getByText('No matches found.', { exact: true }).count(), 1);
    await page.evaluate(() => window.searchPanelFixture.replaceResults(205)); await currentPage('Showing 101–200 of 205'); assert.equal(await active().count(), 1);
    passed.push('Removing the active result returns to page one; empty and newly populated lists have valid page bounds.');
    await page.getByRole('button', { name: 'Preview replace all', exact: true }).click(); await currentPage('Showing 1–100 of 205');
    await page.getByRole('button', { name: 'More preview results', exact: true }).click(); await currentPage('Showing 101–200 of 205');
    await page.getByRole('button', { name: 'More preview results', exact: true }).click(); await currentPage('Showing 201–205 of 205');
    await page.getByRole('button', { name: 'Cancel preview', exact: true }).click(); await currentPage('Showing 101–200 of 205');
    passed.push('Replacement previews start at page one, can visit every result and return to the selected search page.');
    assert.deepEqual(errors, []); passed.forEach(name => console.log(`PASS ${name}`));
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
