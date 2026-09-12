const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { atomicWrite } = require('./core.cjs');

const RELEASES = 'https://api.github.com/repos/ollama/ollama/releases/latest';
function trustedDownload(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && ['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
}
async function officialFetch(url, init = {}, redirects = 0) {
  if (!trustedDownload(url) || redirects > 5) throw new Error('Unexpected runtime download address.');
  const response = await fetch(url, { ...init, redirect: 'manual', headers: { 'User-Agent': 'WRAITER-local-models', ...init.headers } });
  if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); return officialFetch(new URL(response.headers.get('location'), url).href, init, redirects + 1); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Runtime download returned HTTP ${response.status}. Try again later.`); }
  return response;
}
function runtimeAssets(release, arch = process.arch, flavor = 'standard') {
  if (!/^v\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.]+)?$/.test(release?.tag_name || '')) throw new Error('Invalid Ollama release information.');
  if (!['x64', 'arm64'].includes(arch) || !['standard', 'amd'].includes(flavor) || (arch === 'arm64' && flavor !== 'standard')) throw new Error('This runtime package is not available for this architecture.');
  const names = [`ollama-windows-${arch === 'arm64' ? 'arm64' : 'amd64'}.zip`, ...(flavor === 'amd' ? ['ollama-windows-amd64-rocm.zip'] : [])];
  return names.map(name => {
    const item = release.assets?.find(item => item.name === name);
    const expected = `https://github.com/ollama/ollama/releases/download/${release.tag_name}/${name}`;
    if (!item || item.browser_download_url !== expected || !/^sha256:[a-f0-9]{64}$/.test(item.digest || '') || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 6 * 1024 ** 3) throw new Error('The official runtime package is missing a verifiable SHA-256 digest.');
    return { name, url: expected, size: item.size, sha256: item.digest.slice(7) };
  });
}
async function releaseInfo(flavor = 'standard') {
  if (process.platform !== 'win32') throw new Error('Managed runtime downloads are currently available on Windows.');
  const response = await officialFetch(RELEASES, { signal: AbortSignal.timeout(20000) });
  const text = await response.text(); if (text.length > 2 * 1024 ** 2) throw new Error('The release catalog is too large.');
  const release = JSON.parse(text), assets = runtimeAssets(release, process.arch, flavor);
  return { version: release.tag_name, flavor, assets, bytes: assets.reduce((total, item) => total + item.size, 0) };
}
async function downloadVerified(asset, destination, signal, onProgress = () => {}, fetcher = officialFetch) {
  const response = await fetcher(asset.url, { signal });
  const file = await fs.open(destination, 'wx'), digest = crypto.createHash('sha256'); let completed = 0;
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted(); completed += chunk.length;
      if (completed > asset.size) throw new Error('The runtime download exceeded its expected size.');
      digest.update(chunk); await file.writeFile(chunk); onProgress(completed, asset.size);
    }
    if (completed !== asset.size || digest.digest('hex') !== asset.sha256) throw new Error('Runtime checksum verification failed. The download will not be installed.');
    await file.sync();
  } finally { await file.close(); }
}
function childTask(executable, args, { env = process.env, signal, timeout = 180000, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '', stopped = false;
    const stop = () => {
      if (stopped || child.exitCode != null) return; stopped = true;
      if (process.platform === 'win32' && child.pid) { const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); }
      else child.kill();
    };
    const timer = setTimeout(stop, timeout); signal?.addEventListener('abort', stop, { once: true });
    const read = data => { output = (output + data.toString()).slice(-6000); onOutput?.(data.toString()); };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.once('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(error); });
    child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', stop); if (signal?.aborted) reject(new Error('Operation cancelled.')); else if (code !== 0 || stopped) reject(new Error(output.trim() || 'The runtime operation did not complete.')); else resolve(output.trim()); });
    if (signal?.aborted) stop();
  });
}
// Validate every ZIP entry before extraction, including drive paths, traversal,
// alternate data streams and symlinks. All generated paths stay under staging.
const EXTRACT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($env:WRAITER_EXTRACT_ROOT).TrimEnd('\\') + '\\'
$archive = [IO.Compression.ZipFile]::OpenRead($env:WRAITER_EXTRACT_ZIP)
try {
  $total = 0L
  if ($archive.Entries.Count -gt 50000) { throw 'Too many runtime files.' }
  foreach ($entry in $archive.Entries) {
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $entry.FullName))
    if (!$target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.Contains(':') -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'Unsafe runtime archive path.' }
    $total += $entry.Length
    if ($total -gt 20GB) { throw 'Runtime archive exceeds extraction limit.' }
  }
  foreach ($entry in $archive.Entries) {
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $entry.FullName))
    if (!$entry.Name) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
} finally { $archive.Dispose() }
`;
async function extractRuntime(archive, directory, signal) {
  await fs.mkdir(directory, { recursive: true });
  return childTask('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(EXTRACT_SCRIPT, 'utf16le').toString('base64')], { env: { ...process.env, WRAITER_EXTRACT_ROOT: directory, WRAITER_EXTRACT_ZIP: archive }, signal, timeout: 10 * 60 * 1000 });
}
async function installRuntime(root, info, signal, onProgress = () => {}) {
  const validated = runtimeAssets({ tag_name: info.version, assets: info.assets.map(item => ({ name: item.name, size: item.size, digest: 'sha256:' + item.sha256, browser_download_url: item.url })) }, process.arch, info.flavor);
  const runtimeParent = path.resolve(root, 'runtimes'); await fs.mkdir(runtimeParent, { recursive: true });
  const realParent = await fs.realpath(runtimeParent), directory = await fs.mkdtemp(path.join(realParent, `${info.version}-`)), engine = path.join(directory, 'engine');
  try {
  for (const asset of validated) {
    signal?.throwIfAborted(); const archive = path.join(directory, asset.name);
    await downloadVerified(asset, archive, signal, (completed, total) => onProgress({ phase: 'downloading', message: `Downloading ${asset.name}`, completed, total }));
    onProgress({ phase: 'extracting', message: 'Verified download. Preparing runtime…' });
    await extractRuntime(archive, engine, signal);
    await fs.unlink(archive); // Exact newly generated archive, never a user path.
  }
  signal?.throwIfAborted(); const executable = path.join(engine, 'ollama.exe');
  if (!(await fs.stat(executable)).isFile()) throw new Error('The downloaded runtime did not contain ollama.exe.');
  const record = { executable, version: info.version, flavor: info.flavor, installedAt: new Date().toISOString() };
  await atomicWrite(path.join(root, 'runtime.json'), JSON.stringify(record));
  return record;
  } catch (error) {
    // Only remove this installation's newly allocated staging directory. Resolve
    // both targets before recursive deletion; preserve the previous active engine.
    const target = await fs.realpath(directory).catch(() => null);
    if (target && path.dirname(target) === realParent && path.basename(target).startsWith(`${info.version}-`)) await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
module.exports = { releaseInfo, runtimeAssets, officialFetch, trustedDownload, downloadVerified, extractRuntime, installRuntime, childTask };
