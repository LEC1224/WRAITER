// A deliberately damaged journal must never make the intact manuscript
// inaccessible. All files are synthetic and isolated from the user's account.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { hash } = require('../electron/core.cjs');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (fn, label, timeout = 20000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await fn()) return; } catch {} await pause(100); } throw new Error(`Timed out: ${label}`); };
const nodeText = node => node.type === 'text' ? node.text : (node.content || []).map(nodeText).join(node.type === 'doc' ? '\n' : '');
const fixture = id => ({ format: 'wraiter', version: 1, id, title: 'History recovery test', chapters: [{ id: 'chapter', title: 'Opening', status: 'Draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic safe text. ' }] }] } }], references: [], snapshots: [], notes: '', style: '', language: 'en-US' });
async function filesBelow(directory) {
  const result = []; for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) result.push(...await filesBelow(target)); else result.push(target); } return result;
}

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true }); const results = [];
  for (const scenario of ['unreadable-interior', 'valid-json-mismatch']) {
    const userData = await fs.mkdtemp(path.join(output, `history-recovery-${scenario}-`)); const initial = fixture(scenario); const errors = [];
    await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ enabled: false, continuous: false }));
    await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: initial, path: null, expectedHash: null }));
    const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
    const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
    const journalPath = path.join(userData, 'Edit history', `${hash(initial.id)}.jsonl`);
    const recover = async () => JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
    let app, page, editor;
    const launch = async () => { app = await electron.launch(options); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 }); };
    try {
      await launch(); await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('AB', { delay: 55 });
      await waitFor(async () => nodeText((await recover()).chapters[0].content) === 'Synthetic safe text. AB', 'initial manuscript autosave');
      await app.close(); app = null;
      const intact = await recover(); const lines = (await fs.readFile(journalPath, 'utf8')).trimEnd().split('\n'); assert.ok(lines.length >= 3, 'init plus two atomic typing records');
      if (scenario === 'unreadable-interior') lines[1] = '{"sequence":2,"kind":"edit",BROKEN_INTERIOR_RECORD';
      else { const second = JSON.parse(lines[1]); second.beforeFingerprint = 'synthetic-impossible-fingerprint'; lines[1] = JSON.stringify(second); }
      const damaged = lines.join('\n') + '\n'; await fs.writeFile(journalPath, damaged);
      await launch(); assert.equal(await editor.innerText(), 'Synthetic safe text. AB');
      const notice = page.getByRole('dialog', { name: 'Editing history recovered', exact: true }); await notice.waitFor(); assert.match(await notice.innerText(), /fresh undo history|preserved/i); await notice.getByRole('button', { name: 'Close dialog', exact: true }).click();
      assert.deepEqual((await recover()).chapters, intact.chapters, 'the damaged history must not rewrite the intact manuscript');
      await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('X');
      await waitFor(async () => nodeText((await recover()).chapters[0].content) === 'Synthetic safe text. ABX', 'new branch accepts a durable edit');
      await page.keyboard.press('Control+z'); await waitFor(async () => nodeText((await recover()).chapters[0].content) === 'Synthetic safe text. AB', 'new branch supports undo');
      await app.close(); app = null; await launch(); assert.equal(await editor.innerText(), 'Synthetic safe text. AB');
      await editor.click(); await page.keyboard.press('Control+y'); await waitFor(async () => nodeText((await recover()).chapters[0].content) === 'Synthetic safe text. ABX', 'new branch redo survives restart');
      const currentJournal = await fs.readFile(journalPath, 'utf8'); assert.ok(!currentJournal.includes('BROKEN_INTERIOR_RECORD') && !currentJournal.includes('synthetic-impossible-fingerprint'));
      const archivedFiles = (await filesBelow(path.join(userData, 'Edit history'))).filter(target => target !== journalPath);
      let preserved = false;
      for (const target of archivedFiles) if (await fs.readFile(target, 'utf8') === damaged) { preserved = true; break; }
      assert.ok(preserved, 'the complete damaged journal remains archived for inspection');
      assert.deepEqual(errors, []); await page.screenshot({ path: path.join(output, `history-recovery-${scenario}.png`) });
      results.push({ scenario, passed: true, intactManuscriptRetained: true, originalJournalArchived: true, newUndoBranchWorks: true, restartRedoWorks: true, userData });
    } catch (error) { if (page) await page.screenshot({ path: path.join(output, `history-recovery-${scenario}-failure.png`) }).catch(() => {}); throw error; }
    finally { if (app) await app.close().catch(() => {}); }
  }
  const report = { passed: true, results }; await fs.writeFile(path.join(output, 'history-recovery-ui-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
