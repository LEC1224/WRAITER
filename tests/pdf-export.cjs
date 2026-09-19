// Exercise the real export IPC using synthetic content and an isolated profile.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  const output = await fs.mkdtemp(path.join(root, 'test-output', 'pdf-export-'));
  const temp = path.join(output, 'temporary files # ü');
  await fs.mkdir(temp);
  const env = { ...process.env, WRAITER_USER_DATA: path.join(output, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await _electron.launch(process.env.WRAITER_EXECUTABLE
      ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 }
      : { args: [root], env, timeout: 60000 });
    const page = await application.firstWindow();
    await page.waitForFunction(() => Boolean(window.wraiter));
    await application.evaluate(({ app, dialog }, temp) => {
      app.setPath('temp', temp);
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: global.pdfExportTarget });
      global.pdfWindows = [];
      app.on('browser-window-created', (_event, window) => {
        global.pdfWindows.push(window);
        if (global.pdfFailure === 'load') window.loadFile = async () => { throw new Error('Synthetic load failure'); };
        if (global.pdfFailure === 'print') window.webContents.printToPDF = async () => { throw new Error('Synthetic print failure'); };
      });
    }, temp);
    const html = '<!doctype html><meta charset="utf-8"><style>@page{size:180mm 255mm;margin:18mm}p{break-before:page}</style>'
      + '<h1>Beginning of export — Åäö</h1><!--' + 'Large manuscript padding. '.repeat(120000)
      + '--><p>End of export</p>';
    assert(Buffer.byteLength(html) > 2 * 1024 * 1024, 'Fixture must exceed the data URL limit');
    for (const [name, content] of [['large', html], ['small', '<h1>Small export</h1>']]) {
      const target = path.join(output, `${name}.pdf`);
      await application.evaluate((_electron, target) => { global.pdfExportTarget = target; }, target);
      assert.equal(await page.evaluate(html => window.wraiter.exportFile({ format: 'pdf', title: 'Synthetic export', html }), content), target);
      const pdf = (await fs.readFile(target)).toString('latin1');
      assert(pdf.startsWith('%PDF-'), 'Export is not a PDF');
      assert.equal((pdf.match(/\/Type\s*\/Page\b/g) || []).length, name === 'large' ? 2 : 1);
      if (name === 'large') {
        const box = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
        assert(box && Math.abs(Number(box[1]) - 180 / 25.4 * 72) < 1.2 && Math.abs(Number(box[2]) - 255 / 25.4 * 72) < 1.2, 'CSS page size was lost');
      }
      assert.deepEqual(await fs.readdir(temp), [], 'Temporary manuscript remained after export');
      console.log(`PASS ${name} PDF through production IPC`);
    }
    const preserved = path.join(output, 'existing.pdf');
    await fs.writeFile(preserved, 'Existing export must survive a failure');
    for (const failure of ['load', 'print']) {
      await application.evaluate((_electron, { failure, target }) => { global.pdfFailure = failure; global.pdfExportTarget = target; }, { failure, target: preserved });
      await assert.rejects(page.evaluate(() => window.wraiter.exportFile({ format: 'pdf', title: 'Failure fixture', html: '<p>Fixture</p>' })), new RegExp(`Synthetic ${failure} failure`));
      assert.deepEqual(await fs.readdir(temp), [], `Temporary manuscript remained after ${failure} failure`);
      assert.equal(await fs.readFile(preserved, 'utf8'), 'Existing export must survive a failure');
      console.log(`PASS ${failure} failure cleans up and preserves existing export`);
    }
    assert(await application.evaluate(() => global.pdfWindows.every(window => window.isDestroyed())), 'Print window leaked');
    console.log(`PDF export regression checks passed; files in ${output}`);
  } finally {
    if (application) {
      try { await (await application.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {}
      await application.close();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
