// Real wheel input, synthetic text, and an isolated profile; no AI requests.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');

const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const baseline = process.argv.includes('--baseline');
const paragraph = (text, attrs = {}) => ({ type: 'paragraph', attrs: { textAlign: null, pageBreakBefore: null, lineHeight: null, spaceAfter: null, firstLineIndent: null, ...attrs }, content: [{ type: 'text', text }] });
const geometry = () => {
  const scroller = document.querySelector('.writing-scroll'), last = document.querySelector('.manuscript > p:last-child');
  const bounds = scroller.getBoundingClientRect(), tail = last.getBoundingClientRect();
  return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, tailTop: tail.top - bounds.top + scroller.scrollTop };
};
const twoFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const metrics = async session => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
const range = (samples, key) => Math.max(...samples.map(item => item[key])) - Math.min(...samples.map(item => item[key]));

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'scrolling-')), errors = [];
  const fixture = {
    format: 'wraiter', version: 1, id: 'scrolling-fixture', title: 'Scrolling sample', language: 'en-US',
    documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 },
    chapters: [{ id: 'one', title: 'The changing river', content: { type: 'doc', content: Array.from({ length: 1500 }, (_, index) =>
      paragraph(`Paragraph ${index + 1}. ` + 'The river turned through the valley under the quiet evening sky. '.repeat(1 + index % 7), index % 19 === 0 ? { lineHeight: 2 } : {})) } }]
  };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', pageMode: 'continuous', theme: 'dark' }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app, page;
  try {
    const started = Date.now(); app = await _electron.launch(options); page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await page.evaluate(() => document.fonts.ready); await twoFrames(page);
    const initialMs = Date.now() - started;
    assert.equal(await editor.locator(':scope > p').count(), 1500);
    await page.waitForFunction(async () => (await window.wraiter.boot()).project.historySequence > 0);
    const before = await page.evaluate(() => window.wraiter.boot());
    const historyBefore = await page.evaluate(id => window.wraiter.loadEditHistory(id), fixture.id);
    const session = await page.context().newCDPSession(page); await session.send('Performance.enable');
    const beforeMetrics = await metrics(session), samples = [await page.evaluate(geometry)];
    const bounds = await page.locator('.writing-scroll').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.evaluate(() => {
      window.scrollFrameTimes = [];
      const record = time => { window.scrollFrameTimes.push(time); window.scrollFrame = requestAnimationFrame(record); };
      window.scrollFrame = requestAnimationFrame(record);
    });
    for (const delta of [...Array(30).fill(380), ...Array(15).fill(-380)]) {
      await page.mouse.wheel(0, delta); await twoFrames(page); samples.push(await page.evaluate(geometry));
    }
    for (const fraction of [.5, 1, .75, .25, 0]) {
      await page.locator('.writing-scroll').evaluate((element, fraction) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction; }, fraction);
      await twoFrames(page); samples.push(await page.evaluate(geometry));
    }
    const frameTimes = await page.evaluate(() => { cancelAnimationFrame(window.scrollFrame); return window.scrollFrameTimes; });
    const gaps = frameTimes.slice(1).map((time, index) => time - frameTimes[index]).sort((a, b) => a - b);
    const afterMetrics = await metrics(session), after = await page.evaluate(() => window.wraiter.boot());
    const historyAfter = await page.evaluate(id => window.wraiter.loadEditHistory(id), fixture.id);
    assert.ok(isDeepStrictEqual(after.project.chapters[0].content, before.project.chapters[0].content), 'Scrolling changed the manuscript');
    assert.equal(historyAfter.totalEvents, historyBefore.totalEvents, 'Scrolling changed editing history');
    assert.ok(Math.max(...samples.map(item => item.scrollTop)) > 20000, 'Did not reach distant paragraphs');
    assert.deepEqual(errors, []);
    const report = {
      baseline, initialMs, paragraphs: 1500, samples: samples.length,
      documentHeightChange: range(samples, 'scrollHeight'), tailPositionChange: range(samples, 'tailTop'),
      layoutMs: (afterMetrics.LayoutDuration - beforeMetrics.LayoutDuration) * 1000,
      scriptMs: (afterMetrics.ScriptDuration - beforeMetrics.ScriptDuration) * 1000,
      frameP95Ms: gaps[Math.floor(gaps.length * .95)], maxFrameMs: gaps.at(-1),
      initialHeight: samples[0].scrollHeight, finalHeight: samples.at(-1).scrollHeight,
      userData
    };
    await fs.writeFile(path.join(output, baseline ? 'scrolling-baseline-results.json' : 'scrolling-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (baseline) assert.ok(report.documentHeightChange > 2, 'Old build did not reproduce changing offscreen heights');
    else {
      assert.ok(report.documentHeightChange <= 1, 'Scrolling changed the document height');
      assert.ok(report.tailPositionChange <= 1, 'Scrolling moved the last paragraph inside the document');
    }
  } catch (error) { await page?.screenshot({ path: path.join(output, 'scrolling-failure.png') }).catch(() => {}); throw error; }
  finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
