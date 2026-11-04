const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'named-styles-'));
  const project = { format: 'wraiter', version: 1, id: 'styles-ui', title: 'Styles', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, references: [], notes: '', style: '', snapshots: [], chapters: [
    { id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] }] } }
  ] };
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore' }));
  await fs.writeFile(path.join(profile, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ args: [root], env, timeout: 60000 });
    const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await editor.evaluate(element => element.editor.commands.setTextSelection({ from: 1, to: 30 }));
    await page.getByRole('button', { name: 'Styles…' }).click();
    let dialog = page.getByRole('dialog', { name: 'Named styles' });
    await dialog.getByLabel('Style name').fill('Body prose'); await dialog.getByLabel('Font size (pt)').fill('18');
    await dialog.getByRole('button', { name: 'Save style' }).click();
    await dialog.getByRole('button', { name: 'Apply saved style' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.manuscript p')].length === 2 && [...document.querySelectorAll('.manuscript p')].every(p => p.getAttribute('data-paragraph-style') && getComputedStyle(p).fontSize === '24px'));
    await page.getByRole('button', { name: 'Styles…' }).click(); dialog = page.getByRole('dialog', { name: 'Named styles' });
    await dialog.getByLabel('Choose a style').selectOption({ label: 'Body prose · paragraph' });
    await dialog.getByLabel('Font size (pt)').fill('24'); await dialog.getByRole('button', { name: 'Save style' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.manuscript p')].every(p => getComputedStyle(p).fontSize === '32px'));
    await dialog.getByRole('button', { name: 'Close' }).click(); await editor.press('Control+z');
    await page.waitForFunction(() => [...document.querySelectorAll('.manuscript p')].every(p => getComputedStyle(p).fontSize === '24px'));
    assert.deepEqual(errors, []); console.log('Named styles apply across paragraphs, update all occurrences and undo.');
  } finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
