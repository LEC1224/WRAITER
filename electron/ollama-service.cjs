const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

let owned = null; let starting = null;
function isLocalOllama(baseUrl) {
  try { const url = new URL(baseUrl); return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && (url.port || '80') === '11434' && !url.username && !url.password && !url.search && !url.hash && ['', '/'].includes(url.pathname); } catch { return false; }
}
async function resolveOllama() {
  const executable = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const candidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory.replace(/^"|"$/g, ''), executable));
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  if (process.platform === 'darwin') candidates.push('/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama');
  for (const candidate of candidates) if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  throw new Error('Ollama is not running or installed here. Install Ollama, add a model, then choose Connect. WRAITER starts the local service automatically.');
}
async function startOllama(baseUrl) {
  if (!isLocalOllama(baseUrl)) throw new Error('Start the Ollama service at the configured address, then connect again.');
  if (owned && owned.exitCode == null && !owned.killed) return;
  if (starting) return starting;
  starting = (async () => {
    const executable = await resolveOllama();
    const env = { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', NO_COLOR: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, ['serve'], { env, cwd: os.tmpdir(), windowsHide: true, shell: false, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.on('error', () => {}); owned = child;
    child.once('close', () => { if (owned === child) owned = null; });
  })();
  try { return await starting; } finally { starting = null; }
}
async function stopOwnedOllama() {
  if (starting) await starting.catch(() => {});
  const child = owned; owned = null;
  if (!child || child.exitCode != null || !child.pid) return;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 2000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    if (process.platform === 'win32') {
      const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
      killer.on('error', () => child.kill());
    } else child.kill();
  });
}
module.exports = { isLocalOllama, resolveOllama, startOllama, stopOwnedOllama };
