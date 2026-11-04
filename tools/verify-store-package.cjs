const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');

async function verifyStorePackage(file, expected) {
  const buffer = await fs.readFile(file), zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const required = ['AppxManifest.xml', 'AppxBlockMap.xml', '[Content_Types].xml', 'app/WRAITER.exe', 'app/resources/app.asar', 'app/LICENSE', 'app/THIRD-PARTY-NOTICES.md', ...require('./store-assets.cjs').assets.map(([name]) => 'assets/' + name)];
  for (const name of required) if (!zip.file(name)) throw new Error(`Store package is missing ${name}.`);
  const text = await zip.file('AppxManifest.xml').async('string');
  const { manifest } = require('./store-package.cjs');
  if (text.replaceAll('\r\n', '\n').trim() !== manifest(expected.identity, expected.packageVersion).trim()) throw new Error('The packaged Store manifest does not match the intended identity, version and capabilities.');
  const entries = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  if (entries.some(name => /(?:^|\/)(?:Uninstall[^/]*\.exe|setup-mode\.txt)$/i.test(name))) throw new Error('Store packages must not contain the NSIS installer or its setup state.');
  if (entries.some(name => name.split('/').includes('..') || name.startsWith('/') || name.includes('\\'))) throw new Error('Store package contains an unsafe archive path.');
  const expectedAssets = require('./store-assets.cjs').assets;
  if (entries.filter(name => name.startsWith('assets/')).some(name => !expectedAssets.some(([asset]) => name === 'assets/' + asset))) throw new Error('Store package includes unexpected/default logo assets.');
  for (const [name, width, height] of expectedAssets) {
    const png = await zip.file('assets/' + name).async('nodebuffer');
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error(`Invalid Store logo dimensions: ${name}.`);
  }
  const asar = require('@electron/asar');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-store-verify-'));
  try {
    const archivePath = path.join(temporary, 'app.asar');
    await fs.writeFile(archivePath, await zip.file('app/resources/app.asar').async('nodebuffer'));
    const appMetadata = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'));
    if (appMetadata.wraiterDistribution !== 'microsoft-store' || appMetadata.wraiterStorePackageVersion !== expected.packageVersion) throw new Error('The embedded app has an incorrect Store runtime marker/version.');
    for (const [key, value] of Object.entries(expected.identity)) if (appMetadata.wraiterStoreIdentity?.[key] !== value) throw new Error(`Embedded app has an incorrect Store ${key}.`);
    const frontend = asar.listPackage(archivePath).map(name => name.replaceAll('\\', '/')).find(name => /^\/dist\/assets\/index-[^/]+\.js$/.test(name));
    if (!frontend) throw new Error('The app frontend is missing.');
    const code = asar.extractFile(archivePath, path.normalize(frontend.slice(1))).toString('utf8');
    if (!code.includes('Your writing stays on your computer') || !code.includes('Privacy and AI data') || !code.includes('Report an AI concern') || !code.includes('carl.1224@outlook.com')) throw new Error('The embedded frontend is missing the privacy policy or AI reporting contact.');
  } finally {
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wraiter-store-verify-')) throw new Error('Refusing to remove an unexpected verification directory.');
    await fs.rm(resolved, { recursive: true, force: true });
  }
  const report = { passed: true, file: path.resolve(file), sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length, packageVersion: expected.packageVersion, identity: expected.identity, preview: expected.preview, signed: Boolean(zip.file('AppxSignature.p7x')), fileCount: entries.length, checks: ['Package CRCs and required payload files verified.', 'Exact identity/version manifest, x64 desktop target, runFullTrust and quoted .wraiter activation verified.', 'Embedded app has the matching Store identity/version and privacy policy; package contains no NSIS uninstall/setup state.', 'Branded logo PNGs have the required dimensions; no default Store logos are included.'], limits: ['Package has not been installed under Windows package identity or tested with the Windows App Certification Kit.', 'Microsoft Store review and clean-PC deployment remain required.'] };
  if (expected.preview) report.limits.push('Preview publisher and identity are deliberately synthetic and cannot be submitted.');
  return report;
}

module.exports = { verifyStorePackage };
if (require.main === module) (async () => {
  const file = process.argv[2]; if (!file) throw new Error('Specify the .msix file to inspect.');
  const report = JSON.parse(await fs.readFile(path.join(path.dirname(file), 'STORE-PACKAGE-RESULTS.json'), 'utf8'));
  console.log(JSON.stringify(await verifyStorePackage(file, report), null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
