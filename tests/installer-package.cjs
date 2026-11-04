const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
const nsisQuote = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
const powershell = code => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from('$ErrorActionPreference = "Stop"; $ProgressPreference = "SilentlyContinue"; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' + code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') } }).trim();

async function waitFor(check, description) {
  const deadline = Date.now() + 20000;
  do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  throw new Error(description);
}

(async () => {
  assert.equal(process.platform, 'win32', 'This installer test requires Windows.');
  const id = randomUUID(), name = `WRAITER Installer Test ${id.slice(0, 8)}`;
  const directory = path.join(root, 'test-output', `installer-package-${id}`);
  const payload = path.join(directory, 'payload'), output = path.join(directory, 'build');
  const installDirectory = path.join(directory, 'User folder with spaces åäö', name);
  const registryRoot = `Software\\WRAITER-Installer-Package-Test\\${id}`;
  const include = path.join(directory, 'installer-test.nsh');
  const checks = [];
  const reportPath = path.join(root, 'test-output/installer-package-results.json');
  const report = { passed: false, startedAt: new Date().toISOString(), directory, checks, scope: 'Synthetic launch probe and private registry; this is not a fresh PC or a Smart App Control test.' };
  const saveReport = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.mkdir(path.join(payload, 'resources'), { recursive: true });
  await saveReport();
  const source = path.join(directory, 'launch-probe.cs');
  await fs.writeFile(source, `using System; using System.IO; using System.Reflection; using System.Security.Principal;
class LaunchProbe { static void Main(string[] args) {
  bool elevated = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
  File.WriteAllText(Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "launch-marker.txt"), "elevated=" + elevated + "\\n" + string.Join(" ", args));
} }`);
  const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const compiled = spawnSync(compiler, ['/nologo', '/target:winexe', '/platform:anycpu', `/out:${path.join(payload, name + '.exe')}`, source], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.error?.message || compiled.stdout + compiled.stderr);
  const keys = {
    INSTALL_REGISTRY_KEY: registryRoot + '\\Installation', UNINSTALL_REGISTRY_KEY: registryRoot + '\\Uninstall',
    WRAITER_CLASSES_KEY: registryRoot + '\\Classes', WRAITER_CAPABILITIES_KEY: registryRoot + '\\Capabilities',
    WRAITER_ASSOC_STATE_KEY: registryRoot + '\\Installer', WRAITER_REGISTERED_APPS_KEY: registryRoot + '\\RegisteredApplications',
  };
  const privateDefinitions = Object.entries(keys).map(([key, value]) => `!ifdef ${key}\n!undef ${key}\n!endif\n!define ${key} "${nsisQuote(value)}"`).join('\n');
  await fs.writeFile(include, privateDefinitions + `\n!include "${nsisQuote(path.join(root, 'build/installer.nsh'))}"\n`);
  const artifacts = await build({
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), prepackaged: payload, publish: 'never',
    config: {
      appId: `studio.wraiter.installer-test.${id}`, productName: name, forceCodeSigning: false,
      directories: { output }, win: { signExecutable: false },
      nsis: { guid: id, include, artifactName: 'installer-test.exe', shortcutName: name, createDesktopShortcut: false, createStartMenuShortcut: true },
    },
  });
  const installer = artifacts.find(file => path.basename(file) === 'installer-test.exe');
  assert.ok(installer, 'The real electron-builder NSIS installer was produced.');
  report.installer = installer;
  checks.push('The production NSIS wizard and install/uninstall macros build inside an isolated full installer.');
  const run = (file, args) => {
    assert.ok(path.resolve(file).startsWith(directory + path.sep), 'Only test executables may run.');
    const result = spawnSync(file, args, { windowsHide: true, windowsVerbatimArguments: true, timeout: 30000, encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message || result.stderr || `Installer exit ${result.status}`);
  };
  const installedExe = path.join(installDirectory, name + '.exe');
  const uninstaller = path.join(installDirectory, `Uninstall ${name}.exe`);
  const marker = path.join(installDirectory, 'launch-marker.txt');
  const exists = file => fs.access(file).then(() => true, () => false);
  try {
    run(installer, ['/S', '/currentuser', '/D=' + installDirectory]);
    await waitFor(() => exists(installedExe), 'The installer did not extract its application.');
    assert.equal(await fs.readFile(path.join(installDirectory, 'setup-mode.txt'), 'utf8'), 'simple');
    assert.equal(await exists(marker), false, 'Silent installation should not start the app without --force-run.');
    const registered = JSON.parse(powershell(`$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${psQuote(registryRoot + '\\Classes\\studio.wraiter.desktop.Manuscript\\shell\\open\\command')}); try { ConvertTo-Json -InputObject $key.GetValue('') -Compress } finally { $key.Dispose() }`));
    assert.equal(registered, '"' + installedExe + '" "%1"');
    const shortcut = JSON.parse(powershell(`$linkPath = Join-Path ([Environment]::GetFolderPath('Programs')) ${psQuote(name + '.lnk')}; $shell = New-Object -ComObject WScript.Shell; $link = $shell.CreateShortcut($linkPath); [ordered]@{ path = $linkPath; target = $link.TargetPath } | ConvertTo-Json -Compress`));
    assert.equal(shortcut.target, installedExe);
    assert.equal(path.basename(shortcut.path), name + '.lnk');
    checks.push('A per-user installation extracts the app to a path containing spaces and Swedish characters, writes setup mode, creates a uniquely named Start menu shortcut, and registers the exact quoted open command in a private registry.');
    run(installer, ['/S', '--force-run', '/currentuser', '/D=' + installDirectory]);
    await waitFor(() => exists(marker), 'The production post-install launch did not run the installed application.');
    assert.match(await fs.readFile(marker, 'utf8'), /^elevated=False/);
    checks.push('Reinstallation succeeds and the production post-install shell launch starts the installed executable directly, without administrator rights, while retaining the Start menu shortcut.');
    run(uninstaller, ['/S', '/currentuser', '_?=' + installDirectory]);
    await waitFor(async () => !await exists(installedExe), 'Uninstall did not remove the test application.');
    assert.equal(await exists(path.join(installDirectory, 'setup-mode.txt')), false);
    const remaining = powershell(`$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${psQuote(registryRoot + '\\Classes\\studio.wraiter.desktop.Manuscript')}); if ($key) { $key.Dispose(); 'present' } else { 'absent' }`);
    assert.equal(remaining, 'absent');
    assert.equal(await exists(shortcut.path), false);
    checks.push('The generated uninstaller removes the test application, setup mode, task-specific shortcut, and private associations.');
    report.passed = true;
    await saveReport();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = error.message;
    await saveReport();
    throw error;
  } finally {
    if (await exists(installedExe) && await exists(uninstaller)) run(uninstaller, ['/S', '/currentuser', '_?=' + installDirectory]);
    assert.match(registryRoot, /^Software\\WRAITER-Installer-Package-Test\\[a-f0-9-]{36}$/);
    powershell(`[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree(${psQuote(registryRoot)}, $false)`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
