import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { EditorState } from '@tiptap/pm/state';
import { editorialSchema } from '../electron/editor-schema.mjs';
import { EditJournal } from '../electron/edit-journal.cjs';
import { createHistory, normalizeHistoryProject, recordTransaction } from '../src/history.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editCount = Number(process.env.WRAITER_TEST_EDITS || 88000);
assert.ok(Number.isSafeInteger(editCount) && editCount > 0 && editCount % 2 === 0);
const output = path.join(root, 'test-output');
await fs.mkdir(output, { recursive: true });
const profile = await fs.mkdtemp(path.join(output, 'long-history-tabs-'));
const tabs = [randomUUID(), randomUUID()];
const text = 'The river followed the old road, then turned into the forest.';
const project = title => normalizeHistoryProject({
  format: 'wraiter', version: 1, id: title.toLowerCase(), title, language: 'en-US', notes: '', style: '', references: [], snapshots: [], chats: [], activeChatId: null,
  chapters: [{ id: 'opening', title: 'Opening', status: 'Draft', content: { type: 'doc', content: Array.from({ length: title === 'Ledger' ? 175 : 1 }, () => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } }],
}, editorialSchema);
const ledger = project('Ledger');

// Use two real, reversible editor transactions so the last historical edit
// can actually be undone and redone, however many events the fixture contains.
const initial = createHistory(ledger);
let journal = initial, previous = ledger;
for (const insert of [true, false]) {
  const state = EditorState.create({ schema: editorialSchema, doc: editorialSchema.nodeFromJSON(previous.chapters[0].content) });
  const transaction = insert ? state.tr.insertText('å', 1) : state.tr.delete(1, 2);
  const after = { ...previous, chapters: [{ ...previous.chapters[0], content: transaction.doc.toJSON() }] };
  journal = recordTransaction(journal, { chapterId: 'opening', transaction, beforeProject: previous, afterProject: after });
  previous = after;
}
const journalFiles = new EditJournal(profile);
await fs.mkdir(journalFiles.directory, { recursive: true });
const journalFile = journalFiles.filename(ledger.id);
const stream = (await fs.open(journalFile, 'wx')).createWriteStream();
stream.write(JSON.stringify(initial.events[0]) + '\n');
for (let i = 0; i < editCount; i++) {
  const template = journal.events[1 + i % 2], id = `synthetic-edit-${i}`;
  const event = { ...template, sequence: i + 2, entry: { ...template.entry, id, groupId: id } };
  if (!stream.write(JSON.stringify(event) + '\n')) await new Promise(resolve => stream.once('drain', resolve));
}
await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('close', resolve); stream.end(); });
ledger.historySequence = editCount + 1;
for (const [i, source] of [project('Notebook'), ledger].entries()) {
  const directory = path.join(profile, 'Open projects', tabs[i]);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'recovery.json'), JSON.stringify({ project: source, path: null, expectedHash: null }));
}
await fs.writeFile(path.join(profile, 'open-projects.json'), JSON.stringify({ version: 1, activeId: tabs[0], tabs: tabs.map(id => ({ id, empty: false, view: { chapterId: 'opening' } })) }));
await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, startup: 'restore', enabled: false, aiGrammar: false, localGrammar: true, spellcheck: true, pageMode: 'continuous', showParagraphNumbers: true, zoom: 125 }));
const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
let app, page;
try {
  const target = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] };
  app = await _electron.launch({ ...target, env, timeout: 60000 });
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
  await editor.waitFor();
  const pulse = () => {
    let last = performance.now(); const samples = [];
    const timer = setInterval(() => { const now = performance.now(); samples.push(now - last); last = now; }, 16);
    globalThis.historyPulse = () => { clearInterval(timer); return Math.round(Math.max(performance.now() - last, ...samples)); };
  };
  async function measureSwitch(id) {
    await app.evaluate(pulse);
    await page.evaluate(pulse);
    const start = Date.now();
    await page.locator(`[data-project-tab="${id}"] [role=tab]`).click();
    await page.waitForFunction(id => document.querySelector(`[data-project-tab="${id}"] [aria-selected=true]`) && !document.querySelector('.workspace').inert && document.querySelector('.manuscript')?.editor?.isEditable, id, { timeout: 90000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return { switchMs: Date.now() - start, rendererGapMs: await page.evaluate(() => globalThis.historyPulse()), mainGapMs: await app.evaluate(() => globalThis.historyPulse()) };
  }
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  if (process.env.WRAITER_HISTORY_PANEL) {
    await command('history');
    await page.locator('.history-panel').waitFor();
    if (process.env.WRAITER_HISTORY_PANEL === 'checkpoints') await page.getByRole('tab', { name: /Checkpoints/ }).click();
  }
  if (await page.evaluate(() => Boolean(window.wraiter.loadEditHistoryPage))) {
    // An inaccessible journal must leave the previous document editable and
    // allow the user to retry, with the incoming journal byte-for-byte intact.
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('history:page'); ipcMain.removeHandler('history:page');
      ipcMain.handle('history:page', (...args) => {
        if (global.failHistoryRead && args[1] === 'ledger') throw new Error('Journal is temporarily unavailable');
        return original(...args);
      });
      global.failHistoryRead = true;
    });
    const before = await fs.stat(journalFile);
    await page.locator(`[data-project-tab="${tabs[1]}"] [role=tab]`).click();
    await page.locator('.toast').filter({ hasText: 'Try the tab again' }).waitFor();
    assert.equal(await page.locator('[role=tab][aria-selected=true]').first().innerText(), 'Notebook');
    assert.equal((await fs.stat(journalFile)).mtimeMs, before.mtimeMs);
    assert.equal((await fs.readdir(journalFiles.directory)).some(name => name.includes('.preserved-')), false);
    await app.evaluate(() => { global.failHistoryRead = false; });
  }
  const cold = await measureSwitch(tabs[1]);
  const first = editor.locator(':scope > p').first();
  assert.equal(await first.innerText(), text);
  await command('undo');
  await page.waitForFunction(expected => document.querySelector('.manuscript > p').textContent === expected, 'å' + text);
  await command('redo');
  await page.waitForFunction(expected => document.querySelector('.manuscript > p').textContent === expected, text);
  await measureSwitch(tabs[0]);
  const warm = await measureSwitch(tabs[1]);
  await page.waitForFunction(() => document.querySelector('.manuscript')?.editor?.isEditable);
  assert.equal(await first.innerText(), text);
  assert.equal(await page.getByRole('dialog').count(), 0, 'The original undo history must remain intact');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ profile, historyPanel: process.env.WRAITER_HISTORY_PANEL || 'closed', edits: editCount, journalBytes: (await fs.stat(journalFile)).size, cold, warm, packaged: Boolean(process.env.WRAITER_EXECUTABLE) }, null, 2));
} finally {
  await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {});
  await app?.close().catch(() => {});
}
