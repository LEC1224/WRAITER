const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const { defaults } = require('../electron/preferences.cjs');
const opening = "There was once a software called Wraiter, that was used to integrate AI in authors' workflows. One day";
(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'walkthrough-'));
  const requests = []; let nextFailure = false, delay = 120;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'tutorial-test' }] }));
    let input = ''; req.on('data', chunk => input += chunk); req.on('end', () => {
      const body = JSON.parse(input); requests.push(body);
      if (nextFailure) { nextFailure = false; res.writeHead(503); return res.end(JSON.stringify({ error: { message: 'Temporary test outage' } })); }
      const prompt = JSON.stringify(body);
      let text;
      if (body.messages[0].content.includes('JSON document tools')) {
        const user = body.messages[1].content;
        const records = JSON.parse(user.split('CURRENT TOOL RESULTS:\n')[1].split('\n\nRemaining document tools:')[0]);
        if (!records.length) text = JSON.stringify({ done: false, message: 'Reading the active chapter.', tools: [{ name: 'read_document', arguments: { scope: 'active' } }] });
        else if (records.length === 1) {
          const block = records[0].result.blocks.at(-1);
          text = JSON.stringify({ done: false, message: 'Adding a sentence.', tools: [{ name: 'rewrite_passage', arguments: { blockId: block.blockId, before: block.text, after: block.text + ' Even the full stop wanted to know what happened next.', scope: 'active' } }] });
        } else text = JSON.stringify({ done: true, message: 'Added a playful sentence to the active chapter.', tools: [] });
      } else text = /alternatives/i.test(prompt) ? JSON.stringify({ alternatives: [{ text: 'application', rating: 3 }, { text: 'program', rating: 2 }, { text: 'tool', rating: 2 }] }) : /wasnt/.test(prompt) ? 'The writer had a notebook full of ideas, but she wasn’t sure where to begin.' : 'a writer discovered a door hidden inside an unfinished sentence. She opened it and stepped into the story.';
      setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: text } }] })); }, delay);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ...defaults, setupComplete: true, tutorialComplete: true, enabled: true, continuous: false, provider: 'compatible', baseUrl, model: 'tutorial-test', taskProfiles: {} }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page; const errors = [];
  const launch = async () => { app = await electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] }), env, timeout: 60000 }); page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message)); await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor(); };
  const close = async () => { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'close-request')); await app.waitForEvent('close', { timeout: 15000 }).catch(() => {}); await app.close().catch(() => {}); };
  const command = value => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('command', value), value);
  const editor = () => page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
  const step = value => page.locator(`.walkthrough[data-step="${value}"]`).waitFor({ timeout: 20000 });
  const next = name => page.getByRole('button', { name, exact: true }).click();
  try {
    await launch();
    await editor().fill('My original manuscript must stay exactly as it is.');
    await command('tutorial'); await step('welcome');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByRole('tab', { name: /Learning WRAITER/ }).count(), 1);
    // Use the actual command to update renderer preferences after the practice
    // project owns the tour. A backend-only write leaves the renderer unchanged.
    await command('toggle-continuous');
    await page.getByRole('button', { name: 'Automatic suggestions paused for tour', exact: true, pressed: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'walkthrough-welcome.png') });
    await next('Let’s begin'); await step('chapter');
    await next('New chapter'); await step('opening');
    await page.getByRole('tab', { name: 'Untitled manuscript', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'My original manuscript must stay exactly as it is.');
    assert.equal(await editor().innerText(), 'My original manuscript must stay exactly as it is.');
    await next('Return to walkthrough'); await step('complete');
    assert.equal(await editor().innerText(), opening);
    assert.equal(requests.length, 0, 'seeding must not cause automatic AI calls');
    nextFailure = true; await editor().press('Tab'); await page.getByRole('alert').filter({ hasText: 'Temporary test outage' }).waitFor(); await step('complete');
    await editor().press('Tab'); await step('preview');
    await page.screenshot({ path: path.join(output, 'walkthrough-preview.png') });
    await editor().press('ArrowRight'); await editor().press('Control+ArrowRight');
    assert.notEqual(await editor().innerText(), opening);
    await editor().press('Escape'); assert.equal(await page.locator('.ghost-text').count(), 0);
    await editor().press('Tab'); await page.locator('.ghost-text').waitFor(); await editor().press('Tab'); await step('practice');
    // Another real UI request may be cancelled while it is pending.
    delay = 1500; await editor().press('Tab'); await page.getByLabel('Generating suggestion').waitFor(); await editor().press('Escape'); delay = 120;
    await next('Try changing a word'); await step('rephrase');
    await page.waitForFunction(() => window.getSelection()?.toString() === 'software');
    await editor().press('Tab'); await page.getByRole('listbox', { name: 'Rephrasing alternatives' }).waitFor();
    await editor().press('ArrowDown'); await editor().press('Enter');
    assert.match(await editor().innerText(), /There was once a program called Wraiter/);
    await next('Explore undo'); await step('undo'); await editor().press('Control+z');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent.includes('a software called'));
    await editor().press('Control+Shift+z'); await next('Try correction'); await step('correct');
    await page.waitForFunction(() => window.getSelection()?.toString().includes('wasnt'));
    await editor().press('Control+Alt+g'); await page.locator('.ghost-text').waitFor(); await editor().press('Tab');
    await next('Give AI some direction'); await step('voice');
    await next('Notes & voice'); await page.getByRole('textbox', { name: 'Writing voice instructions' }).fill('Keep the tone playful and the sentences clear.');
    await next('Explore references'); await step('references'); await page.locator('[data-tour="references"]').click();
    await page.getByRole('checkbox', { name: 'Include in AI context' }).uncheck();
    await next('Try the writing assistant'); await step('chat');
    await next('Prepare a chat request'); await page.getByRole('textbox', { name: 'Ask the writing assistant' }).waitFor();
    assert.match(await page.getByRole('textbox', { name: 'Ask the writing assistant' }).inputValue(), /Add one short/);
    await page.getByRole('button', { name: 'Send writing question', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent.includes('Even the full stop wanted'));
    assert.ok(requests.filter(body => body.messages[0].content.includes('JSON document tools')).every(body => JSON.stringify(body).includes('Keep the tone playful') && !JSON.stringify(body).includes('Practice story background')));
    await page.screenshot({ path: path.join(output, 'walkthrough-chat.png') });
    // At the supported minimum window size, the dock and real chat remain usable.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    await page.screenshot({ path: path.join(output, 'walkthrough-small.png') });
    const fits = await page.locator('.walkthrough').evaluate(node => ({ width: node.getBoundingClientRect().right <= innerWidth, height: node.getBoundingClientRect().bottom <= innerHeight, workspace: document.querySelector('.workspace').getBoundingClientRect().height }));
    assert.ok(fits.width && fits.height && fits.workspace > 250);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 960));
    // Restart at this step. The untouched original and the edited practice story survive.
    await tourPause(); await close(); await launch();
    await next('Resume walkthrough'); await step('chat');
    await command('settings-appearance'); await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    assert.equal((await page.evaluate(async () => (await window.wraiter.boot()).prefs)).tutorialSession.step, 'chat', 'Settings must not overwrite newer progress');
    await next('Skip this lesson'); await step('history'); await page.locator('[data-tour="history"]').click(); await next('Find your way around');
    await step('find'); await command('find'); await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('Wraiter'); await next('Explore the page view');
    await step('pages'); await page.locator('[data-tour="page-view"]').click(); await next('Try focus view');
    await step('focus'); await command('focus'); await next('Learn about saving'); await step('save');
    await next('Continue without a named file'); await step('export'); await next('Open Export'); await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await next('Finish the walkthrough'); await step('finish'); await next('Return to my writing');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent === 'My original manuscript must stay exactly as it is.');
    const prefs = await page.evaluate(async () => (await window.wraiter.boot()).prefs);
    assert.equal(prefs.tutorialComplete, true); assert.equal(prefs.tutorialSession, null);
    assert.ok(requests.every(body => !JSON.stringify(body).includes('My original manuscript') && !JSON.stringify(body).includes('Private practice note')));
    assert.deepEqual(errors, []);
    console.log('PASS: nonmodal walkthrough, real editor/HTTP AI path, failure/retry/cancel, partial acceptance, rephrasing, undo/redo, correction, context controls, resume, navigation, export and original-document isolation.');
  } finally { if (app) await close().catch(() => app.close()); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
  async function tourPause() { await next('Pause'); await page.getByRole('button', { name: 'Resume walkthrough' }).waitFor(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
