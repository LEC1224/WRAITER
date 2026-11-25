// Sustain English/Swedish/dialect switching through the real stdio process.
// Uses synthetic passages only. node tests/offline-grammar-process-soak.cjs --minutes=90
const { OfflineGrammar } = require('../electron/offline-grammar.cjs');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const minutes = Number(process.argv.find(arg => arg.startsWith('--minutes='))?.slice(10) || 10);
assert.ok(Number.isFinite(minutes) && minutes > 0 && minutes <= 180);
const directory = process.env.WRAITER_EXECUTABLE ? path.join(path.dirname(process.env.WRAITER_EXECUTABLE), 'resources', 'offline-grammar') : path.join(root, 'build', 'offline-grammar', 'payload');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'offline-grammar-process-soak-'));
  const checker = new OfflineGrammar(directory, { timeout: 60000, idleTimeout: 60000 });
  const samples = [], timings = [], started = Date.now(), deadline = started + minutes * 60000;
  let cycles = 0, restarts = 0;
  const cases = [
    { language: 'en-US', text: '🙂 Its not safe.', original: 'Its', replacement: "It's" },
    { language: 'sv-SE', text: '🙂 Det var ett mörk kväll.', original: 'ett mörk kväll', replacement: 'en mörk kväll' },
    { language: 'en-GB', text: '🙂 The dogs runs quickly.', original: 'runs', replacement: 'run' }
  ];
  async function sample() {
    const pid = checker.child?.pid;
    if (!pid || process.platform !== 'win32') return;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$p = Get-Process -Id $env:WRAITER_TEST_GRAMMAR_PID -ErrorAction Stop; @{ workingSet = $p.WorkingSet64; privateBytes = $p.PrivateMemorySize64 } | ConvertTo-Json -Compress'],
      { encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, WRAITER_TEST_GRAMMAR_PID: String(pid) } });
    assert.equal(result.status, 0, result.stderr);
    const memory = JSON.parse(result.stdout);
    assert.ok(memory.privateBytes < 700 * 1024 * 1024, `Grammar process private memory reached ${Math.round(memory.privateBytes / 1048576)} MB`);
    samples.push({ cycle: cycles, elapsedMs: Date.now() - started, ...memory });
  }
  async function report(status, error) {
    await fs.writeFile(path.join(profile, 'report.json'), JSON.stringify({ status, minutesRequested: minutes, elapsedMs: Date.now() - started, cycles, restarts, timings, samples, directory, ...(error ? { failure: error.message } : {}) }, null, 2));
  }
  try {
    while (Date.now() < deadline || !cycles) {
      const item = cases[cycles % cases.length], before = Date.now();
      const [hints] = await checker.check({ language: item.language, texts: [item.text] });
      assert.ok(hints.some(hint => hint.original === item.original && hint.alternatives.includes(item.replacement) && item.text.slice(hint.from, hint.to) === item.original), `${item.language}: ${JSON.stringify(hints)}`);
      timings.push(Date.now() - before); cycles++;
      if (cycles % 10 === 0) {
        await sample(); await report('running');
        console.log(JSON.stringify({ cycles, elapsedMinutes: Number(((Date.now() - started) / 60000).toFixed(1)), privateMB: Number((samples.at(-1).privateBytes / 1048576).toFixed(1)), profile }));
      }
      if (cycles % 100 === 0 && Date.now() < deadline) { checker.stop(); restarts++; }
      if (Date.now() < deadline) await delay(Math.min(15000, deadline - Date.now()));
    }
    await sample(); await report('passed');
    console.log(JSON.stringify({ passed: true, cycles, restarts, elapsedMinutes: Number(((Date.now() - started) / 60000).toFixed(1)), profile }));
  } catch (error) { await report('failed', error).catch(() => {}); throw error; }
  finally { checker.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
