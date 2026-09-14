const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function resolveClaude(configured = '') {
  if (configured && (!path.isAbsolute(configured) || (process.platform === 'win32' && !/\.exe$/i.test(configured)))) throw new Error('Choose the full path to claude.exe.');
  const candidates = configured ? [configured] : [path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'), ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude'))];
  for (const candidate of candidates) if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  throw new Error('Claude Code was not found. Use Install in the setup wizard, then check again.');
}
function environment() {
  const env = { ...process.env, NO_COLOR: '1' };
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_.*|CLAUDECODE|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key];
  return env;
}
function run(executable, args, { input = '', signal, cwd = os.tmpdir(), timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let output = '', failure, stopping;
    const child = spawn(executable, args, { cwd, env: environment(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const kill = () => {
      if (stopping) return;
      if (process.platform === 'win32' && child.pid) {
        stopping = new Promise(resolve => {
          const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.once('error', () => { child.kill(); resolve(); }); killer.once('close', resolve);
        });
      } else { child.kill(); stopping = Promise.resolve(); }
    };
    const stop = () => { failure ||= new Error('Operation cancelled.'); kill(); };
    const timer = setTimeout(() => { failure = new Error('The operation timed out. Check your connection and try again.'); kill(); }, timeout);
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
    child.stdout.on('data', chunk => { if (failure) return; output += chunk; if (Buffer.byteLength(output) > 4 * 1024 * 1024) { failure = new Error('Provider response too large.'); kill(); } });
    child.on('error', error => { failure = new Error(`Could not start the helper (${error.code}).`); });
    child.on('close', async code => { clearTimeout(timer); signal?.removeEventListener('abort', stop); await stopping; if (failure) reject(failure); else if (code !== 0) reject(new Error('The helper could not finish. Check sign-in, internet access and account limits; update the helper if needed.')); else resolve(output); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
function completionArgs(settings, system) {
  return ['-p', '--output-format', 'json', '--no-session-persistence', '--tools', '', '--disallowedTools', '*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--system-prompt', system, ...(settings.model ? ['--model', settings.model] : [])];
}
async function complete(settings, prompt, signal) {
  const executable = await resolveClaude(settings.claudePath);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-claude-'));
  try {
    const raw = await run(executable, completionArgs(settings, prompt.system), { input: prompt.user, signal, cwd });
    let data; try { data = JSON.parse(raw); } catch { throw new Error('Claude Code returned an unreadable reply. Update Claude Code and retry.'); }
    if (data.is_error || data.subtype !== 'success' || typeof data.result !== 'string') throw new Error('Claude Code could not complete the request. Check your account limits and selected model.');
    return data.result;
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
}
async function status(settings) {
  const executable = await resolveClaude(settings.claudePath);
  // auth status may exit nonzero when signed out; a failed command is not readiness.
  let data; try { data = JSON.parse(await run(executable, ['auth', 'status', '--json'], { timeout: 15000 })); } catch { return { connected: false, needsLogin: true, models: [], message: 'Claude Code is installed. Sign in, then check again.' }; }
  return { connected: Boolean(data.loggedIn), signedIn: Boolean(data.loggedIn), needsLogin: !data.loggedIn, models: ['sonnet', 'haiku', 'opus'], message: data.loggedIn ? 'Claude Code account found. Run the writing test to verify access.' : 'Sign in to Claude Code to continue.' };
}
module.exports = { resolveClaude, environment, run, completionArgs, complete, status };
