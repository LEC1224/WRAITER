// Inject failures into copied application files, never into the source tree or
// an installed application. Copies and isolated profiles remain as QA evidence.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reports(profile) {
  const directory = path.join(profile, 'Logs');
  let names;
  try { names = await fs.readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return Promise.all(names.filter(name => /^wraiter-crash-.*\.json$/.test(name)).map(async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(80); }
  throw new Error(`Timed out waiting for ${label}.`);
}

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const evidence = await fs.mkdtemp(path.join(output, 'startup-diagnostics-'));
  const checks = []; let mainFailure;
  async function fixture(name) {
    const directory = path.join(evidence, name, 'app'), profile = path.join(evidence, name, 'profile');
    await fs.mkdir(directory, { recursive: true }); await fs.mkdir(profile);
    await Promise.all([
      fs.cp(path.join(root, 'electron'), path.join(directory, 'electron'), { recursive: true }),
      fs.cp(path.join(root, 'dist'), path.join(directory, 'dist'), { recursive: true }),
      fs.copyFile(path.join(root, 'package.json'), path.join(directory, 'package.json')),
    ]);
    await fs.mkdir(path.join(directory, 'assets'));
    await fs.copyFile(path.join(root, 'assets', 'icon.png'), path.join(directory, 'assets', 'icon.png'));
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, spellcheck: false, logNativeCrashDumps: false }));
    const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    return { directory, profile, env };
  }

  const main = await fixture('main-import');
  const provider = path.join(main.directory, 'electron', 'providers.cjs');
  await fs.writeFile(provider, "process.on('uncaughtException', () => require('electron').app.exit(92));\nthrow new TypeError('PRIVATE_STARTUP_MODULE_SENTINEL');\n" + await fs.readFile(provider, 'utf8'));
  const child = spawn(require('electron'), [main.directory], { cwd: root, env: main.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', timer;
  child.stdout.resume(); child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8000); });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
      timer = setTimeout(() => { child.kill(); reject(new Error('The isolated main-module failure did not exit.')); }, 30000);
    });
    assert.equal(code, 92, `The test-only uncaught handler should exit after recording the incident. ${stderr}`);
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill(); }
  const mainReports = await reports(main.profile);
  const mainReport = mainReports.find(item => item.event === 'app.startup-failed');
  try {
    assert.ok(mainReport, 'a top-level main application module failure must leave a structured report');
    assert.equal(mainReport.error.name, 'TypeError');
    assert.ok(mainReport.error.locations.some(location => location.startsWith('electron/providers.cjs:')));
    assert.doesNotMatch(JSON.stringify(mainReports), /PRIVATE_STARTUP_MODULE_SENTINEL/);
    checks.push('main application import failure is captured before application modules finish loading');
  } catch (error) { mainFailure = error; }

  const renderer = await fixture('renderer-import');
  const assets = path.join(renderer.directory, 'dist', 'assets');
  const bundles = (await fs.readdir(assets)).filter(name => /^App-.*\.js$/.test(name));
  assert.equal(bundles.length, 1, 'build the app before running startup diagnostics');
  const bundle = path.join(assets, bundles[0]);
  await fs.writeFile(bundle, "throw new TypeError('PRIVATE_RENDERER_IMPORT_SENTINEL');\n" + await fs.readFile(bundle, 'utf8'));
  let app;
  try {
    app = await electron.launch({ args: [renderer.directory], cwd: root, env: renderer.env, timeout: 60000 });
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'The writing view needs to restart.', exact: true }).waitFor({ timeout: 30000 });
    await waitFor(async () => (await reports(renderer.profile)).some(item => item.event === 'renderer.react.boundary'), 'renderer import failure report');
    const rendererReports = await reports(renderer.profile), rendererReport = rendererReports.find(item => item.event === 'renderer.react.boundary');
    assert.equal(rendererReport.error.name, 'TypeError');
    assert.ok(rendererReport.error.locations.some(location => location.startsWith(`dist/assets/${bundles[0]}:`)));
    assert.doesNotMatch(JSON.stringify(rendererReports), /PRIVATE_RENDERER_IMPORT_SENTINEL/);
    await page.getByRole('button', { name: 'Close WRAITER', exact: true }).click();
    await app.close(); app = null;
    checks.push('renderer application import failure shows the recovery boundary and saves a private-text-free report');
  } finally { if (app) { await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); await app.close().catch(() => {}); } }

  const result = { passed: !mainFailure, checks, evidence, mainProfile: main.profile, rendererProfile: renderer.profile };
  await fs.writeFile(path.join(output, 'startup-diagnostics-ui-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (mainFailure) throw mainFailure;
})().catch(error => { console.error(error); process.exitCode = 1; });
