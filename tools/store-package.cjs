const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const xml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const previewIdentity = Object.freeze({ identityName: 'Wraiter.StorePreview', publisher: 'CN=WRAITER Store Preview', publisherDisplayName: 'WRAITER Store Preview', displayName: 'WRAITER Preview', applicationId: 'WRAITER' });

function storeVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Store packages require a stable major.minor.patch application version.');
  const parts = version.split('.').map(Number); parts[0]++;
  if (parts.some(value => !Number.isSafeInteger(value) || value > 65535)) throw new Error('Store version components must fit in 16 bits.');
  // Store requires a positive major and reserves the fourth component for itself.
  return [...parts, 0].join('.');
}

function validateIdentity(value, preview = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provide the Product identity values from Partner Center.');
  const allowed = ['identityName', 'publisher', 'publisherDisplayName', 'displayName', 'applicationId'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('The Store identity file may contain only the documented identity fields.');
  const identity = { displayName: 'WRAITER', applicationId: 'WRAITER', ...value };
  for (const key of allowed) {
    if (typeof identity[key] !== 'string' || !identity[key].trim() || /[\x00-\x1f]/.test(identity[key])) throw new Error(`Invalid Store ${key}.`);
    if (!preview && /COPY_FROM|REPLACE_|StorePreview|Store Preview/i.test(identity[key])) throw new Error('Preview/example identities cannot be used for a Store submission. Copy the real values from Partner Center.');
  }
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity.identityName)) throw new Error('Invalid Package/Identity/Name.');
  if (!/^CN=.+/.test(identity.publisher) || identity.publisher.length > 8192) throw new Error('Package/Identity/Publisher must be the complete CN= value from Partner Center.');
  if (!/^[A-Za-z][A-Za-z0-9.]{0,63}$/.test(identity.applicationId) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(identity.applicationId)) throw new Error('Invalid Application Id.');
  if (identity.displayName.length > 256 || identity.publisherDisplayName.length > 256) throw new Error('Store display names are too long.');
  return identity;
}

function manifest(identity, version) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap uap3 rescap">
 <Identity Name="${xml(identity.identityName)}" Publisher="${xml(identity.publisher)}" Version="${version}" ProcessorArchitecture="x64" />
 <Properties><DisplayName>${xml(identity.displayName)}</DisplayName><PublisherDisplayName>${xml(identity.publisherDisplayName)}</PublisherDisplayName><Description>Desktop writing with optional AI assistance.</Description><Logo>assets\\StoreLogo.png</Logo></Properties>
 <Resources><Resource Language="en-US" /></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
 <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
 <Applications><Application Id="${xml(identity.applicationId)}" Executable="app\\WRAITER.exe" EntryPoint="Windows.FullTrustApplication">
  <uap:VisualElements DisplayName="${xml(identity.displayName)}" Description="Desktop writing with optional AI assistance." BackgroundColor="transparent" Square150x150Logo="assets\\Square150x150Logo.png" Square44x44Logo="assets\\Square44x44Logo.png">
   <uap:DefaultTile Wide310x150Logo="assets\\Wide310x150Logo.png" />
  </uap:VisualElements>
  <Extensions><uap:Extension Category="windows.fileTypeAssociation"><uap3:FileTypeAssociation Name="wraiter" Parameters="&quot;%1&quot;"><uap:DisplayName>WRAITER manuscript</uap:DisplayName><uap:SupportedFileTypes><uap:FileType>.wraiter</uap:FileType></uap:SupportedFileTypes></uap3:FileTypeAssociation></uap:Extension></Extensions>
 </Application></Applications>
</Package>
`;
}

function storePlan(args, version, suppliedIdentity) {
  let preview = false, identityFile;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--preview') preview = true;
    else if (args[index] === '--identity' && args[index + 1] && !args[index + 1].startsWith('--')) identityFile = args[++index];
    else throw new Error('Use --preview or --identity <Store identity JSON file>. Store packaging never publishes.');
  }
  if (preview && identityFile) throw new Error('Use a preview identity or a real Store identity, not both.');
  const identity = validateIdentity(preview ? previewIdentity : suppliedIdentity, preview);
  const packageVersion = storeVersion(version);
  return { preview, identityFile, identity, packageVersion, config: {
    directories: { output: `release/${preview ? 'store-preview' : 'store'}/v${version}` },
    forceCodeSigning: false,
    win: { target: ['dir'], signExecutable: false, azureSignOptions: null, signtoolOptions: null },
    extraMetadata: { wraiterDistribution: 'microsoft-store', wraiterStoreIdentity: identity, wraiterStorePackageVersion: packageVersion },
  } };
}

async function run(executable, args, logFile) {
  const log = logFile ? await fs.open(logFile, 'w') : null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: root, stdio: log ? ['ignore', log.fd, log.fd] : 'inherit', windowsHide: true });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} failed with exit ${code}.${logFile ? ` See ${logFile}.` : ''}`)));
    });
  } finally { await log?.close(); }
}
const runNode = (script, args = []) => run(process.execPath, [script, ...args]);

async function findMakeAppx() {
  if (process.env.WRAITER_MAKEAPPX) {
    if (!path.isAbsolute(process.env.WRAITER_MAKEAPPX)) throw new Error('WRAITER_MAKEAPPX must be an absolute path to the Windows SDK MakeAppx.exe.');
    await fs.access(process.env.WRAITER_MAKEAPPX);
    return process.env.WRAITER_MAKEAPPX;
  }
  const bin = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const versions = (await fs.readdir(bin).catch(() => [])).filter(name => /^\d+\.\d+\.\d+\.\d+$/.test(name)).sort((a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let index = 0; index < 4; index++) if (left[index] !== right[index]) return right[index] - left[index];
    return 0;
  });
  for (const version of versions) {
    const candidate = path.join(bin, version, 'x64', 'makeappx.exe');
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error('Install the Windows SDK with its MSIX packaging tools, or set WRAITER_MAKEAPPX to MakeAppx.exe. See docs/MICROSOFT-STORE.md.');
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Build Store packages on Windows.');
  const args = process.argv.slice(2), pkg = require('../package.json');
  const identityIndex = args.indexOf('--identity');
  const identityFile = identityIndex < 0 ? process.env.WRAITER_STORE_IDENTITY || path.join(root, 'build/store-identity.json') : args[identityIndex + 1];
  const identity = args.includes('--preview') ? undefined : JSON.parse(await fs.readFile(path.resolve(identityFile), 'utf8'));
  const plan = storePlan(args, pkg.version, identity);
  const makeAppx = await findMakeAppx();
  await runNode(path.join(root, 'tools/third-party-notices.cjs'));
  await runNode(path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), ['build']);
  for (const [name] of require('./store-assets.cjs').assets) await fs.access(path.join(root, 'build/appx', name));
  const directory = path.resolve(root, plan.config.directories.output);
  await fs.mkdir(directory, { recursive: true });
  const { build, Platform, Arch } = require('electron-builder');
  await build({ targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64), config: plan.config, publish: 'never' });
  // Use the installed Microsoft SDK rather than electron-builder's legacy AppX kit.
  const layout = await fs.mkdtemp(path.join(directory, 'package-layout-'));
  const artifact = path.join(directory, `WRAITER-${pkg.version}-${plan.preview ? 'Store-Preview' : 'Store'}-x64.msix`);
  try {
    await fs.cp(path.join(directory, 'win-unpacked'), path.join(layout, 'app'), { recursive: true });
    await fs.cp(path.join(root, 'build/appx'), path.join(layout, 'assets'), { recursive: true });
    await fs.writeFile(path.join(layout, 'AppxManifest.xml'), manifest(plan.identity, plan.packageVersion));
    console.log('Packing and validating the MSIX with Microsoft MakeAppx.');
    await run(makeAppx, ['pack', '/d', layout, '/p', artifact, '/o'], path.join(directory, 'MAKEAPPX.log'));
  } finally {
    const resolved = path.resolve(layout);
    if (path.dirname(resolved) !== directory || !path.basename(resolved).startsWith('package-layout-')) throw new Error('Refusing to remove a staging directory outside this Store build.');
    await fs.rm(resolved, { recursive: true, force: true });
  }
  const report = await require('./verify-store-package.cjs').verifyStorePackage(artifact, { identity: plan.identity, packageVersion: plan.packageVersion, preview: plan.preview });
  report.packagingTool = makeAppx;
  await fs.writeFile(path.join(directory, 'STORE-PACKAGE-RESULTS.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${plan.preview ? 'PREVIEW ONLY: replace its identity before submitting.' : 'Store upload package: Microsoft signs it after certification.'}\n${artifact}`);
}

module.exports = { storeVersion, validateIdentity, manifest, storePlan, previewIdentity, findMakeAppx };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
