// Hold only IPC acknowledgments. Real journal writes and ordinary recovery
// still run, just as they would while the renderer is ahead of slow storage.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'journal-burst-'));
  const project = { format: 'wraiter', version: 1, id: 'journal-burst', title: 'Slow journal', chapters: [{ id: 'one', title: 'One', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Starting text.' }] }] } }] };
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, startup: 'restore', enabled: false, spellcheck: false, localGrammar: false }));
  await fs.writeFile(path.join(profile, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const target = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] };
  let app, page;
  try {
    app = await _electron.launch({ ...target, env, timeout: 60000 }); page = await app.firstWindow();
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await page.waitForFunction(() => !document.querySelector('.tab-save-dot'));
    await editor.evaluate(element => element.editor.commands.focus('end'));
    const count = () => page.evaluate(async () => (await window.wraiter.loadEditHistory('journal-burst')).totalEvents);
    const before = await count();
    await app.evaluate(({ ipcMain }) => {
      const append = ipcMain._invokeHandlers.get('history:append'); ipcMain.removeHandler('history:append');
      global.burstPayload = []; global.burstGate = new Promise(resolve => { global.releaseBurst = resolve; });
      ipcMain.handle('history:append', async (...args) => {
        global.burstPayload.push(args[2].map(event => event.sequence));
        if (global.dropNextBurst) { global.dropNextBurst = false; throw new Error('Transient journal write failure'); }
        const response = await append(...args); await global.burstGate; return response;
      });
    });
    const text = ' every character reaches the journal promptly';
    await page.keyboard.type(text);
    assert.equal(await editor.innerText(), 'Starting text.' + text);
    assert.equal(await count(), before + text.length, 'All edits reached storage before acknowledgment');
    const sent = await app.evaluate(() => global.burstPayload.flat());
    await app.evaluate(() => global.releaseBurst());
    assert.equal(new Set(sent).size, text.length);
    console.log(JSON.stringify({ edits: text.length, submitted: sent.length }));
    assert.equal(sent.length, text.length, 'Typing should send each new edit once while earlier writes are awaiting acknowledgment');
    await app.evaluate(() => { global.dropNextBurst = true; });
    await editor.evaluate(element => element.editor.commands.focus('end'));
    await page.keyboard.type(' after a retry');
    const expected = 'Starting text.' + text + ' after a retry';
    await page.waitForFunction(expected => document.querySelector('.manuscript').textContent === expected && !document.querySelector('.tab-save-dot'), expected);
    assert.equal(await count(), before + text.length + ' after a retry'.length);
    let recovered = JSON.parse(await fs.readFile(path.join(profile, 'recovery.json'), 'utf8')).project;
    assert.equal(recovered.chapters[0].content.content[0].content[0].text, expected);
    assert.equal(recovered.historySequence, await count());
    console.log(JSON.stringify({ passed: true, profile }));
  } finally {
    await app?.evaluate(() => global.releaseBurst?.()).catch(() => {});
    await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {});
    await app?.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
