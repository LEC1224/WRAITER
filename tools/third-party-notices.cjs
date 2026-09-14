// Collect installed notices for the libraries that can enter the application bundle.
// Build tools and Electron's separately distributed notices are excluded here.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildOnly = new Set(['@vitejs/plugin-react', 'electron', 'electron-builder', 'playwright', 'vite']);
const visited = new Map();

function locate(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === path.dirname(dir)) return null;
  }
}

function visit(name, from, optional = false) {
  const dir = locate(name, from);
  if (!dir) { if (optional) return; throw new Error(`Missing installed dependency: ${name}`); }
  if (visited.has(dir)) return;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  visited.set(dir, manifest);
  for (const child of Object.keys(manifest.dependencies || {})) visit(child, dir);
  for (const child of Object.keys(manifest.optionalDependencies || {})) visit(child, dir, true);
  for (const child of Object.keys(manifest.peerDependencies || {})) visit(child, dir, Boolean(manifest.peerDependenciesMeta?.[child]?.optional));
}

for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort()) if (!buildOnly.has(name)) visit(name, root);
const output = ['# Third-party notices', '', 'Generated with `npm run notices` from the installed, locked dependency tree. These notices cover application libraries and their dependencies; some transitive libraries may be removed by bundling. Original license texts are retained below.', '', 'WRAITER itself uses the MIT license in `LICENSE`. Electron and Chromium notices are also shipped beside the executable as `LICENSE.electron.txt` and `LICENSES.chromium.html`. Optional AI helpers, runtimes and models have their own licenses.', ''];
const missing = [];
for (const [dir, manifest] of [...visited].sort((a, b) => `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`))) {
  const names = fs.readdirSync(dir).filter(name => /^(licen[sc]e|copying|copyright|notice)(?:[.-]|$)/i.test(name) && fs.statSync(path.join(dir, name)).isFile()).sort();
  const notices = names.map(name => [name, fs.readFileSync(path.join(dir, name), 'utf8')]);
  if (!notices.length) {
    for (const name of fs.readdirSync(dir).filter(name => /^readme(?:\.|$)/i.test(name))) {
      const readme = fs.readFileSync(path.join(dir, name), 'utf8');
      const section = readme.match(/^#{1,6}\s+licen[sc]e\s*\r?\n[\s\S]*/im)?.[0];
      if (section && /Permission is hereby granted/.test(section)) notices.push([`${name} — license section`, section]);
    }
  }
  if (!notices.length) {
    const supplement = path.join(root, 'docs', 'licenses', `${manifest.name.replaceAll('/', '-')}-${manifest.version}.txt`);
    if (fs.existsSync(supplement)) notices.push(['Supplemental notice for package without a license file', fs.readFileSync(supplement, 'utf8')]);
  }
  if (!notices.length) { missing.push(`${manifest.name}@${manifest.version}`); continue; }
  output.push(`## ${manifest.name} ${manifest.version}`, '', `Declared license: ${typeof manifest.license === 'string' ? manifest.license : JSON.stringify(manifest.license || manifest.licenses || 'See text below')}`, '');
  for (const [name, content] of notices) output.push(`### ${name}`, '', '````text', content.replace(/\r\n/g, '\n').trim(), '````', '');
}
if (missing.length) throw new Error(`Review packages missing license files: ${missing.join(', ')}`);
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), output.join('\n'));
console.log(`Collected notices for ${visited.size} installed application dependencies.`);
