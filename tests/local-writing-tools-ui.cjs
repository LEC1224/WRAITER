const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const dir = await fs.mkdtemp(path.join(root, 'test-output', 'local-tools-'));
  const file = path.join(dir, 'test.wraiter');
  await fs.writeFile(file, JSON.stringify({ format:'wraiter', version:1, id:'local-tools', title:'Local tools', language:'en-US', chapters:[{ id:'one', title:'One', content:{ type:'doc', content:[{ type:'paragraph', content:[{ type:'text', text:'The the blue door. She could of seen the red door.' }] }] } }] }));
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ setupComplete:true, tutorialComplete:true, enabled:false, localGrammar:true }));
  const env = { ...process.env, WRAITER_USER_DATA:dir }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args:[root,file], env, timeout:60000 });
  try {
    const page = await app.firstWindow(), editor = page.getByRole('textbox', { name:'Manuscript editor', exact:true });
    await editor.waitFor({ timeout:30000 }); await page.waitForFunction(() => document.querySelectorAll('.local-grammar-hint').length === 2);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('command', 'local-grammar'));
    const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name:'Apply suggestion', exact:true }).first().click();
    assert((await editor.textContent()).startsWith('The blue'));
    await page.keyboard.press('Escape'); await editor.click(); await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent.startsWith('The the'));
    await page.keyboard.press('Control+h'); await page.getByRole('textbox', { name:'Find text', exact:true }).fill('(blue|red) (door)');
    await page.getByLabel('Regular expression (RE2)', { exact:true }).check();
    await page.getByRole('textbox', { name:'Replacement text', exact:true }).fill('$2: $1');
    await page.getByRole('button', { name:'Preview replace all', exact:true }).click();
    assert((await page.getByRole('region', { name:'Replace all preview' }).textContent()).includes('door: blue'));
    await page.getByRole('button', { name:'Replace all 2', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('.manuscript')?.textContent.includes('door: blue'));
    const found = await page.evaluate(() => window.wraiter.thesaurus('happy','en-US'));
    assert(found.available && found.senses.length > 0);
    console.log('PASS live grammar, exact correction and undo, regex capture preview/replacement, offline thesaurus');
  } finally { try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {} await app.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
