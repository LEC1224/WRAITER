const { run, resolveClaude } = require('./claude-bridge.cjs');
const { resolveCodex } = require('./codex-bridge.cjs');
const providers = require('./providers.cjs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const HELP = { codex: 'https://learn.chatgpt.com/docs/codex/cli', claude: 'https://code.claude.com/docs/en/setup' };
function provider(value) { if (!Object.hasOwn(HELP, value)) throw new Error('Choose Codex or Claude Code.'); return value; }
function installScript(value) {
  provider(value);
  const url = value === 'codex' ? 'https://chatgpt.com/codex/install.ps1' : 'https://claude.ai/install.ps1';
  return `$ErrorActionPreference = 'Stop'; $env:CODEX_NON_INTERACTIVE = '1'; $wraiterDownload = (Invoke-WebRequest -UseBasicParsing '${url}').Content; if ($wraiterDownload -is [byte[]]) { $wraiterDownload = [Text.Encoding]::UTF8.GetString($wraiterDownload) }; & ([scriptblock]::Create($wraiterDownload)); if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
}
function registerSetup({ ipcMain, app, dialog, shell, win, draftConnection }) {
  let job;
  ipcMain.handle('setup:help', (_event, value) => shell.openExternal(HELP[provider(value)]));
  ipcMain.handle('setup:cancel', () => { job?.abort(); return true; });
  ipcMain.handle('setup:install', async (_event, value) => {
    provider(value);
    if (process.platform !== 'win32') throw new Error('Automatic installation is available on Windows. Open the official installation guide.');
    if (job) throw new Error('Another setup operation is running.');
    const controller = new AbortController(); job = controller;
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(installScript(value), 'utf16le').toString('base64')], { signal: controller.signal, timeout: 600000 });
      await (value === 'codex' ? resolveCodex() : resolveClaude());
      return { message: 'Installed. Continue by checking your account.' };
    } finally { job = null; }
  });
  ipcMain.handle('setup:choose', async (_event, value) => {
    provider(value);
    const result = await dialog.showOpenDialog(win(), { title: `Choose ${value === 'codex' ? 'codex.exe' : 'claude.exe'}`, properties: ['openFile'], filters: [{ name: 'Application', extensions: ['exe'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('setup:claude-login', async (_event, draft) => {
    const executable = await resolveClaude(draftConnection(draft).claudePath);
    // The provider owns browser authentication and any one-time code entry.
    // A visible console is intentional for this interactive sign-in operation.
    const command = `& '${executable.replace(/'/g, "''")}' auth login; Read-Host 'You can close this window and return to WRAITER'`;
    const child = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd: os.tmpdir(), env: require('./claude-bridge.cjs').environment(), windowsHide: false, detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    return { message: 'Follow the sign-in window, then return here and check your account.' };
  });
  ipcMain.handle('setup:test', async (_event, draft) => {
    const settings = draftConnection(draft); provider(settings.provider);
    if (job) throw new Error('Another setup operation is running.');
    const controller = new AbortController(); job = controller;
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const text = await providers.generate(settings, '', { mode: 'continue', before: 'The morning sun', words: 8, references: [], history: [] }, controller.signal);
      return { ready: true, message: 'Writing test passed. Your AI connection is ready.', sample: text };
    } finally { clearTimeout(timer); job = null; }
  });
  app.on('before-quit', () => job?.abort());
}
module.exports = { registerSetup, installScript, provider };
