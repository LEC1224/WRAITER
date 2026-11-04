const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function packagingPlan(args, version, signing = {}, env = process.env) {
  let preview = false, output;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--unsigned-preview') preview = true;
    else if (argument === '--output') {
      output = args[++index];
      if (!output || output.startsWith('--')) throw new Error('--output requires a directory.');
    } else if (argument.startsWith('--config.directories.output=')) output = argument.slice('--config.directories.output='.length);
    else if (argument === '--publish' && args[++index] === 'never') { /* Local packaging only. */ }
    else throw new Error(`Unsupported packaging option: ${argument}. Use --output, --unsigned-preview, or --publish never.`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid release version.');
  if (output === '') throw new Error('The output directory cannot be empty.');
  if (Object.keys(signing).some(key => key !== 'win')) throw new Error('Signing configuration may contain only the win signing options.');
  const win = signing.win || {};
  const allowed = ['azureSignOptions', 'signtoolOptions'];
  if (!win || typeof win !== 'object' || Array.isArray(win) || Object.keys(win).some(key => !allowed.includes(key))) throw new Error('Only azureSignOptions or signtoolOptions are allowed in the signing configuration.');
  if (win.azureSignOptions && win.signtoolOptions) throw new Error('Choose one signing provider.');
  if (!preview && !win.azureSignOptions && !win.signtoolOptions?.certificateSha1 && !win.signtoolOptions?.certificateSubjectName && !win.signtoolOptions?.sign && !env.WIN_CSC_LINK && !env.CSC_LINK) {
    throw new Error('A trusted Windows signing identity is required. Configure WRAITER_SIGNING_CONFIG or WIN_CSC_LINK; see docs/WINDOWS-DISTRIBUTION.md. For local unsigned testing, use npm run package:preview.');
  }
  return {
    preview,
    config: {
      directories: { output: output || `release/${preview ? 'unsigned-preview' : 'signed'}/v${version}` },
      forceCodeSigning: !preview,
      win: preview
        ? { signExecutable: false, signExts: ['.exe', '.dll'], azureSignOptions: null, signtoolOptions: null }
        : { ...win, signExecutable: true, signExts: ['.exe', '.dll'] },
    },
  };
}

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} failed with exit code ${code}.`)));
  });
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Package Windows releases on Windows, so their signatures can be verified.');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const signing = process.env.WRAITER_SIGNING_CONFIG
    ? JSON.parse(await fs.readFile(path.resolve(process.env.WRAITER_SIGNING_CONFIG), 'utf8')) : {};
  const plan = packagingPlan(process.argv.slice(2), pkg.version, signing);
  await runNode(path.join(root, 'tools/third-party-notices.cjs'));
  await runNode(path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), ['build']);
  const { build, Platform, Arch } = require('electron-builder');
  const artifacts = await build({ targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64), config: plan.config, publish: 'never' });
  const directory = path.resolve(root, plan.config.directories.output);
  if (plan.preview) {
    console.log(`UNSIGNED PREVIEW: ${directory}. Windows application-control policies may refuse this build.`);
    return;
  }
  await require('./verify-windows-release.cjs').verifyRelease(directory, pkg.version);
  const checksumFiles = artifacts.filter(file => file.endsWith('.exe'));
  const { createHash } = require('node:crypto');
  const checksums = await Promise.all(checksumFiles.map(async file => `${createHash('sha256').update(await fs.readFile(file)).digest('hex')}  ${path.basename(file)}`));
  await fs.writeFile(path.join(directory, `WRAITER-${pkg.version}-SHA256SUMS.txt`), checksums.join('\n') + '\n');
  console.log(`Verified signed Windows release: ${directory}`);
}

module.exports = { packagingPlan };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
