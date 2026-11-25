// Check that the document's English variant reaches the actual shared worker.
// Each app has an isolated, synthetic project and profile.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  for (const { language, incorrect, accepted } of [
    { language: 'en-US', incorrect: 'colour', accepted: 'color' },
    { language: 'en-GB', incorrect: 'color', accepted: 'colour' },
    { language: 'en-AU', incorrect: 'color', accepted: 'colour' },
    { language: 'en-CA', incorrect: 'color', accepted: 'colour' }
  ]) {
    const profile = await fs.mkdtemp(path.join(output, 'offline-dialect-'));
    const file = path.join(profile, 'Synthetic dialect.wraiter');
    const project = { format: 'wraiter', version: 1, id: `dialect-${language}`, title: 'Dialect test', language,
      chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The color and the colour were unusual.' }] }] } }] };
    await fs.writeFile(file, JSON.stringify(project));
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true, spellcheck: true, startup: 'new' }));
    const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env, timeout: 60000 } : { args: [root, file], env, timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
      const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
      const hints = editor.locator('.local-spelling-hint');
      await hints.filter({ hasText: new RegExp(`^${incorrect}$`) }).waitFor({ timeout: 30000 });
      assert.equal(await hints.filter({ hasText: new RegExp(`^${accepted}$`) }).count(), 0, language);
      assert.equal(await editor.innerText(), 'The color and the colour were unusual.');
      assert.deepEqual(errors, []);
    } finally { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close(); }
  }
  console.log('PASS offline US, UK, Australian and Canadian spelling variants in the editor');
})().catch(error => { console.error(error); process.exitCode = 1; });
