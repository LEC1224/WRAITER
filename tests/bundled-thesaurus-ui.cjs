// Exercise the actual packaged fallback with a private profile and no network.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'bundled-thesaurus-'));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore' }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env } : { args: [root], env };
  let app, page;
  try {
    app = await _electron.launch({ ...options, timeout: 60000 }); page = await app.firstWindow();
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
    await app.evaluate(() => {
      const files = process.getBuiltinModule('node:fs/promises'), path = process.getBuiltinModule('node:path');
      const installed = path.join(process.env.ProgramFiles, 'LibreOffice', 'share', 'extensions', 'dict-en', 'th_en_US_v2');
      const original = files.readFile, reads = { installed: 0, index: 0, data: 0 };
      globalThis.__bundledThesaurusTest = { original, reads };
      files.readFile = async (file, ...args) => {
        const name = String(file);
        if (name === installed + '.idx' || name === installed + '.dat') {
          reads.installed++; const error = new Error('Synthetic unavailable LibreOffice dictionary'); error.code = 'ENOENT'; throw error;
        }
        if (name.endsWith('th_en_US_v2.idx.gz')) reads.index++;
        if (name.endsWith('th_en_US_v2.dat.gz')) reads.data++;
        return original.call(files, file, ...args);
      };
    });
    const results = await page.evaluate(() => Promise.all(Array.from({ length: 8 }, () => window.wraiter.thesaurus('happy', 'en-US'))));
    assert.ok(results.every(result => result.available && result.senses.length > 0));
    assert.deepEqual(await app.evaluate(() => globalThis.__bundledThesaurusTest.reads), { installed: 2, index: 1, data: 1 });
    console.log(JSON.stringify({ passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, checks: ['bundled offline lookup', 'concurrent lookups share one load'], userData }, null, 2));
  } finally {
    await app?.evaluate(() => {
      const saved = globalThis.__bundledThesaurusTest;
      if (saved) process.getBuiltinModule('node:fs/promises').readFile = saved.original;
    }).catch(() => {});
    await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {});
    await app?.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
