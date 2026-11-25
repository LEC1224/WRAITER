// A synthetic illustrated chapter, 125% zoom and a fresh Electron profile.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const count = 220;
const title = 'Illustrated chapter';
const sentence = 'The trail turned at the river and climbed through a stand of tall pines. ';
const chapter = Array.from({ length: count }, (_, index) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: `Paragraph ${index + 1}. ` + sentence.repeat(1 + index % 4) }],
}));
chapter.splice(65, 0, {
  type: 'image',
  attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', alt: 'Illustration', width: 48, height: 48 },
});
const wrapped = chapter[100];
wrapped.attrs = { pageBreakBefore: true };
wrapped.content.push(
  { type: 'text', marks: [{ type: 'bold' }], text: sentence.repeat(100) },
  { type: 'hardBreak' },
  { type: 'text', text: 'The trail ended at the bridge.' },
);

function state() {
  const editor = document.querySelector('.manuscript').editor;
  return { selection: editor.state.selection.toJSON(), scroll: editor.view.dom.closest('.writing-scroll').scrollTop, content: editor.getJSON() };
}

function watchGeometry() {
  const rect = Range.prototype.getBoundingClientRect, elementRect = Element.prototype.getBoundingClientRect;
  window.layoutReads = { characters: 0, paragraphs: 0 };
  Range.prototype.getBoundingClientRect = function () {
    if (this.startContainer.nodeType === Node.TEXT_NODE && this.startContainer === this.endContainer &&
        this.endOffset === this.startOffset + 1 && this.startContainer.parentElement?.closest('.manuscript')) window.layoutReads.characters++;
    return rect.call(this);
  };
  Element.prototype.getBoundingClientRect = function () {
    if (this.tagName === 'P' && this.parentElement?.classList.contains('manuscript')) window.layoutReads.paragraphs++;
    return elementRect.call(this);
  };
}

async function run() {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'tab-layout-'));
  const project = { format: 'wraiter', version: 1, id: 'tab-layout-project', title, language: 'en-US',
    chapters: [{ id: 'chapter', title: 'River trail', content: { type: 'doc', content: chapter } }] };
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, startup: 'restore',
    enabled: false, localGrammar: false, spellcheck: false, pageMode: 'continuous', showParagraphNumbers: true, zoom: 125 }));
  await fs.writeFile(path.join(profile, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch(process.env.WRAITER_EXECUTABLE
    ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env } : { args: [root], env });
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    const target = editor.locator(':scope > p').nth(179);
    const command = value => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('command', value), value);
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator('.paragraph-numbers .text-number').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await frames();
    await page.evaluate(watchGeometry);
    await target.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => [...document.querySelectorAll('.paragraph-numbers .text-number')].some(label => label.textContent === '180'));
    const scrollReads = await page.evaluate(() => window.layoutReads.paragraphs);
    await target.click();
    const before = await page.evaluate(state);
    assert.ok(before.scroll > 1000);
    assert.equal(await editor.locator('img').count(), 1);
    await page.getByRole('button', { name: 'New project tab', exact: true }).click();
    await page.getByRole('tab', { name: 'Untitled manuscript', exact: true, selected: true }).waitFor();
    const start = Date.now();
    await page.getByRole('tab', { name: title, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.querySelectorAll(':scope > p').length === 220);
    await page.waitForFunction(() => [...document.querySelectorAll('.paragraph-numbers .text-number')].some(label => label.textContent === '180'));
    await frames();
    const switchMs = Date.now() - start, after = await page.evaluate(state);
    assert.deepEqual(after.content, before.content);
    assert.deepEqual(after.selection, before.selection);
    assert.ok(Math.abs(before.scroll - after.scroll) <= 2, `Tab switch moved the scroll position from ${before.scroll} to ${after.scroll}`);

    await page.evaluate(() => { window.layoutReads.characters = 0; });
    await command('toggle-row-numbers'); await command('toggle-page-numbers');
    await page.waitForFunction(() => document.querySelectorAll('.page-numbers .text-number').length > 5);
    await frames();
    const rowCount = await page.locator('.row-numbers .text-number').count();
    const continuousReads = await page.evaluate(() => window.layoutReads.characters);
    assert.ok(rowCount > 2 * count, 'The fixture must exercise wrapped lines');
    assert.equal(await page.locator('.paragraph-numbers .text-number').count(), count);
    await page.evaluate(() => { window.layoutReads.characters = 0; });
    await command('page-view');
    await page.waitForFunction(() => document.querySelectorAll('.page-card').length > 5);
    await frames();
    const pageCount = await page.locator('.page-card').count();
    const pageReads = await page.evaluate(() => window.layoutReads.characters);
    assert.equal(await page.locator('.page-numbers .text-number').count(), pageCount);
    assert.ok(await editor.locator(':scope > p').nth(99).locator('.pagination-spacer').count() > 1, 'The long paragraph must span pages');
    assert.deepEqual((await page.evaluate(state)).content, before.content);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ switchMs, paragraphs: count, rowCount, pageCount, scrollReads, continuousReads, pageReads }, null, 2));
    assert.ok(scrollReads < count / 2, `Scrolling one illustrated chapter read ${scrollReads} paragraph bounds`);
    assert.ok(continuousReads < rowCount / 4, `Margin labels caused ${continuousReads} single-character geometry reads for ${rowCount} rows`);
    assert.ok(pageReads < rowCount * 2, `Page breaks caused ${pageReads} single-character geometry reads for ${rowCount} rows`);
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
