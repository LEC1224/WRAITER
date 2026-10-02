const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
const nsisQuote = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
const powershell = code => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference = "Stop"; ' + code], { encoding: 'utf8', windowsHide: true }).trim();

(async () => {
  assert.equal(process.platform, 'win32', 'This installer test requires Windows.');
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'test-output', 'installer-associations-'));
  const installDirectory = path.join(directory, 'Install folder with spaces'), executable = path.join(directory, 'association-test.exe');
  const registryRoot = 'Software\\WRAITER-Installer-Test\\' + randomUUID();
  const classes = registryRoot + '\\Classes', capabilities = registryRoot + '\\Capabilities', state = registryRoot + '\\Installer', registered = registryRoot + '\\RegisteredApplications';
  const progId = 'studio.wraiter.desktop.Manuscript', checks = [];
  const compiler = process.env.WRAITER_MAKENSIS || powershell('$compiler = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "electron-builder\\Cache") -Recurse -Filter makensis.exe | Where-Object { $_.Directory.Name -eq "Bin" } | Select-Object -First 1; if (-not $compiler) { throw "Build a Windows package first or set WRAITER_MAKENSIS." }; $compiler.FullName');
  const script = [
    '!include "MUI2.nsh"', '!include "FileFunc.nsh"',
    '!define SHELL_CONTEXT HKCU', '!define PRODUCT_NAME "WRAITER association test"', '!define APP_EXECUTABLE_FILENAME "WRAITER.exe"',
    `!define WRAITER_CLASSES_KEY "${classes}"`, `!define WRAITER_CAPABILITIES_KEY "${capabilities}"`,
    `!define WRAITER_ASSOC_STATE_KEY "${state}"`, `!define WRAITER_REGISTERED_APPS_KEY "${registered}"`,
    'Name "WRAITER association test"', `OutFile "${nsisQuote(executable)}"`, `InstallDir "${nsisQuote(installDirectory)}"`,
    'RequestExecutionLevel user', 'Var TestMode', 'Var TestUpdated',
    '!macro _TestUpdated _a _b _t _f', '  StrCmp $TestUpdated "1" `${_t}` `${_f}`', '!macroend', '!define isUpdated \'"" TestUpdated ""\'',
    `!include "${nsisQuote(path.join(root, 'build', 'installer.nsh'))}"`,
    '!insertmacro customWelcomePage', '!insertmacro customPageAfterChangeDir', '!insertmacro MUI_PAGE_INSTFILES', '!insertmacro MUI_LANGUAGE "English"',
    'Function .onInit', '  SetRegView 64', '  StrCpy $TestUpdated "0"', '  !insertmacro customInit',
    '  ${GetParameters} $0', '  ${GetOptions} $0 "/MODE=" $TestMode', 'FunctionEnd',
    'Section', '  CreateDirectory "$INSTDIR"', '  SetOutPath "$INSTDIR"',
    '  ${If} $TestMode == "checked"', '    StrCpy $WraiterAssociateFiles ${BST_CHECKED}', '  ${EndIf}',
    '  ${If} $TestMode == "unchecked"', '    StrCpy $WraiterAssociateFiles ${BST_UNCHECKED}', '  ${EndIf}',
    '  ${If} $TestMode == "install"', '  ${OrIf} $TestMode == "checked"', '  ${OrIf} $TestMode == "unchecked"', '    !insertmacro customInstall',
    '  ${ElseIf} $TestMode == "uninstall"', '    !insertmacro customUnInstall',
    '  ${ElseIf} $TestMode == "upgrade-uninstall"', '    StrCpy $TestUpdated "1"', '    !insertmacro customUnInstall', '  ${EndIf}',
    '  FileOpen $0 "$INSTDIR\\choice.txt" w', '  FileWrite $0 "$WraiterAssociateFiles"', '  FileClose $0', 'SectionEnd', ''
  ].join('\n');
  const scriptPath = path.join(directory, 'association-test.nsi'); await fs.writeFile(scriptPath, script);
  const compiled = spawnSync(compiler, ['-V2', scriptPath], { encoding: 'utf8', windowsHide: true });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  checks.push('The real installer pages, initialization, install, and uninstall macros compile in NSIS.');
  const run = async mode => {
    const result = spawnSync(executable, ['/S', '/MODE=' + mode], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    return fs.readFile(path.join(installDirectory, 'choice.txt'), 'utf8');
  };
  const read = () => JSON.parse(powershell([
    `function Read-TestValue($relative, $name = '') { $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${psQuote(registryRoot)} + '\\' + $relative); if ($null -eq $key) { return $null }; try { return $key.GetValue($name) } finally { $key.Dispose() } }`,
    '$data = [ordered]@{',
    "default = (Read-TestValue 'Classes\\.wraiter'); description = (Read-TestValue 'Classes\\" + progId + "');",
    "command = (Read-TestValue 'Classes\\" + progId + "\\shell\\open\\command'); icon = (Read-TestValue 'Classes\\" + progId + "\\DefaultIcon');",
    "friendly = (Read-TestValue 'Classes\\Applications\\WRAITER.exe' 'FriendlyAppName'); applicationCommand = (Read-TestValue 'Classes\\Applications\\WRAITER.exe\\shell\\open\\command');",
    "supported = (Read-TestValue 'Classes\\Applications\\WRAITER.exe\\SupportedTypes' '.wraiter'); capability = (Read-TestValue 'Capabilities\\FileAssociations' '.wraiter');",
    "registered = (Read-TestValue 'RegisteredApplications' 'WRAITER'); previous = (Read-TestValue 'Installer' 'PreviousProgId'); choice = (Read-TestValue 'Installer' 'AssociateFiles');",
    "otherProgId = (Read-TestValue 'Classes\\Other.Writer'); otherOpenWith = (Read-TestValue 'Classes\\.wraiter\\OpenWithProgids' 'Other.Writer')",
    '};',
    `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${psQuote(classes + '\\.wraiter\\OpenWithProgids')});`,
    `if ($null -ne $key) { try { if ($key.GetValueNames() -contains ${psQuote(progId)}) { $data.openWithKind = $key.GetValueKind(${psQuote(progId)}).ToString() } } finally { $key.Dispose() } };`,
    '$data | ConvertTo-Json -Compress'
  ].join('\n')));
  const seedOther = (name, withOpenWith = false) => powershell([
    `$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${psQuote(classes + '\\.wraiter')}); $key.SetValue('', ${psQuote(name)}); $key.Dispose();`,
    withOpenWith ? `$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${psQuote(classes + '\\Other.Writer')}); $key.SetValue('', 'Other application'); $key.Dispose(); $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${psQuote(classes + '\\.wraiter\\OpenWithProgids')}); $key.SetValue('Other.Writer', 'keep'); $key.Dispose();` : ''
  ].join('\n'));
  try {
    assert.equal(await run('default'), '1'); assert.equal(read().default, null);
    checks.push('A fresh installation starts with file association checked, before writing registry entries.');
    await seedOther('Other.Writer', true);
    await run('install'); let values = read();
    const command = '"' + path.join(installDirectory, 'WRAITER.exe') + '" "%1"';
    assert.equal(values.default, progId); assert.equal(values.description, 'WRAITER manuscript');
    assert.equal(values.command, command); assert.equal(values.applicationCommand, command);
    assert.equal(values.icon, '"' + path.join(installDirectory, 'WRAITER.exe') + '",0');
    assert.equal(values.friendly, 'WRAITER'); assert.equal(values.supported, ''); assert.equal(values.capability, progId);
    assert.equal(values.registered, capabilities); assert.equal(values.openWithKind, 'None'); assert.equal(values.previous, 'Other.Writer');
    checks.push('Checked installation registers the icon, quoted open commands, Open with, and Default Apps capabilities.');
    await run('install'); assert.equal(read().previous, 'Other.Writer');
    await run('upgrade-uninstall'); assert.equal(read().default, progId); assert.equal(read().choice, 1);
    checks.push('Reinstallation and upgrade uninstallation retain the original default and checkbox preference.');
    await run('unchecked'); values = read();
    assert.equal(values.default, 'Other.Writer'); assert.equal(values.command, null); assert.equal(values.applicationCommand, null);
    assert.equal(values.capability, null); assert.equal(values.registered, null); assert.equal(values.otherProgId, 'Other application'); assert.equal(values.otherOpenWith, 'keep');
    assert.equal(await run('default'), '0');
    checks.push('Opting out removes WRAITER registration, restores the previous default, and survives silent upgrades.');
    await run('checked'); await run('uninstall'); assert.equal(read().default, 'Other.Writer'); assert.equal(read().choice, null);
    await run('checked'); await seedOther('Another.Writer'); await run('uninstall'); values = read();
    assert.equal(values.default, 'Another.Writer'); assert.equal(values.command, null); assert.equal(values.otherOpenWith, 'keep');
    checks.push('Uninstall cleans WRAITER entries while preserving other applications and a subsequently changed default.');
    const report = { passed: true, checks, directory, executable };
    await fs.writeFile(path.join(root, 'test-output', 'installer-associations-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    assert.match(registryRoot, /^Software\\WRAITER-Installer-Test\\[a-f0-9-]{36}$/);
    powershell(`[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree(${psQuote(registryRoot)}, $false)`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
