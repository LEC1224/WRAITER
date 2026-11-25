// Exercise the warm-cache boundary using real tab clicks and isolated drafts.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'warm-tab-rotation-'));
  const names = ['Alder', 'Birch', 'Cedar', 'Elm', 'Maple', 'Willow'];
  const tabs = names.map(() => randomUUID());
  const oldDate = '2025-06-01T12:00:00.000Z';
  for (const [i, title] of names.entries()) {
    const project = { format: 'wraiter', version: 1, id: `draft-${i}`, title, language: 'en-US', updatedAt: oldDate,
      chapters: [{ id: 'one', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Original text for ${title}.` }] }] } }],
      chats: [{ id: 'chat', title: 'Saved conversation', createdAt: oldDate, updatedAt: oldDate, messages: [] }], activeChatId: 'chat' };
    const directory = path.join(profile, 'Open projects', tabs[i]); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  }
  await fs.writeFile(path.join(profile, 'open-projects.json'), JSON.stringify({ version: 1, activeId: tabs[0], tabs: tabs.map(id => ({ id, view: { chapterId: 'one' } })) }));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, spellcheck: false, localGrammar: false, startup: 'restore' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  try {
    const target = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] };
    app = await _electron.launch({ ...target, env, timeout: 60000 }); page = await app.firstWindow();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    async function activate(i) {
      await page.locator(`[data-project-tab="${tabs[i]}"] [role=tab]`).click();
      await page.waitForFunction(id => document.querySelector(`[data-project-tab="${id}"] [aria-selected=true]`) && !document.querySelector('.workspace').inert && document.querySelector('.manuscript')?.editor?.isEditable, tabs[i]);
      assert.equal(await page.locator('.document-name').innerText(), names[i], 'The selected tab must retain its manuscript identity after cache eviction');
      assert.equal(await editor.innerText(), `Original text for ${names[i]}.`);
    }
    await app.evaluate(({ ipcMain }) => {
      const activate = ipcMain._invokeHandlers.get('workspace:activate'); ipcMain.removeHandler('workspace:activate');
      global.firstRotation = new Promise(resolve => { global.releaseRotation = resolve; });
      ipcMain.handle('workspace:activate', async (...args) => { await global.firstRotation; return activate(...args); });
    });
    const opening = activate(1);
    try {
      await page.locator(`[data-project-tab="${tabs[1]}"] [role=tab][aria-busy=true]`).waitFor();
      assert.equal(await page.locator('.workspace').evaluate(element => element.inert), true);
    } finally { await app.evaluate(() => global.releaseRotation()); await opening; }
    for (let i = 2; i < names.length; i++) await activate(i);
    await activate(0);
    await activate(5);
    // Once both are loaded, alternating between tabs must not retimestamp an
    // untouched chat or start an autosave for an unchanged document.
    await page.waitForFunction(() => !document.querySelector('.tab-save-dot'));
    await app.evaluate(({ ipcMain }) => {
      const save = ipcMain._invokeHandlers.get('autosave'); ipcMain.removeHandler('autosave');
      global.rotationSaves = 0;
      ipcMain.handle('autosave', (...args) => { global.rotationSaves++; return save(...args); });
    });
    for (let i = 0; i < 3; i++) { await activate(0); await activate(5); }
    await page.waitForFunction(() => !document.querySelector('.tab-save-dot'));
    assert.equal(await app.evaluate(() => global.rotationSaves), 0, 'Reading an unchanged chat must not cause a document save');
    const saved = JSON.parse(await fs.readFile(path.join(profile, 'Open projects', tabs[5], 'recovery.json'), 'utf8')).project;
    assert.equal(saved.chats[0].updatedAt, oldDate);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, profile, tabs: names.length, unnecessarySaves: 0 }));
  } finally { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
