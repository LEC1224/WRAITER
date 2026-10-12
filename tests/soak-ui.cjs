// Sustained real desktop workflows in a private synthetic profile; no AI calls.
// npm run test:soak -- --minutes=45 (optionally WRAITER_EXECUTABLE for a package).
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const minutes = Number(process.argv.find(value => value.startsWith('--minutes='))?.split('=')[1] || 10);
const format = process.argv.find(value => value.startsWith('--format='))?.split('=')[1] || 'wraiter';
assert.ok(Number.isFinite(minutes) && minutes > 0 && minutes <= 180, 'Choose a soak duration between 0 and 180 minutes.');
assert.ok(['wraiter', 'odt'].includes(format), 'Choose WRAITER or ODT for the endurance save format.');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const textOf = node => node?.text || (node?.content || []).map(textOf).join('');
const twoFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function waitFor(fn, label, timeout = 20000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) { try { if (await fn()) return; } catch (error) { last = error; } await pause(100); }
  throw new Error(`${label}${last ? ': ' + last.message : ''}`);
}
const geometry = () => {
  const bounds = document.querySelector('.writing-scroll').getBoundingClientRect();
  const labels = new Map([...document.querySelectorAll('.paragraph-numbers .text-number')].map(label => [Number(label.textContent), label.getBoundingClientRect()]));
  const visible = [];
  [...document.querySelectorAll('.manuscript > p')].forEach((block, index) => {
    const box = block.getBoundingClientRect(); if (box.top < bounds.top || box.top > bounds.bottom - 36) return;
    const range = document.createRange(); range.setStart(block.firstChild, 0); range.setEnd(block.firstChild, 1);
    const text = range.getBoundingClientRect(), label = labels.get(index + 1);
    visible.push({ number: index + 1, offset: label ? Math.abs((text.top + text.bottom - label.top - label.bottom) / 2) : null });
  });
  return { height: document.querySelector('.writing-scroll').scrollHeight, visible, labels: labels.size, zoom: Number(getComputedStyle(document.querySelector('.writing-sheet')).zoom), viewport: { width: innerWidth, height: innerHeight } };
};

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'soak-')), target = path.join(userData, `Synthetic long novel.${format}`);
  const line = 'The river turned through the valley under the quiet evening sky. ';
  const fixture = { format: 'wraiter', version: 1, id: 'overnight-soak', title: 'Synthetic long novel', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, notes: '', style: '', references: [], snapshots: [], chapters: Array.from({ length: 4 }, (_, chapter) => ({ id: `chapter-${chapter}`, title: `Part ${chapter + 1}`, status: 'Draft', content: { type: 'doc', content: Array.from({ length: 1500 }, (_, index) => ({ type: 'paragraph', attrs: { lineHeight: index % 19 === 0 ? 2 : null }, content: [{ type: 'text', text: `Paragraph ${index + 1}. ${line.repeat(1 + index % 3)}${index === 1499 ? `TAIL_C${chapter + 1}` : ''}` }] })) } })) };
  const expected = fixture.chapters.map(chapter => chapter.content.content.map(textOf));
  const serialized = JSON.stringify(fixture);
  if (format === 'wraiter') await fs.writeFile(target, serialized);
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: format === 'wraiter' ? target : null, expectedHash: format === 'wraiter' ? crypto.createHash('sha256').update(serialized).digest('hex') : null }));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', pageMode: 'continuous', showParagraphNumbers: true, theme: 'dark', spellcheck: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  const errors = [], samples = [], cycles = [], started = Date.now(), deadline = started + minutes * 60000;
  let app, page, editor, cdp, launches = 0;
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  async function launch() {
    app = await _electron.launch(options); page = await app.firstWindow(); launches++;
    page.on('pageerror', error => errors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 });
    cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    await page.evaluate(() => document.fonts.ready); await twoFrames(page);
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).project.historySequence > 0, 'history initialization');
  }
  async function savedProject() {
    if (format === 'wraiter') return JSON.parse(await fs.readFile(target, 'utf8'));
    const source = await fs.readFile(target), name = process.platform === 'win32' ? path.resolve(target).toLowerCase() : path.resolve(target);
    const state = JSON.parse(await fs.readFile(path.join(userData, 'Format state', `${crypto.createHash('sha256').update(name).digest('hex')}.json`), 'utf8'));
    assert.equal(state.sourceHash, crypto.createHash('sha256').update(source).digest('hex'), 'ODT state must describe the actual source bytes');
    const xml = await (await JSZip.loadAsync(source)).file('content.xml').async('string');
    // This fixture has plain paragraphs only. Check the actual office text as
    // well as WRAITER's companion state; no author documents use this helper.
    const paragraphs = [...xml.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map(match => match[1].replace(/<text:s\b([^>]*)\/>/g, (_tag, attrs) => ' '.repeat(Number(attrs.match(/text:c="(\d+)"/)?.[1] || 1))).replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos);/g, (_entity, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name])));
    assert.deepEqual(paragraphs, state.project.chapters.flatMap(chapter => chapter.content.content.map(textOf)), 'real ODT paragraphs must agree with their companion state');
    return state.project;
  }
  async function saved(chapter, tail) {
    await waitFor(async () => {
      const named = await savedProject();
      const recovery = JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
      return textOf(named.chapters[chapter].content.content.at(-1)) === tail && textOf(recovery.chapters[chapter].content.content.at(-1)) === tail;
    }, 'named save and recovery agree');
  }
  async function aligned() {
    let result;
    await waitFor(async () => { result = await page.evaluate(geometry); return result.visible.length && result.visible.every(item => item.offset !== null && item.offset < 4); }, 'margin numbers remain aligned');
    assert.ok(result.labels < 200, 'only viewport margin labels are rendered'); return result;
  }
  async function go(number) {
    await command('go-paragraph'); const dialog = page.getByRole('dialog', { name: 'Go to paragraph', exact: true }); await dialog.waitFor();
    await dialog.getByRole('spinbutton', { name: 'Paragraph number', exact: true }).fill(String(number));
    await dialog.getByRole('button', { name: 'Go to paragraph', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    await waitFor(() => editor.evaluate((element, number) => element.editor.state.selection.$head.parent.textContent.startsWith(`Paragraph ${number}.`), number), 'paragraph destination');
    await waitFor(() => editor.evaluate(element => { const current = element.editor, caret = current.view.coordsAtPos(current.state.selection.head), bounds = element.closest('.writing-scroll').getBoundingClientRect(); return caret.top >= bounds.top && caret.bottom <= bounds.bottom; }), 'destination caret remains visible');
    await aligned();
  }
  async function sample(label) {
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
    const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, workingSetKB: item.memory.workingSetSize, privateKB: item.memory.privateBytes })));
    samples.push({ label, elapsedMs: Date.now() - started, launches, heapBytes: heap.usedSize, nodes: metrics.Nodes, documents: metrics.Documents, listeners: metrics.JSEventListeners, processes });
  }
  async function report(passed, failure) {
    const result = { passed, format, minutesRequested: minutes, elapsedMs: Date.now() - started, userData, executable: process.env.WRAITER_EXECUTABLE || 'development Electron', launches, completedCycles: cycles.length, cycles, samples, errors, ...(failure ? { failure: failure.message } : {}) };
    result.status = failure ? 'failed' : passed ? 'passed' : 'running';
    await fs.writeFile(path.join(userData, 'report.json'), JSON.stringify(result, null, 2));
    await fs.writeFile(path.join(output, 'soak-ui-results.json'), JSON.stringify(result, null, 2));
  }
  try {
    await launch();
    if (format === 'odt') {
      await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
      await command('save-copy');
      await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).binding?.format === 'odt', 'initial genuine ODT saveback');
      await savedProject();
    }
    await sample('initial');
    await page.getByRole('button', { name: 'New project tab', exact: true }).click();
    await page.getByRole('tab', { name: 'Untitled manuscript', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Synthetic long novel', exact: true }).click(); await editor.waitFor();
    let cycle = 0;
    while (Date.now() < deadline || cycle === 0) {
      const cycleStart = Date.now(), chapter = cycle % 4, before = expected[chapter][1499];
      await page.locator('.chapter-select').filter({ hasText: `Part ${chapter + 1}` }).click();
      await waitFor(async () => (await editor.locator(':scope > p').last().innerText()).includes(`TAIL_C${chapter + 1}`), 'chapter activation');
      await editor.evaluate(element => element.editor.commands.focus('end')); await twoFrames(page);
      const added = ` cycle_${cycle + 1} stays safe`;
      await page.keyboard.insertText(added); expected[chapter][1499] = before + added; await saved(chapter, before + added);
      await command('undo'); await saved(chapter, before);
      await command('redo'); await saved(chapter, before + added);
      if (cycle % 6 === 0) {
        await editor.evaluate(element => element.editor.commands.focus('end')); await page.keyboard.type(' typed', { delay: 30 });
        expected[chapter][1499] += ' typed'; await saved(chapter, expected[chapter][1499]);
      }
      await command('find'); const find = page.getByRole('textbox', { name: 'Find text', exact: true }); await find.fill(`TAIL_C${chapter + 1}`); await find.press('Enter');
      await waitFor(async () => await editor.locator('.search-match').filter({ hasText: `TAIL_C${chapter + 1}` }).count() === 1, 'unique tail Find result');
      await page.getByRole('button', { name: 'Close search', exact: true }).click();
      assert.equal(await page.evaluate(() => window.getSelection().toString()), `TAIL_C${chapter + 1}`);
      const zoom = cycle % 2 ? 100 : 150;
      await page.getByRole('combobox', { name: 'Document zoom', exact: true }).selectOption(String(zoom));
      await waitFor(() => page.evaluate(zoom => Number(getComputedStyle(document.querySelector('.writing-sheet')).zoom) === zoom / 100, zoom), 'requested zoom is applied before measuring');
      const size = await app.evaluate(({ BrowserWindow }, cycle) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(cycle % 2 ? 1440 : 960, cycle % 2 ? 900 : 650); return window.getContentSize(); }, cycle);
      await waitFor(() => page.evaluate(([width, height]) => innerWidth === width && innerHeight === height, size), 'native resize reaches the renderer');
      await page.evaluate(() => document.fonts.ready); await twoFrames(page);
      await go(220 + cycle % 100); const first = await aligned();
      await go(1210); await go(220 + cycle % 100); const second = await aligned();
      assert.equal(first.zoom, zoom / 100); assert.equal(second.zoom, first.zoom);
      assert.deepEqual(second.viewport, first.viewport, 'compare heights only within the same viewport');
      assert.equal(first.height, second.height, 'scrolling cannot change the manuscript height');
      await go(1500);
      await page.getByRole('tab', { name: 'Untitled manuscript', exact: true }).click();
      await page.getByRole('tab', { name: 'Synthetic long novel', exact: true }).click(); await editor.waitFor();
      await waitFor(async () => (await editor.locator(':scope > p').last().innerText()) === expected[chapter][1499], 'tab return retains edits');
      assert.deepEqual(errors, []);
      cycles.push({ cycle: cycle + 1, chapter: chapter + 1, elapsedMs: Date.now() - started, workflowMs: Date.now() - cycleStart, stableHeight: second.height });
      cycle++;
      if (cycle % 5 === 0) { await sample(`after ${cycle} cycles`); await report(false); console.log(JSON.stringify({ progress: cycle, elapsedMinutes: Number(((Date.now() - started) / 60000).toFixed(1)), userData })); }
      if (cycle % 25 === 0 && Date.now() < deadline) {
        await app.close(); app = null; await launch();
        const reopened = await savedProject();
        assert.deepEqual(reopened.chapters.map(item => item.content.content.map(textOf)), expected, 'restart preserves every paragraph');
        await sample(`restart ${launches}`);
      }
      if (Date.now() < deadline) await pause(Math.min(15000, deadline - Date.now()));
    }
    const final = await savedProject();
    assert.deepEqual(final.chapters.map(chapter => chapter.content.content.map(textOf)), expected, 'only intended tail additions changed');
    await sample('final'); await page.screenshot({ path: path.join(userData, 'final.png') }); await report(true);
    console.log(JSON.stringify({ passed: true, completedCycles: cycles.length, elapsedMinutes: Number(((Date.now() - started) / 60000).toFixed(1)), launches, userData }, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(userData, 'failure.png') }).catch(() => {}); await report(false, error); throw error; }
  finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
