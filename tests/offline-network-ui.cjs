// Capture Chromium's network log from process startup in a synthetic profile.
// DNS is disabled for the test; any attempted HTTP(S) URL is still a failure.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'offline-network-'));
  const target = path.join(profile, 'Synthetic offline network.wraiter'), netlog = path.join(profile, 'netlog.json');
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true, spellcheck: true, startup: 'new' }));
  await fs.writeFile(target, JSON.stringify({ format: 'wraiter', version: 1, id: 'offline-network', title: 'Synthetic offline network', language: 'sv-SE', chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Det var ett mörk kväll.' }] }] } }] }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const flags = [target, `--log-net-log=${netlog}`, '--host-resolver-rules=MAP * ~NOTFOUND'];
  const app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: flags, env } : { args: [root, ...flags], env });
  try {
    const page = await app.firstWindow();
    await page.locator('.local-grammar-hint').filter({ hasText: 'ett mörk kväll' }).waitFor({ timeout: 30000 });
    await page.getByRole('combobox', { name: 'Content language' }).selectOption('en-US');
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.evaluate(element => { const current = element.editor, first = current.state.doc.firstChild; current.view.dispatch(current.state.tr.insertText('She walk home with a freind.', 1, first.nodeSize - 1)); });
    await editor.locator('.local-grammar-hint').filter({ hasText: /^walk$/ }).waitFor({ timeout: 30000 });
    await editor.locator('.local-spelling-hint').filter({ hasText: /^freind$/ }).waitFor({ timeout: 30000 });
  } finally { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close(); }
  const log = JSON.parse(await fs.readFile(netlog, 'utf8')), urls = new Set();
  function collect(value) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) urls.add(value);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item);
  }
  for (const event of log.events || []) collect(event.params);
  assert.ok(log.events?.length, 'Chromium must produce a startup network log');
  assert.deepEqual([...urls], [], 'Offline spelling and grammar must not attempt HTTP(S) requests');
  console.log('PASS no HTTP(S) requests from startup through offline Swedish and English checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
