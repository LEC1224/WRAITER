const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'bookmarks-templates-'));
  const project = { format: 'wraiter', version: 1, id: 'navigation-test', title: 'Navigation test', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, references: [], notes: '', style: '', snapshots: [], chapters: [
    { id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two three' }] }] } },
    { id: 'second', title: 'Second', content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A destination' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Body text.' }] }] } }
  ] };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore' }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ args: [root], env, timeout: 60000 });
    const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await editor.evaluate(element => element.editor.commands.setTextSelection({ from: 5, to: 8 }));
    await page.locator('.bookmarks-panel > summary').click();
    await page.getByRole('textbox', { name: 'Bookmark name' }).fill('My place');
    await page.getByRole('button', { name: 'Add bookmark' }).click();
    await page.getByRole('button', { name: 'My place First' }).waitFor();
    await editor.evaluate(element => element.editor.commands.setTextSelection({ from: 5, to: 8 }));
    await page.waitForFunction(() => !document.querySelector('[aria-label="Change selected text case"]')?.disabled, null, { timeout: 8000 });
    await page.getByLabel('Change selected text case').selectOption('upper');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'one TWO three', null, { timeout: 8000 });
    await editor.press('Control+z');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'one two three', null, { timeout: 8000 });
    assert.ok(await page.getByRole('button', { name: 'My place First' }).isEnabled());
    await page.locator('.chapter-headings summary').click();
    await page.getByRole('button', { name: 'A destination' }).click();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.state.selection.$head.parent.textContent === 'A destination', null, { timeout: 8000 });
    await page.getByRole('button', { name: 'My place First' }).click();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.state.selection.$head.parent.textContent === 'one two three', null, { timeout: 8000 });
    await page.getByRole('button', { name: 'Document templates…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Document templates' });
    await dialog.getByRole('textbox', { name: 'Template name' }).fill('A reusable draft');
    await dialog.getByRole('button', { name: 'Save current manuscript as template' }).click();
    await dialog.getByRole('button', { name: 'A reusable draft 2 chapters' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length >= 2, null, { timeout: 8000 });
    assert.equal(await page.locator('.bookmark-row').count(), 0);
    assert.match(await editor.innerText(), /one two three/);
    assert.deepEqual(errors, []);
    console.log('Heading navigation, private bookmark, and new project from local template passed.');
  } finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
