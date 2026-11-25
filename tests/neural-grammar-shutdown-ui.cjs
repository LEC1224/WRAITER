// Exercise real renderer IPC and native neural shutdown in isolated profiles.
// Run with WRAITER_EXECUTABLE to verify the same lifecycle in a packaged app.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const closeTimeout = 15000;

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function processIsAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function waitForProcessExit(pid) {
  while (processIsAlive(pid)) await new Promise(resolve => setTimeout(resolve, 50));
}

async function killOwnedProcess(child, exited, mainPid) {
  // The PID comes only from this test's newly launched Electron child. Never
  // find or terminate other WRAITER instances by executable name or profile.
  for (const pid of new Set([mainPid, child.pid])) {
    if (!processIsAlive(pid)) continue;
    if (process.platform === 'win32') {
      await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 }, () => resolve()));
    } else process.kill(pid, 'SIGKILL');
  }
  if (child.exitCode === null && child.signalCode === null)
    await bounded(exited, 8000, 'Owned test process cleanup');
}

async function waitForCloseRequest(evidencePath) {
  for (;;) {
    try {
      const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
      if (evidence.closeRequestedAt) return;
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function scenario(stage) {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, `neural-shutdown-${stage}-`));
  const evidencePath = path.join(profile, 'shutdown-evidence.json');
  const documentPath = path.join(profile, 'Synthetic shutdown.wraiter');
  const project = { format: 'wraiter', version: 1, id: `shutdown-${stage}`, title: 'Synthetic shutdown', language: 'en-US',
    chapters: [{ id: 'first', title: 'First', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The valley was quiet.' }] }] } }] };
  const originalDocument = JSON.stringify(project);
  await fs.writeFile(documentPath, originalDocument);
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true,
    enabled: false, localGrammar: false, spellcheck: false, startup: 'new', pageMode: 'continuous' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = process.env.WRAITER_EXECUTABLE
    ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [documentPath], env, timeout: 30000 }
    : { executablePath: require('electron'), args: [root, documentPath], env, timeout: 30000 };
  const app = await _electron.launch(launch);
  const child = app.process();
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let mainPid;
  try {
    const identity = await bounded(app.evaluate(({ app }) => ({ profile: app.getPath('userData'), pid: process.pid })), 10000, 'Profile verification');
    assert.equal(path.resolve(identity.profile), path.resolve(profile));
    mainPid = identity.pid;
    const page = await bounded(app.firstWindow(), 10000, 'First window');
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor({ timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.hide(); window.webContents.setBackgroundThrottling(false);
    });
    if (stage === 'inference') {
      const result = await bounded(page.evaluate(() => window.wraiter.offlineGrammar({
        language: 'en-US', texts: ['The soldiers lost there way.']
      })), 45000, 'Real neural warm-up IPC');
      assert.ok(result[0].some(hint => hint.rule?.startsWith('neural:') && hint.original === 'there' && hint.replacement === 'their'),
        'Warm-up must prove the native neural model is running, not only LanguageTool');
    }
    await app.evaluate(({ app }, { stage, evidencePath }) => {
      const path = process.getBuiltinModule('node:path'), fs = process.getBuiltinModule('node:fs');
      const requireApp = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'electron', 'main.cjs'));
      const { NeuralGrammar } = requireApp('./neural-grammar.cjs');
      const originalCheck = NeuralGrammar.prototype.check, originalStop = NeuralGrammar.prototype.stop;
      const evidence = { stage, pid: process.pid, userData: app.getPath('userData') };
      const save = () => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
      process.once('exit', code => { evidence.processExitCode = code; evidence.processExitAt = Date.now(); save(); });
      // Observe the real controller without replacing IPC, its worker, or its
      // native session. Schedule quit only after an actual check was submitted.
      NeuralGrammar.prototype.check = function (request) {
        const checking = originalCheck.call(this, request), worker = this.worker;
        if (evidence.checkObserved) return checking;
        evidence.checkObserved = true;
        evidence.characters = request.texts.reduce((sum, text) => sum + text.length, 0);
        evidence.requestSettled = false;
        checking.then(() => { evidence.requestSettled = true; }, () => { evidence.requestSettled = true; });
        const close = () => {
          evidence.pendingAtClose = this.pending.size;
          evidence.workerThreadAtClose = worker.threadId;
          evidence.settledAtClose = evidence.requestSettled;
          evidence.closeRequestedAt = Date.now();
          save(); app.quit();
        };
        if (stage === 'initialization') worker.once('online', () => {
          evidence.workerOnlineAt = Date.now(); setTimeout(close, 50);
        });
        else setTimeout(close, 10);
        return checking;
      };
      NeuralGrammar.prototype.stop = function (options) {
        evidence.pendingAtStop = this.pending.size;
        const stopping = originalStop.call(this, options);
        return Promise.resolve(stopping).then(stopped => {
          evidence.permanentStop = options?.permanent === true;
          evidence.stopped = stopped;
          evidence.remainingWorkers = this.workers?.size;
          evidence.stopCompletedAt = Date.now(); save();
          return stopped;
        });
      };
    }, { stage, evidencePath });
    const passage = 'The winding road crossed the quiet valley. '.repeat(80);
    assert.ok(passage.length <= 3500);
    await bounded(page.evaluate(({ text, requests }) => {
      // Deliberately do not await: quitting must work while the real IPC is live.
      window.shutdownChecks = Array.from({ length: requests }, () =>
        window.wraiter.offlineGrammar({ language: 'en-US', texts: [text, text, text] })
          .then(() => 'completed', () => 'cancelled'));
    }, { text: passage, requests: stage === 'inference' ? 3 : 1 }), 10000, 'Starting pending neural IPC');
    await bounded(waitForCloseRequest(evidencePath), 5000, 'Waiting for the scheduled close');
    // Playwright keeps a Node inspector attached. Release it as shutdown starts,
    // otherwise Node can wait for its debugger instead of terminating naturally.
    const [, exit] = await bounded(Promise.all([app.close(), exited]), closeTimeout, `Electron close during ${stage}`);
    await bounded(waitForProcessExit(mainPid), 5000, 'Actual Electron main process exit');
    assert.equal(exit.code, 0, `Electron exited abnormally during ${stage}`);
    assert.equal(exit.signal, null);
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
    assert.equal(evidence.pid, identity.pid);
    assert.equal(path.resolve(evidence.userData), path.resolve(profile));
    assert.ok(evidence.pendingAtClose > 0, 'Close must overlap outstanding native work');
    assert.ok(evidence.workerThreadAtClose > 0, 'The native worker must still be alive at close');
    assert.equal(evidence.settledAtClose, false);
    assert.equal(evidence.permanentStop, true);
    assert.ok(evidence.pendingAtStop > 0, 'Permanent shutdown must overlap native work or its queue');
    assert.equal(evidence.stopped, true, 'Shutdown must drain native work, not use the timeout fallback');
    assert.equal(evidence.remainingWorkers, 0);
    assert.equal(evidence.processExitCode, 0, 'The actual Electron main process must exit cleanly');
    assert.ok(evidence.processExitAt >= evidence.stopCompletedAt);
    if (stage === 'initialization') assert.ok(evidence.workerOnlineAt <= evidence.closeRequestedAt);
    const saved = JSON.parse(await fs.readFile(documentPath, 'utf8'));
    assert.equal(saved.id, project.id);
    assert.equal(saved.chapters.length, 1);
    assert.equal(saved.chapters[0].content.content[0].content[0].text, 'The valley was quiet.',
      'Shutdown must preserve the synthetic manuscript text');
    return { stage, passed: true, closeMs: evidence.stopCompletedAt - evidence.closeRequestedAt, profile };
  } finally {
    await killOwnedProcess(child, exited, mainPid);
    if (child.exitCode === null && child.signalCode === null)
      await bounded(app.close().catch(() => {}), 5000, 'Playwright transport cleanup');
  }
}

(async () => {
  const results = [];
  for (const stage of ['initialization', 'inference']) results.push(await scenario(stage));
  console.log(JSON.stringify({ passed: true, results }, null, 2));
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
