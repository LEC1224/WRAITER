// Actual Windows sharing locks on synthetic documents; no GUI or AI requests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DocumentStore } = require('../electron/core.cjs');
const { DocumentFiles } = require('../electron/document-files.cjs');
const output = path.resolve(__dirname, '..', 'test-output');
const textOf = node => node.text || (node.content || []).map(textOf).join('');
const draft = text => ({ format: 'wraiter', version: 1, id: 'real-windows-lock', title: 'Synthetic sharing lock', historySequence: 1, notes: 'Private lock-test note.', style: '', references: [], snapshots: [], chapters: [{ id: 'one', title: 'Chapter', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }] });

function hold(target, milliseconds) {
  const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-File', path.join(__dirname, 'hold-test-file.ps1'), '-Target', target, '-Milliseconds', String(milliseconds)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', stdout = '';
  child.stderr.on('data', value => { stderr += value; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Test lock helper exited ${code}: ${stderr}`)));
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows lock helper did not become ready.')); }, 10000);
    child.stdout.on('data', value => { stdout += value; if (stdout.includes('LOCKED')) { clearTimeout(timer); resolve(); } });
    done.catch(error => { clearTimeout(timer); reject(error); });
  });
  return { ready, done, child };
}

(async () => {
  if (process.platform !== 'win32') { console.log('SKIP: this workflow needs Windows file-sharing locks.'); return; }
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'windows-locks-')), checks = [];
  for (const format of ['wraiter', 'txt']) {
    const profile = path.join(directory, format), target = path.join(directory, `Synthetic.${format}`), store = new DocumentStore(profile), files = new DocumentFiles(store, profile);
    let current = draft('Original synthetic manuscript.');
    if (format === 'wraiter') await store.persist(current, target);
    else { await fs.writeFile(target, textOf(current.chapters[0].content)); const opened = await files.open(target); await files.bind(current, { openToken: opened.openToken }); }
    const persist = project => format === 'wraiter' ? store.persist(project, target) : files.persist(project, { format: 'txt', data: textOf(project.chapters[0].content) });
    for (const milliseconds of [600, 1800]) {
      const prior = await fs.readFile(target), next = draft(`${textOf(current.chapters[0].content)} Held for ${milliseconds} ms.`), helper = hold(target, milliseconds);
      const rename = fs.rename, attempts = []; let failedAttempts = null;
      await helper.ready;
      fs.rename = async (from, to) => {
        if (to !== target) return rename(from, to);
        const attempt = { success: false }; attempts.push(attempt);
        try { await rename(from, to); attempt.success = true; } catch (error) { attempt.code = error.code; throw error; }
      };
      try {
        if (milliseconds === 600) {
          await persist(next);
          assert.ok(attempts.length >= 2, 'the actual sharing lock must cause a retry');
          assert.ok(attempts.at(-1).success);
          assert.notDeepEqual(await fs.readFile(target), prior);
          assert.deepEqual(await fs.readFile(`${target}.bak`), prior);
        } else {
          await assert.rejects(persist(next), error => ['EPERM', 'EBUSY', 'EACCES'].includes(error.code));
          assert.equal(attempts.length, 6, 'initial replacement plus the five bounded retries');
          assert.ok(attempts.every(attempt => !attempt.success));
          assert.deepEqual(await fs.readFile(target), prior);
          const recovered = JSON.parse(await fs.readFile(store.recoveryPath, 'utf8')).project;
          assert.equal(textOf(recovered.chapters[0].content), textOf(next.chapters[0].content));
          assert.equal(recovered.notes, next.notes);
          failedAttempts = attempts.map(attempt => ({ ...attempt }));
          await helper.done; await persist(next);
        }
        const saved = format === 'wraiter' ? JSON.parse(await fs.readFile(target, 'utf8')) : (await files.readSidecar(target)).project;
        assert.equal(textOf(saved.chapters[0].content), textOf(next.chapters[0].content));
        assert.equal(saved.notes, next.notes);
        if (format === 'txt') assert.equal(await fs.readFile(target, 'utf8'), textOf(next.chapters[0].content));
        const finalRecovery = JSON.parse(await fs.readFile(store.recoveryPath, 'utf8')).project;
        assert.equal(textOf(finalRecovery.chapters[0].content), textOf(next.chapters[0].content));
        assert.equal(finalRecovery.notes, next.notes);
        checks.push({ format, milliseconds, attempts: failedAttempts || attempts.map(attempt => ({ ...attempt })), ...(failedAttempts ? { laterSaveAttempts: attempts.slice(failedAttempts.length) } : {}), recoveryRetained: true, laterSaveWorks: true });
        current = next;
      } finally { fs.rename = rename; await helper.done; }
    }
  }
  const result = { passed: true, directory, checks };
  await fs.writeFile(path.join(output, 'windows-locks-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
