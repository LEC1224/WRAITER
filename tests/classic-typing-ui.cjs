// Synthetic document, isolated profile, local text substitutions only.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const dir = await fs.mkdtemp(path.join(root, 'test-output', 'classic-typing-'));
  const file = path.join(dir, 'test.wraiter');
  const project = { format: 'wraiter', version: 1, id: 'typing-fixture', title: 'Typing', chapters: [{ id: 'one', title: 'One', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prefix ' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'b', marks: [{ type: 'bold' }] }, { type: 'text', text: 'rb' }] }] } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', substitutions: [{ from: 'brb', to: 'be right back' }] }));
  const env = { ...process.env, WRAITER_USER_DATA: dir }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ args: [root, file], env, timeout: 60000 });
    const page = await app.firstWindow(), editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent.includes('Prefix'));
    const paragraphs = editor.locator('p');
    await paragraphs.nth(0).click(); await page.keyboard.press('End'); await page.keyboard.press('Control+b'); await page.keyboard.type('brb ');
    await page.waitForFunction(() => document.querySelector('.manuscript p')?.textContent.includes('be right back'));
    assert.equal(await paragraphs.nth(0).locator('strong').innerText(), 'be right back ');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('.manuscript p')?.textContent.includes('brb'));
    await paragraphs.nth(1).click(); await page.keyboard.press('End'); await page.keyboard.type(' ');
    assert.equal(await paragraphs.nth(1).innerText(), 'brb ');
    console.log('PASS Local substitutions preserve uniform bold formatting, undo, and skip mixed formatting.');
    await page.evaluate(() => window.wraiter.finishClose()).catch(() => {});
  } finally { await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
