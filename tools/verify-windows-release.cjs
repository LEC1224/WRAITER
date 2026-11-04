const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function validateSignatures(signatures, version) {
  const required = [`WRAITER-${version}-Setup.exe`, `WRAITER-${version}-Windows.exe`, 'win-unpacked/WRAITER.exe'];
  const seen = new Set(signatures.map(item => item.file.replaceAll('\\', '/')));
  const problems = required.filter(file => !seen.has(file)).map(file => `${file}: missing`);
  for (const item of signatures) {
    if (item.status !== 'Valid') problems.push(`${item.file}: ${item.status}`);
    else if (!item.signer) problems.push(`${item.file}: missing signer`);
    else if (!item.timestamp) problems.push(`${item.file}: missing signing timestamp`);
  }
  if (problems.length) throw new Error('Windows release signature verification failed:\n' + problems.join('\n'));
}

async function verifyRelease(directory, version) {
  if (process.platform !== 'win32') throw new Error('Windows signature verification requires Windows.');
  directory = path.resolve(directory);
  const powershell = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$releaseRoot = $env:WRAITER_VERIFY_DIRECTORY
$releaseVersion = $env:WRAITER_VERIFY_VERSION
$targets = @((Join-Path $releaseRoot ("WRAITER-" + $releaseVersion + "-Setup.exe")), (Join-Path $releaseRoot ("WRAITER-" + $releaseVersion + "-Windows.exe")))
$runtimeRoot = Join-Path $releaseRoot 'win-unpacked'
if (Test-Path -LiteralPath $runtimeRoot) { $targets += @(Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll' } | Select-Object -ExpandProperty FullName) }
$results = @(foreach ($target in $targets) {
  $relative = $target.Substring($releaseRoot.Length).TrimStart('\\').Replace('\\', '/')
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { [ordered]@{ file = $relative; status = 'Missing'; signer = $null; timestamp = $null }; continue }
  $signature = Get-AuthenticodeSignature -LiteralPath $target
  [ordered]@{ file = $relative; status = $signature.Status.ToString(); signer = $signature.SignerCertificate.Subject; timestamp = $signature.TimeStamperCertificate.Subject }
})
ConvertTo-Json -InputObject $results -Depth 3 -Compress
`;
  const output = await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(powershell, 'utf16le').toString('base64')], {
      env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules'), WRAITER_VERIFY_DIRECTORY: directory, WRAITER_VERIFY_VERSION: version }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || 'Windows signature inspection failed.')));
  });
  const signatures = JSON.parse(output);
  const report = { version, directory, signatures, verified: false };
  try { validateSignatures(signatures, version); report.verified = true; }
  finally { await fs.writeFile(path.join(directory, 'WINDOWS-SIGNATURES.json'), JSON.stringify(report, null, 2) + '\n'); }
  return report;
}

module.exports = { validateSignatures, verifyRelease };
if (require.main === module) {
  (async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const report = await verifyRelease(process.argv[2] || path.join(root, `release/signed/v${pkg.version}`), pkg.version);
    console.log(`Verified ${report.signatures.length} signed Windows binaries.`);
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
