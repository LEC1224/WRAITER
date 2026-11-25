import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, appendFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runtime = path.join(root, '.runtime');
const logs = path.join(runtime, 'logs');
const stopFile = path.join(runtime, 'stop');
const stateFile = path.join(runtime, 'state.json');
await mkdir(logs, { recursive: true });
await rm(stopFile, { force: true });
let stopping = false, child, restartTimer;
const startedAt = new Date().toISOString();
let logQueue = Promise.resolve();
function log(data) {
  logQueue = logQueue.catch(() => {}).then(async () => {
    const file = path.join(logs, 'service.log');
    if ((await stat(file).catch(() => ({ size: 0 }))).size > 5 * 1024 * 1024) {
      await rm(file + '.1', { force: true });
      await rename(file, file + '.1');
    }
    await appendFile(file, data);
  });
}
async function state(status) {
  await writeFile(stateFile + '.tmp', JSON.stringify({ status, supervisor: process.pid, process: child?.pid || null, startedAt, updatedAt: new Date().toISOString() }));
  await rename(stateFile + '.tmp', stateFile);
}
function launch() {
  if (stopping) return;
  child = spawn(process.execPath, ['--env-file=' + path.join(root, 'config', 'server.env'), path.join(root, 'cloud', 'server.cjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  log(`[${new Date().toISOString()}] Starting WRAITER Cloud.\n`);
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.once('error', () => log('WRAITER process could not start.\n'));
  child.once('exit', code => {
    child = undefined;
    log(`[${new Date().toISOString()}] WRAITER stopped (code ${code}).\n`);
    if (!stopping) restartTimer = setTimeout(launch, 5000);
  });
  void state('running');
}
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(stopTimer);
  clearTimeout(restartTimer);
  await state('stopping');
  if (child) {
    const exiting = child;
    const finished = new Promise(resolve => exiting.once('exit', resolve));
    exiting.kill('SIGTERM');
    await finished;
  }
  await state('stopped');
  await rm(stopFile, { force: true });
  await logQueue;
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
const stopTimer = setInterval(() => { if (existsSync(stopFile)) void stop(); }, 1000);
launch();
