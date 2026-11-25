const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'offline-grammar-large-'));
  const file = path.join(profile, 'Long synthetic chapter.wraiter');
  const project = { format: 'wraiter', version: 1, id: 'offline-grammar-large', title: 'Long synthetic chapter', language: 'en-US',
    chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: Array.from({ length: 1300 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `The the door waited in paragraph ${index + 1}.` }] })) } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true, spellcheck: false, startup: 'new', pageMode: 'continuous' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env } : { args: [root, file], env });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await editor.locator('p').first().locator('.local-grammar-hint').waitFor({ timeout: 30000 });
    const tail = editor.locator(':scope > p').last(); await tail.scrollIntoViewIfNeeded();
    await tail.locator('.local-grammar-hint').waitFor({ timeout: 15000 });
    assert.equal(await tail.locator('.local-grammar-hint').innerText(), 'The the', 'Scrolling to the end must reveal its grammar hints');
    await tail.click(); await page.keyboard.press('End');
    await editor.evaluate(element => {
      window.localGrammarFrames = [];
      element.addEventListener('beforeinput', () => { const start = performance.now(); requestAnimationFrame(() => window.localGrammarFrames.push(performance.now() - start)); }, true);
    });
    await page.keyboard.type(' A short addition.');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const frames = await page.evaluate(() => window.localGrammarFrames.sort((a, b) => a - b));
    const p95 = frames[Math.ceil(frames.length * 0.95) - 1];
    assert.equal(frames.length, ' A short addition.'.length);
    assert.ok(p95 < 100, `Input-to-frame p95 with 1,300 hints was ${p95} ms`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, paragraphs: 1300, inputP95Ms: p95, finalHintVisible: true }));
  } finally { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
