// Windowed viewport regression for history remounts; uses a private synthetic manuscript.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const paragraphs = Array.from({ length: 130 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${index + 1}. A quiet sentence with enough words to wrap on a narrow window and make the manuscript scroll naturally.` }] }));
const project = { format: 'wraiter', version: 1, id: 'undo-scroll-ui', title: 'Undo viewport test', chapters: [{ id: 'opening', title: 'Opening', status: 'Draft', content: { type: 'doc', content: paragraphs } }], references: [], snapshots: [], notes: '', style: '', language: 'en-US' };

function viewport() {
  const scroller = document.querySelector('.writing-scroll');
  const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const caret = range?.getBoundingClientRect(), rect = scroller?.getBoundingClientRect();
  return { top: scroller?.scrollTop, caretTop: caret?.top, caretBottom: caret?.bottom, visibleTop: rect?.top, visibleBottom: rect?.bottom };
}

(async () => {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'undo-scroll-ui-'));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, continuous: false }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  const app = await electron.launch(options);
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1050, height: 680 });
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor({ timeout: 30000 });
    const paragraph = editor.locator('p').nth(110);
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' fleeting');
    const before = await page.evaluate(viewport);
    assert.ok(before.top > 200, 'test must start in a scrolled, windowed manuscript');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(350);
    const undone = await page.evaluate(viewport);
    assert.ok(undone.caretTop >= undone.visibleTop + 4 && undone.caretBottom <= undone.visibleBottom - 4, `caret should remain visible after undo: ${JSON.stringify(undone)}`);
    assert.ok(Math.abs(undone.top - before.top) < 100, `undo should not jump the viewport: ${JSON.stringify({ before, undone })}`);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(350);
    const redone = await page.evaluate(viewport);
    assert.ok(redone.caretTop >= redone.visibleTop + 4 && redone.caretBottom <= redone.visibleBottom - 4, `caret should remain visible after redo: ${JSON.stringify(redone)}`);
    assert.ok(Math.abs(redone.top - undone.top) < 100, `redo should not jump the viewport: ${JSON.stringify({ undone, redone })}`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, before, undone, redone }, null, 2));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
