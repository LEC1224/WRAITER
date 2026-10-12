// Synthetic paragraphs and an isolated profile; no author files or AI calls.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');

const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output'), paragraphCount = 1500;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const paragraph = (text, attrs = {}) => ({ type: 'paragraph', attrs: { textAlign: null, lineHeight: null, firstLineIndent: null, spaceAfter: null, pageBreakBefore: null, ...attrs }, content: [{ type: 'text', text }] });
const geometry = () => {
  const bounds = document.querySelector('.writing-scroll').getBoundingClientRect();
  const labels = new Map([...document.querySelectorAll('.paragraph-numbers .text-number')].map(label => [Number(label.textContent), label.getBoundingClientRect()]));
  const blocks = [...document.querySelectorAll('.manuscript > p')];
  const visible = [];
  blocks.forEach((block, index) => {
    const box = block.getBoundingClientRect();
    if (box.top < bounds.top - 1 || box.top > bounds.bottom - 36) return;
    const range = document.createRange(); range.setStart(block.firstChild, 0); range.setEnd(block.firstChild, 1);
    const text = range.getBoundingClientRect(), label = labels.get(index + 1);
    visible.push({ number: index + 1, offset: label ? Math.abs((text.top + text.bottom - label.top - label.bottom) / 2) : null });
  });
  return { visible, labelCount: labels.size, paragraphCount: blocks.length };
};

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'long-numbering-')), errors = [], checks = [];
  const fixture = {
    format: 'wraiter', version: 1, id: 'long-numbering', title: 'Long numbering sample', language: 'en-US',
    documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 },
    chapters: [{ id: 'one', title: 'The changing river', content: { type: 'doc', content: Array.from({ length: paragraphCount }, (_, index) =>
      paragraph(`Paragraph ${index + 1}. ` + 'The river turned through the valley under the quiet evening sky. '.repeat(1 + index % 7), index % 19 === 0 ? { lineHeight: 2 } : {})) } }]
  };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', pageMode: 'continuous', showParagraphNumbers: true, theme: 'dark' }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app, page, editor;
  const aligned = async label => {
    let result;
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await page.evaluate(geometry);
      if (result.visible.length && result.visible.every(item => item.offset !== null && item.offset < 4)) {
        checks.push({ label, ...result }); return;
      }
      await pause(75);
    }
    assert.fail(`${label}: ${JSON.stringify(result)}`);
  };
  const jump = async index => {
    await editor.locator(':scope > p').nth(index).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await aligned(`Scroll to paragraph ${index + 1}`);
  };
  try {
    app = await _electron.launch(options); page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await page.locator('.paragraph-numbers .text-number').first().waitFor();
    await page.waitForFunction(async () => (await window.wraiter.boot()).project.historySequence > 0);
    const before = await page.evaluate(() => window.wraiter.boot());
    const historyBefore = await page.evaluate(id => window.wraiter.loadEditHistory(id), fixture.id);
    await aligned('Initial paragraphs');
    for (const index of [215, 330, paragraphCount - 1, 140, 0]) await jump(index);
    await jump(330); await page.screenshot({ path: path.join(output, 'long-numbering-scroll.png') });
    await page.getByRole('combobox', { name: 'Document zoom', exact: true }).selectOption('150');
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.writing-sheet')).zoom) === 1.5);
    await aligned('150% zoom');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650)); await aligned('Minimum window at 150%');
    await page.screenshot({ path: path.join(output, 'long-numbering-minimum.png') });
    await page.getByRole('combobox', { name: 'Document zoom', exact: true }).selectOption('100');
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.writing-sheet')).zoom) === 1);
    await jump(paragraphCount - 1);
    assert.equal(await editor.locator(':scope > p').last().evaluate(element => getComputedStyle(element).contentVisibility), 'visible', 'Manuscript still uses estimated offscreen heights');
    const after = await page.evaluate(() => window.wraiter.boot());
    assert.ok(isDeepStrictEqual(after.project.chapters[0].content, before.project.chapters[0].content), 'Numbering changed the document');
    const historyAfter = await page.evaluate(id => window.wraiter.loadEditHistory(id), fixture.id);
    assert.equal(historyAfter.totalEvents, historyBefore.totalEvents, 'Scrolling changed undo history');
    assert.ok(await page.locator('.paragraph-numbers .text-number').count() < 100, 'Paragraph numbering created labels for the entire document');

    // Splitting a paragraph in the middle must renumber later visible blocks.
    await jump(140);
    await editor.locator(':scope > p').nth(140).evaluate(element => {
      element.closest('[contenteditable=true]').focus();
      const range = document.createRange(); range.selectNodeContents(element); range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.keyboard.insertText('A new paragraph above the existing passage.'); await page.keyboard.press('Enter');
    await page.waitForFunction(count => document.querySelectorAll('.manuscript > p').length === count, paragraphCount + 1);
    await aligned('Insert paragraph in the middle'); await jump(330);
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
    await command('undo');
    await page.waitForFunction(count => document.querySelectorAll('.manuscript > p').length === count, paragraphCount);
    await aligned('Undo paragraph split');
    await command('redo');
    await page.waitForFunction(count => document.querySelectorAll('.manuscript > p').length === count, paragraphCount + 1);
    await aligned('Redo paragraph split');

    await command('toggle-row-numbers');
    await page.waitForFunction(count => document.querySelectorAll('.paragraph-numbers .text-number').length === count && document.querySelectorAll('.row-numbers .text-number').length > count, paragraphCount + 1);
    assert.equal(await editor.locator(':scope > p').last().evaluate(element => getComputedStyle(element).contentVisibility), 'visible');
    await jump(600); await aligned('Row and paragraph numbers together');
    await command('toggle-row-numbers');
    await page.waitForFunction(() => document.querySelectorAll('.row-numbers .text-number').length === 0);
    await aligned('Return to paragraph-only numbering');
    assert.equal(await editor.locator(':scope > p').last().evaluate(element => getComputedStyle(element).contentVisibility), 'visible');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, userData };
    await fs.writeFile(path.join(output, 'long-numbering-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'long-numbering-failure.png') }).catch(() => {}); throw error;
  } finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
