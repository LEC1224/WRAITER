// Synthetic local-only benchmark. Run after npm run build:
// node tools/benchmark-outline.cjs [chapter count]
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'outline-benchmark-')), count = Number(process.argv[2] || 500);
  if (!Number.isSafeInteger(count) || count < 1 || count > 2000) throw new Error('Choose 1–2000 chapters.');
  const chapters = Array.from({ length: count }, (_, i) => ({ id: `chapter-${i}`, title: `Chapter ${i + 1}`, status: 'Draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quiet passage in a synthetic chapter.' }] }] } }));
  const project = { format: 'wraiter', version: 1, id: 'outline-benchmark', title: 'Many chapters', chapters, references: [], notes: '', style: '', snapshots: [] };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app;
  try {
    app = await _electron.launch(options); const page = await app.firstWindow();
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor(); await editor.click();
    await editor.evaluate(element => { window.inputFrames = []; element.addEventListener('beforeinput', () => { const start = performance.now(); requestAnimationFrame(() => window.inputFrames.push(performance.now() - start)); }, true); });
    const session = await page.context().newCDPSession(page); await session.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
    const before = await metrics(), typed = ' responsive typing remains local';
    await page.keyboard.type(typed); await page.evaluate(() => new Promise(requestAnimationFrame));
    const frames = await page.evaluate(() => window.inputFrames.sort((a, b) => a - b)), after = await metrics();
    assert.equal(frames.length, typed.length, 'Every character must produce an input and a frame');
    console.log(JSON.stringify({ note: 'Synthetic local measurements; compare runs on the same machine.', chapters: count, inputP95Ms: frames[Math.ceil(frames.length * .95) - 1], inputMaxMs: frames.at(-1), scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000, userData }, null, 2));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
