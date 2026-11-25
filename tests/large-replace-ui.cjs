// Large synthetic replace-all with isolated recovery and no AI calls.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (condition, label) => {
  const until = Date.now() + 20000;
  while (Date.now() < until) { try { if (await condition()) return; } catch {} await pause(75); }
  throw new Error(label);
};

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'large-replace-')), now = new Date().toISOString();
  const paragraphs = Array.from({ length: 750 }, (_, index) => ({ type: 'paragraph', content: [
    { type: 'text', text: `Paragraph ${index + 1}: ` },
    { type: 'text', text: 'needle', ...(index === 0 ? { marks: [{ type: 'bold' }, { type: 'commentAnchor', attrs: { id: 'comment-one' } }] } : {}) },
    { type: 'text', text: ' and another needle.' }
  ] }));
  const project = { format: 'wraiter', version: 1, id: 'large-replace-ui', title: 'Replacement sample', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, chapters: [{ id: 'one', title: 'One', content: { type: 'doc', content: paragraphs } }], comments: [{ id: 'comment-one', chapterId: 'one', quote: 'needle', text: 'Keep this note.', createdAt: now, updatedAt: now, resolved: false }], references: [], notes: '', style: '', snapshots: [] };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false, pageMode: 'continuous' }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app, page;
  try {
    app = await _electron.launch(options); page = await app.firstWindow(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
    await waitFor(async () => (await page.evaluate(id => window.wraiter.loadEditHistory(id), project.id)).totalEvents > 0, 'initial history');
    await command('find');
    const find = page.getByRole('textbox', { name: 'Find text', exact: true }); await find.fill('needle');
    await waitFor(async () => (await page.getByRole('region', { name: 'Manuscript search and replace' }).getByRole('status').innerText()) === '1500 matches', 'complete search');
    await page.getByRole('textbox', { name: 'Replacement text', exact: true }).fill('target');
    await page.getByRole('button', { name: 'Preview replace all', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Replace all preview', exact: true }); await preview.waitFor();
    assert.match(await preview.innerText(), /Replace 1500 matches in 1 chapter\?/);
    await preview.getByRole('button', { name: 'Replace all 1500', exact: true }).click();
    await waitFor(async () => (await editor.locator(':scope > p').first().innerText()).includes('target and another target.'), 'first replacements');
    assert.match(await editor.locator(':scope > p').last().innerText(), /target and another target\.$/);
    assert.equal(await editor.locator('[data-comment-id="comment-one"]').innerText(), 'target');
    assert.ok(await editor.locator('[data-comment-id="comment-one"]').evaluate(element => Boolean(element.closest('strong') || element.querySelector('strong'))));
    await command('undo');
    await waitFor(async () => (await editor.locator(':scope > p').last().innerText()).includes('needle and another needle.'), 'one undo restores all matches');
    assert.equal(await editor.locator('[data-comment-id="comment-one"]').innerText(), 'needle');
    await command('redo');
    await waitFor(async () => (await editor.locator(':scope > p').last().innerText()).includes('target and another target.'), 'redo restores all replacements');
    await waitFor(async () => {
      const saved = JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
      return saved.chapters[0].content.content.at(-1).content.map(node => node.text || '').join('').includes('target and another target.');
    }, 'replacement recovery');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, matches: 1500, checks: ['replace all', 'comment and formatting', 'single undo and redo', 'recovery'], userData }, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(userData, 'failure.png') }).catch(() => {}); throw error; }
  finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
