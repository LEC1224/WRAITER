// Font popup geometry and keyboard focus in a headless synthetic browser.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser;
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 960, height: 650 } }), errors = [], passed = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/font-picker.html`);
    const top = page.getByRole('combobox', { name: 'Top font', exact: true }), bottom = page.getByRole('combobox', { name: 'Bottom font', exact: true }), search = () => page.getByRole('textbox', { name: 'Search fonts', exact: true });
    await top.waitFor(); await top.focus(); await top.press('ArrowDown'); await search().fill('Arial'); await search().press('Enter');
    assert.equal(await page.getByLabel('Chosen font', { exact: true }).innerText(), 'Arial'); assert.ok(await top.evaluate(element => element === document.activeElement));
    await top.press('ArrowDown'); assert.equal(await search().inputValue(), ''); assert.equal(await page.getByRole('option').count(), 502);
    await search().fill('Synthetic Font 300'); await search().press('Escape'); assert.ok(await top.evaluate(element => element === document.activeElement));
    await top.press('ArrowDown'); assert.equal(await search().inputValue(), '');
    await search().press('Tab'); assert.equal(await page.locator('.font-picker-popup').count(), 0); assert.ok(await page.getByLabel('After top font', { exact: true }).evaluate(element => element === document.activeElement));
    await top.focus(); await top.press('ArrowDown'); await search().press('Shift+Tab'); assert.equal(await page.locator('.font-picker-popup').count(), 0); assert.ok(await page.getByRole('button', { name: 'Before top font', exact: true }).evaluate(element => element === document.activeElement));
    passed.push('Keyboard choice and Escape return focus; reopening clears old filters and Tab follows the surrounding form.');
    await page.getByLabel('Return to editor after choosing', { exact: true }).check(); await top.click(); await search().fill('Cambria'); await search().press('Enter');
    assert.ok(await page.getByLabel('Synthetic editor', { exact: true }).evaluate(element => element === document.activeElement)); assert.equal(await page.getByLabel('Synthetic editor', { exact: true }).inputValue(), 'Synthetic text stays unchanged.');
    passed.push('The caller can still focus its editor after applying the font.');
    const geometry = picker => page.evaluate(label => {
      const button = [...document.querySelectorAll('[role=combobox]')].find(element => element.getAttribute('aria-label') === label), box = document.querySelector('.font-picker-popup').getBoundingClientRect(), anchor = button.getBoundingClientRect();
      return { box: box.toJSON(), anchor: anchor.toJSON(), width: innerWidth, height: innerHeight };
    }, picker);
    for (const [label, upwards] of [['Top font', false], ['Bottom font', true]]) {
      await page.getByRole('combobox', { name: label, exact: true }).click(); await search().waitFor(); await frames(page);
      const result = await geometry(label); assert.ok(result.box.top >= 0 && result.box.left >= 0 && result.box.right <= result.width && result.box.bottom <= result.height);
      assert.ok(upwards ? result.box.bottom <= result.anchor.top : result.box.top >= result.anchor.bottom);
      await page.getByRole('option', { name: 'Synthetic Font 450 Aa', exact: true }).scrollIntoViewIfNeeded();
      await search().fill('Synthetic Font 000'); await frames(page);
      assert.ok(await page.getByRole('option', { name: 'Synthetic Font 000 Aa', exact: true }).evaluate(element => { const bounds = element.closest('.font-picker-list').getBoundingClientRect(), box = element.getBoundingClientRect(); return box.top >= bounds.top && box.bottom <= bounds.bottom; }));
      await search().press('Escape');
    }
    passed.push('Long font lists stay inside a minimum-size viewport, open above low controls and reveal newly filtered options.');
    await bottom.click(); await search().waitFor(); await frames(page); const original = await geometry('Bottom font');
    await page.evaluate(() => { document.getElementById('font-scroll-container').scrollTop = 35; }); await frames(page); const scrolled = await geometry('Bottom font');
    assert.ok(Math.abs((scrolled.box.bottom - original.box.bottom) - (scrolled.anchor.top - original.anchor.top)) < 1);
    await page.setViewportSize({ width: 1440, height: 900 }); await frames(page); const resized = await geometry('Bottom font');
    assert.ok(resized.box.bottom <= resized.height && resized.box.right <= resized.width); assert.ok(Math.abs(resized.box.bottom - resized.anchor.top + 4) < 1);
    await search().press('Escape'); assert.equal(await page.locator('.font-picker-popup').count(), 0);
    await page.setViewportSize({ width: 960, height: 650 }); await bottom.click(); await search().waitFor(); await frames(page); assert.ok((await geometry('Bottom font')).box.bottom <= 650);
    passed.push('Open popups follow their anchor during form scrolling and viewport resize, and cleanly reopen.');
    assert.deepEqual(errors, []); passed.forEach(name => console.log(`PASS ${name}`));
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
