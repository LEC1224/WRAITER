// Synthetic chapter and private application profile; navigation never edits prose.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (fn, label) => {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error(label);
};
(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'paragraph-navigation-'));
  const project = { format: 'wraiter', version: 1, id: 'paragraph-navigation', title: 'Paragraph navigation', language: 'en-US', references: [], notes: '', style: '', snapshots: [], chapters: [{ id: 'opening', title: 'A long chapter', content: { type: 'doc', content: Array.from({ length: 600 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${index + 1}. A quiet sentence with enough words to wrap, so navigation uses the manuscript's real paragraphs.` }] })) } }] };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', showParagraphNumbers: true, spellcheck: false }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app;
  try {
    app = await _electron.launch(options); const page = await app.firstWindow(), errors = [], checks = [];
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
    const dialog = () => page.getByRole('dialog', { name: 'Go to paragraph', exact: true });
    const input = () => dialog().getByRole('spinbutton', { name: 'Paragraph number', exact: true });
    const caretParagraph = () => editor.evaluate(element => element.editor.state.selection.$head.parent.textContent);
    const journalCount = () => page.evaluate(async () => (await window.wraiter.loadEditHistory('paragraph-navigation')).totalEvents);
    await waitFor(async () => await journalCount() >= 1, 'initial editing history');
    const beforeEvents = await journalCount(), originalText = await editor.innerText();
    await editor.locator('p').first().click(); await page.keyboard.press('Control+g'); await dialog().waitFor();
    await waitFor(() => input().evaluate(element => element === document.activeElement), 'paragraph field receives keyboard focus');
    assert.match(await dialog().innerText(), /1–600 in this chapter/);
    await page.keyboard.type('220'); assert.equal(await input().inputValue(), '220'); assert.match(await dialog().getByRole('status').innerText(), /Paragraph 220\./);
    await input().press('Enter'); await dialog().waitFor({ state: 'hidden' });
    await waitFor(async () => (await caretParagraph()).startsWith('Paragraph 220.'), 'correct distant paragraph');
    await waitFor(async () => await page.locator('.paragraph-numbers .text-number').filter({ hasText: /^220$/ }).count() === 1, 'matching margin number is rendered');
    const visible = await editor.evaluate(element => {
      const current = element.editor, caret = current.view.coordsAtPos(current.state.selection.head), bounds = element.closest('.writing-scroll').getBoundingClientRect();
      return caret.top >= bounds.top && caret.bottom <= bounds.bottom;
    });
    assert.ok(visible, 'destination caret is visible');
    checks.push('Ctrl+G focuses the number field; preview and wrapped-paragraph destination agree with the visible margin number.');

    await command('go-paragraph'); await dialog().waitFor(); assert.equal(await input().inputValue(), '220');
    for (const invalid of ['0', '601', '1.5', '']) { await input().fill(invalid); assert.ok(await dialog().getByRole('button', { name: 'Go to paragraph', exact: true }).isDisabled()); }
    await input().press('Escape'); await dialog().waitFor({ state: 'hidden' }); assert.ok((await caretParagraph()).startsWith('Paragraph 220.'));
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '&Edit').submenu.items.find(item => item.label === '&Go to paragraph…').click());
    await input().fill('600'); await dialog().getByRole('button', { name: 'Go to paragraph', exact: true }).click();
    await waitFor(async () => (await caretParagraph()).startsWith('Paragraph 600.'), 'native menu reaches the final paragraph');
    assert.equal(await editor.innerText(), originalText); assert.equal(await journalCount(), beforeEvents);
    checks.push('Invalid and fractional numbers are disabled; Escape preserves the cursor; native Go reaches the last paragraph without prose or history edits.');

    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'G', modifiers: ['control'] }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'G', modifiers: ['control'] }); });
    await dialog().waitFor(); assert.equal(await input().inputValue(), '600'); await input().press('Escape');
    checks.push('The real native Ctrl+G accelerator opens the dialog once.');
    await page.setViewportSize({ width: 960, height: 650 });
    for (const theme of ['Light', 'Dark', 'High contrast']) {
      await command('settings-appearance'); await page.getByRole('button', { name: theme, exact: true }).click(); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' });
      await command('go-paragraph'); await dialog().waitFor();
      assert.ok(await dialog().evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; }));
      await page.screenshot({ path: path.join(userData, `go-paragraph-${theme.replace(/ /g, '-').toLowerCase()}.png`) });
      await input().press('Escape'); await dialog().waitFor({ state: 'hidden' });
    }
    checks.push('The dialog and preview fit the minimum window in all three themes.');
    const beforeLinkSelection = await editor.evaluate(element => ({ from: element.editor.state.selection.from, to: element.editor.state.selection.to }));
    await editor.press('Control+k');
    const address = page.getByRole('textbox', { name: 'Link address', exact: true }); await address.waitFor();
    await waitFor(() => address.evaluate(element => element === document.activeElement), 'link field receives keyboard focus');
    await address.press('Escape'); assert.equal(await editor.innerText(), originalText);
    assert.deepEqual(await editor.evaluate(element => ({ from: element.editor.state.selection.from, to: element.editor.state.selection.to })), beforeLinkSelection);
    checks.push('Existing link dialogs focus their first field for immediate keyboard input and preserve the cursor on cancellation.');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, userData, errors };
    await fs.writeFile(path.join(output, 'paragraph-navigation-ui-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
