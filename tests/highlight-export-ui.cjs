// Exercise colour handling through the real export dialog and PDF renderer.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = await fs.mkdtemp(path.join(root, 'test-output', 'highlight-export-ui-'));
  const words = ['Deep blue highlight.', 'Pale green highlight.', 'Imported background.', 'Unhighlighted pink text.'];
  const content = { type: 'doc', content: words.map((text, index) => ({ type: 'paragraph', content: [{ type: 'text', text, marks: index < 2 ? [
    { type: 'highlight', attrs: { color: index === 0 ? '#204b8f' : '#8de5a1' } },
    { type: 'textStyle', attrs: { color: index === 0 ? '#ffffff' : '#000000' } }, { type: 'italic' }
  ] : [{ type: 'textStyle', attrs: index === 2 ? { color: '#204b8f', backgroundColor: '#204b8f' } : { color: '#c32882' } }] }] })) };
  const project = { format: 'wraiter', version: 1, id: 'highlight-export', title: 'Highlight export', chapters: [{ id: 'one', title: 'Examples', content }] };
  await fs.writeFile(path.join(output, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', theme: 'dark', spellcheck: false }));
  await fs.writeFile(path.join(output, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: output }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  const errors = [];
  try {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent.includes('Deep blue highlight.'));
    const before = await editor.evaluate(element => element.editor.getJSON());
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: global.highlightPDFTarget }); });
    const checks = [];
    for (const mode of ['light', 'dark']) {
      const target = path.join(output, mode + '.pdf');
      await app.evaluate(({ BrowserWindow }, target) => { global.highlightPDFTarget = target; BrowserWindow.getAllWindows()[0].webContents.send('command', 'export'); }, target);
      const dialog = page.getByRole('dialog', { name: 'Export document', exact: true }); await dialog.waitFor();
      await dialog.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('pdf');
      await dialog.getByRole('combobox', { name: 'PDF colour', exact: true }).selectOption(mode);
      await dialog.getByLabel('Include manuscript title', { exact: true }).uncheck();
      await dialog.getByLabel('Include chapter headings', { exact: true }).uncheck();
      await dialog.getByRole('button', { name: 'Save PDF file…', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const inspected = spawnSync(process.env.WRAITER_TEST_PYTHON || 'python', ['-c', 'import fitz,json,sys; d=fitz.open(sys.argv[1]); print(json.dumps({"spans":[{"text":s["text"],"colour":s["color"]} for p in d for b in p.get_text("dict")["blocks"] if "lines" in b for l in b["lines"] for s in l["spans"]],"fills":[x["fill"] for p in d for x in p.get_drawings() if x.get("fill")]}))', target], { encoding: 'utf8', windowsHide: true });
      assert.equal(inspected.status, 0, inspected.stderr);
      const pdf = JSON.parse(inspected.stdout);
      for (const text of words.slice(0, 3)) assert.ok(pdf.spans.some(span => span.text === text && span.colour === (mode === 'light' ? 0 : 0xffffff)), `${mode}: incorrect text colour for ${text}`);
      // PDF colour floats can quantize one channel down by one during extraction.
      assert.ok(pdf.spans.some(span => span.text === words[3] && [16, 8, 0].every((shift, i) => Math.abs(((span.colour >> shift) & 255) - [195, 40, 130][i]) <= 1)));
      const expected = mode === 'light' ? [197, 208, 226] : [28, 41, 61];
      assert.ok(pdf.fills.some(fill => fill.every((n, i) => Math.abs(n * 255 - expected[i]) < 1)), `${mode}: exported opaque highlight`);
      assert.deepEqual(await editor.evaluate(element => element.editor.getJSON()), before, 'Export changed manuscript colours');
      checks.push(`${mode}: exported PDF has blended highlights, automatic text contrast, unchanged unhighlighted text and unchanged manuscript.`);
    }
    assert.deepEqual(errors, []);
    const result = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, checks, output };
    await fs.writeFile(path.join(root, 'test-output', process.env.WRAITER_EXECUTABLE ? 'highlight-export-packaged-results.json' : 'highlight-export-ui-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
  finally { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
