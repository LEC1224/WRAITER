// Exercise live checking as a long paragraph crosses the 3,500-character
// worker boundary, using a synthetic isolated desktop profile.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'offline-grammar-paragraph-'));
  const file = path.join(profile, 'Synthetic long paragraph.wraiter');
  const prefix = 'The winding road crossed the quiet valley. '.repeat(78);
  const text = `${prefix}The dogs runs quickly.`;
  assert.ok(text.length < 3500 && text.length > 3300, `Fixture length ${text.length}`);
  const project = { format: 'wraiter', version: 1, id: 'long-paragraph', title: 'Long paragraph', language: 'en-US', chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true, spellcheck: true, startup: 'new', pageMode: 'continuous' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env } : { args: [root, file], env });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await editor.locator('.local-grammar-hint').filter({ hasText: /^runs$/ }).waitFor({ timeout: 30000 });
    await editor.evaluate(element => {
      const current = element.editor; current.commands.focus('end'); window.longParagraphFrames = [];
      element.addEventListener('beforeinput', () => { const start = performance.now(); requestAnimationFrame(() => window.longParagraphFrames.push(performance.now() - start)); }, true);
    });
    const addition = ' This extra sentence extends the paragraph beyond its background checking boundary while the writer continues typing without interruption. Their going to meet a freind.';
    await page.keyboard.type(addition);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const frames = await page.evaluate(() => window.longParagraphFrames.sort((a, b) => a - b));
    assert.equal(frames.length, addition.length);
    const p95 = frames[Math.ceil(frames.length * 0.95) - 1];
    assert.ok(p95 < 100, `Long-paragraph input-to-frame p95 was ${p95} ms`);
    assert.ok((await editor.innerText()).length > 3500, 'The edit should cross the chunk boundary');
    await editor.locator('.local-grammar-hint').filter({ hasText: /^runs$/ }).waitFor({ timeout: 30000 });
    await editor.locator('.local-grammar-hint').filter({ hasText: /^Their$/ }).waitFor({ timeout: 30000 });
    await editor.locator('.local-spelling-hint').filter({ hasText: /^freind$/ }).waitFor({ timeout: 30000 });
    assert.equal(await editor.innerText(), text + addition, 'Checking must not alter the paragraph');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, originalCharacters: text.length, finalCharacters: text.length + addition.length, inputP95Ms: p95 }));
  } finally { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
