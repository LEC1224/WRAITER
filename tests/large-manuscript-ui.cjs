const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (fn, label, timeout = 20000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { if (await fn()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error(label);
};
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'large-manuscript-')), errors = [];
  const line = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
  const fixture = {
    format: 'wraiter', version: 1, id: 'large-manuscript-ui', title: 'Large novel', language: 'en-US',
    documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 },
    chapters: Array.from({ length: 4 }, (_, chapter) => ({ id: `long-chapter-${chapter + 1}`, title: `Part ${chapter + 1}`, status: 'Draft', content: { type: 'doc', content: Array.from({ length: 1500 }, (_, index) => paragraph(`${line}${chapter === 0 && index === 1499 ? ' UNIQUE_TAIL_PASSAGE' : ''}`)) } })),
    references: [], notes: '', style: '', snapshots: [], chats: [], activeChatId: null
  };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, pageMode: 'continuous', spellcheck: true, startup: 'restore' }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app, page;
  try {
    const launchStarted = Date.now(); app = await _electron.launch(options); page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor({ timeout: 30000 });
    const initialMs = Date.now() - launchStarted;
    assert.ok(initialMs < 15000, `30,000-word launch took ${initialMs} ms`);
    assert.equal(await editor.locator(':scope > p').count(), 1500);
    assert.equal(await editor.locator(':scope > p').last().evaluate(element => getComputedStyle(element).contentVisibility), 'auto');

    await editor.locator(':scope > p').last().evaluate(element => {
      element.scrollIntoView({ block: 'center' });
      const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.closest('[contenteditable=true]').focus(); document.dispatchEvent(new Event('selectionchange'));
    });
    const typed = ' responsive typing remains local';
    const typingStarted = Date.now(); await page.keyboard.type(typed); const typingMs = Date.now() - typingStarted;
    assert.ok(typingMs < 2000, `Typing ${typed.length} characters took ${typingMs} ms`);
    await waitFor(async () => (await editor.locator(':scope > p').last().innerText()).endsWith(typed), 'Tail typing did not appear');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'find'));
    const find = page.getByRole('textbox', { name: 'Find text', exact: true }); await find.fill('UNIQUE_TAIL_PASSAGE'); await find.press('Enter');
    await waitFor(async () => await page.evaluate(() => window.getSelection().toString()) === 'UNIQUE_TAIL_PASSAGE', 'Search did not materialize the offscreen match');
    await page.getByRole('button', { name: 'Close search', exact: true }).click();

    await page.getByRole('button', { name: 'New project tab', exact: true }).click();
    await waitFor(async () => await page.getByRole('tab', { name: 'Untitled manuscript', exact: true }).getAttribute('aria-selected') === 'true', 'New tab did not activate');
    const switchStarted = Date.now(); await page.getByRole('tab', { name: 'Large novel', exact: true }).click();
    await waitFor(async () => await page.getByRole('tab', { name: 'Large novel', exact: true }).getAttribute('aria-selected') === 'true' && await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).count() === 1, 'Warm large tab did not return');
    const warmSwitchMs = Date.now() - switchStarted;
    assert.ok(warmSwitchMs < 5000, `Warm large-tab switch took ${warmSwitchMs} ms`);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'select-all'));
    assert.ok((await page.evaluate(() => window.getSelection().toString().length)) > 150000, 'Select All omitted virtualized manuscript blocks');
    assert.deepEqual(errors, []);
    const report = { passed: true, manuscriptWords: 120000, activeChapterWords: 30000, activeParagraphs: 1500, initialMs, typingMs, warmSwitchMs, userData };
    await fs.writeFile(path.join(output, 'large-manuscript-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
