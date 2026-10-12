// Force an isolated app to exit without the normal close/save handshake after
// its real edit journal has flushed, but before its project snapshot can save.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const textOf = node => node.text || (node.content || []).map(textOf).join(node.type === 'doc' ? '\n' : '');
async function waitFor(fn, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { try { if (await fn()) return; } catch {} await pause(70); }
  throw new Error(label);
}
(async () => {
  await fs.mkdir(output, { recursive: true }); const checks = [];
  for (const format of ['wraiter', 'odt']) {
    const userData = await fs.mkdtemp(path.join(output, `crash-recovery-${format}-`)), target = path.join(userData, `Synthetic crash recovery.${format}`), marker = ' JOURNAL_ONLY_CRASH_EDIT';
    const project = { format: 'wraiter', version: 1, id: `crash-recovery-${format}`, title: 'Synthetic crash recovery', language: 'en-US', notes: 'PRIVATE_CRASH_RECOVERY_NOTE', style: '', references: [], snapshots: [], chapters: [{ id: 'first', title: 'First chapter', content: { type: 'doc', content: ['First synthetic paragraph.', 'Second synthetic paragraph.', 'Final paragraph before the crash.'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } }, { id: 'other', title: 'Other chapter', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An unchanged chapter stays intact.' }] }] } }] };
    await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false }));
    await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
    const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
    const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
    let app, page, editor; const errors = [];
    const recover = async () => JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
    const launch = async () => { app = await _electron.launch(options); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 }); };
    try {
      await launch();
      await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
      await command('save-copy');
      await waitFor(async () => { const recovered = JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')); return recovered.path === target && (await fs.stat(target)).size > 0; }, 'initial named save');
      await pause(1000);
      const original = await fs.readFile(target), snapshot = await recover(), before = await editor.innerText(), beforeText = textOf(snapshot.chapters[0].content);
      const sequence = (await page.evaluate(id => window.wraiter.loadEditHistory(id), project.id)).totalEvents;
      // Only this test window's autosave timer is delayed. Journal appends keep
      // their actual IPC, queue, flush and acknowledgement path unchanged.
      await page.evaluate(() => { const original = window.setTimeout.bind(window); window.setTimeout = (callback, delay, ...args) => original(callback, delay === 650 ? 3600000 : delay, ...args); });
      await editor.evaluate((element, marker) => { const current = element.editor; current.view.focus(); current.view.dispatch(current.state.tr.insertText(marker, current.state.doc.content.size - 1)); }, marker);
      await waitFor(async () => (await page.evaluate(id => window.wraiter.loadEditHistory(id), project.id)).totalEvents > sequence, 'real journal append is durable');
      assert.ok((await editor.innerText()).endsWith(marker));
      assert.deepEqual(await fs.readFile(target), original, 'source has not been saved before the crash');
      assert.deepEqual((await recover()).chapters, snapshot.chapters, 'recovery still predates the journal-only edit');
      const crashedProcess = app.process();
      await app.evaluate(({ app }) => app.exit(91)).catch(() => {});
      await waitFor(() => crashedProcess.exitCode !== null, 'forced app exit'); assert.equal(crashedProcess.exitCode, 91);
      await app.close().catch(() => {}); app = null;
      assert.deepEqual(await fs.readFile(target), original, 'exit bypassed normal close/save');
      await launch(); assert.equal(await editor.innerText(), before + marker);
      await waitFor(async () => textOf((await recover()).chapters[0].content) === beforeText + marker, 'replayed journal tail is saved to recovery');
      assert.equal((await recover()).notes, project.notes);
      assert.equal(textOf((await recover()).chapters[1].content), textOf(project.chapters[1].content));
      await waitFor(async () => {
        const bytes = await fs.readFile(target);
        if (format === 'wraiter') return textOf(JSON.parse(bytes).chapters[0].content) === beforeText + marker;
        const xml = await (await JSZip.loadAsync(bytes)).file('content.xml').async('string');
        assert.ok(!xml.includes(project.notes), 'private notes stay outside office text');
        return xml.includes(marker.trim());
      }, 'replayed edit reaches its actual named source');
      await command('undo'); await waitFor(async () => textOf((await recover()).chapters[0].content) === beforeText, 'recovered edit supports undo');
      await command('redo'); await waitFor(async () => textOf((await recover()).chapters[0].content) === beforeText + marker, 'recovered edit supports redo');
      await app.close(); app = null; await launch(); assert.equal(await editor.innerText(), before + marker);
      assert.equal((await recover()).notes, project.notes); assert.deepEqual(errors, []);
      checks.push({ format, passed: true, userData, journalTailRecovered: true, privateNotesRetained: true, namedSaveResumed: true, undoRedoAndRestartPassed: true });
    } finally { await app?.close().catch(() => {}); }
  }
  const result = { passed: true, checks }; await fs.writeFile(path.join(output, 'crash-recovery-ui-results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
