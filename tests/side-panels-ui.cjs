const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'side-panels-'));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, theme: 'dark' }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ args: [root], env, timeout: 60000 });
    const page = await app.firstWindow(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
    const buttons = page.getByRole('group', { name: 'Side panels', exact: true });
    const panels = ['Writing assistant', 'Reference library', 'Notes & voice', 'Comments', 'Review edits', 'Revision history'];
    assert.equal(await buttons.getByRole('button').count(), panels.length);
    for (const [width, height] of [[1280, 850], [960, 650]]) {
      await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setSize(width, height), { width, height });
      const close = page.getByRole('button', { name: 'Close side panel', exact: true });
      assert.equal(await close.isDisabled(), true);
      const positions = () => buttons.getByRole('button').evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
      const closedPositions = await positions();
      for (const title of panels) {
        const button = buttons.getByRole('button', { name: `Toggle ${title.toLowerCase()}`, exact: true });
        await button.click();
        await page.locator('.inspector-title').getByText(title, { exact: true }).waitFor();
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        assert.equal(await buttons.locator('[aria-pressed="true"]').count(), 1);
        assert.deepEqual(await positions(), closedPositions, `Navigation stays fixed for ${title} at ${width}`);
        assert.equal(await close.isEnabled(), true);
        const alignment = await page.locator('.inspector').evaluate(inspector => {
          const bar = document.querySelector('.document-topbar').getBoundingClientRect();
          const pane = inspector.getBoundingClientRect();
          const nav = document.querySelector('.side-panel-buttons').getBoundingClientRect();
          const close = document.querySelector('.side-panel-close').getBoundingClientRect();
          return { below: pane.top >= bar.bottom, above: nav.left >= pane.left && nav.right <= pane.right, separated: close.left > nav.right, rightmost: close.right <= bar.right && close.right > nav.right };
        });
        assert.deepEqual(alignment, { below: true, above: true, separated: true, rightmost: true });
        const layout = await page.locator('.document-topbar').evaluate(bar => {
          const rect = bar.getBoundingClientRect();
          const actions = bar.querySelector('.document-actions').getBoundingClientRect();
          const location = bar.querySelector('.document-location').getBoundingClientRect();
          return { fits: actions.right <= rect.right && actions.left >= location.right, visible: [...bar.querySelectorAll('.side-panel-buttons button')].every(button => { const r = button.getBoundingClientRect(); return r.left >= rect.left && r.right <= rect.right; }) };
        });
        assert.deepEqual(layout, { fits: true, visible: true }, `${title} fits at ${width}`);
        // Switching panels is direct; the previous one need not be closed first.
      }
      await page.screenshot({ path: path.join(output, `side-panels-${width}.png`) });
      await close.click();
      await page.locator('.inspector').waitFor({ state: 'hidden' });
      assert.equal(await buttons.locator('[aria-pressed="true"]').count(), 0);
    }
    await page.getByRole('button', { name: 'Toggle manuscript sidebar', exact: true }).click();
    await page.locator('.sidebar').waitFor({ state: 'hidden' });
    await buttons.getByRole('button', { name: 'Toggle comments', exact: true }).click();
    await page.locator('.comments-panel').waitFor();
    await page.getByRole('button', { name: 'Focus view', exact: true }).click();
    await page.locator('.inspector').waitFor({ state: 'hidden' });
    assert.equal(await buttons.locator('[aria-pressed="true"]').count(), 0);
    await buttons.getByRole('button', { name: 'Toggle comments', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.locator('.comments-panel').waitFor();
    await page.screenshot({ path: path.join(output, 'side-panels-minimum.png') });
    assert.deepEqual(errors, []);
    console.log('All six side panels: direct switching, toggle close, minimum layout, hidden manuscript sidebar, Focus view, and keyboard activation passed.');
  } finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
