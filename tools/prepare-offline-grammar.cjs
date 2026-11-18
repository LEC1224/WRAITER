// Build-time preparation only. The installed checker uses these pinned files
// locally and never downloads a runtime, dictionaries, rules or manuscript data.
const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const tar = require('tar');
const root = path.resolve(__dirname, '..');
const recipe = require('./local-grammar/dependencies.json');
const hunspellChecksums = require('./local-grammar/hunspell-checksums.json');
const base = path.join(root, 'build', 'offline-grammar');
const cache = path.join(base, 'cache');
const payload = path.join(base, 'payload');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function download(url, redirects = 0) {
  if (redirects > 8 || !url.startsWith('https://')) throw new Error('Invalid dependency download redirect.');
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'WRAITER-local-grammar-build' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        return resolve(download(new URL(response.headers.location, url).href, redirects + 1));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Dependency download failed (${response.statusCode}).`)); }
      const chunks = []; let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > 180 * 1024 * 1024) request.destroy(new Error('Dependency download is too large.')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error('Dependency download timed out.')));
    request.on('error', reject);
  });
}

function validateFile(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._+-]+$/.test(name) || name === '.' || name === '..') throw new Error('Invalid dependency filename.');
}
async function cached(spec) {
  validateFile(spec.file);
  const file = path.join(cache, spec.file);
  let data = await fs.readFile(file).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!data || hash(data) !== spec.sha256) {
    console.log(`Fetching offline grammar dependency ${spec.file}`);
    data = await download(spec.url);
    if (hash(data) !== spec.sha256) throw new Error(`Checksum mismatch for ${spec.file}.`);
    await fs.writeFile(file, data);
  }
  return data;
}
function mavenUrl(item) {
  for (const field of ['group', 'artifact', 'version']) if (typeof item[field] !== 'string' || !/^[A-Za-z0-9._+-]+$/.test(item[field])) throw new Error('Invalid Maven coordinate.');
  if (item.file !== `${item.artifact}-${item.version}.jar`) throw new Error('The Maven filename does not match its coordinate.');
  return `https://repo.maven.apache.org/maven2/${item.group.replaceAll('.', '/')}/${item.artifact}/${item.version}/${item.file}`;
}
async function pool(items, concurrency, action) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const item = items[next++]; await action(item); }
  }));
}
async function writeInside(directory, name, data) {
  const target = path.resolve(directory, name);
  if (!target.startsWith(path.resolve(directory) + path.sep)) throw new Error('Unsafe dependency archive path.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const previous = await fs.readFile(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (previous && previous.equals(data)) return;
  await fs.writeFile(target, data);
}
async function copyIfChanged(source, target) {
  const data = await fs.readFile(source);
  const previous = await fs.readFile(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!previous || !previous.equals(data)) await fs.writeFile(target, data);
}
async function verifyHunspellMembers(directory, files) {
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length < 1) throw new Error('Invalid dictionary checksum manifest.');
  for (const [name, digest] of Object.entries(files)) {
    validateFile(name);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid dictionary member checksum.');
    const data = await fs.readFile(path.join(directory, name));
    if (hash(data) !== digest) throw new Error(`Checksum mismatch for dictionary member ${name}.`);
  }
}
async function verifyHunspellArchive(file) {
  const files = hunspellChecksums.files;
  if (hunspellChecksums.algorithm !== 'sha256') throw new Error('Invalid dictionary checksum manifest.');
  // Gitiles can repack an archive differently on each request. Pin the hash of
  // every extracted file, not the gzip stream's incidental metadata.
  const scratch = await fs.mkdtemp(path.join(base, 'hunspell-extract-'));
  await tar.x({ file, cwd: scratch, strict: true, maxEntrySize: 32 * 1024 * 1024, maxDecompressionRatio: 20,
    filter: (name, entry) => Object.hasOwn(files, name) && entry.type === 'File' });
  await verifyHunspellMembers(scratch, files);
  return scratch;
}
async function prepareDictionaries() {
  const spec = recipe.hunspell, destination = path.join(payload, 'dictionaries');
  if (spec.memberChecksums !== 'hunspell-checksums.json' || !spec.url.includes(hunspellChecksums.sourceCommit)) throw new Error('Invalid dictionary source revision.');
  const sourceZip = path.join(payload, 'sources', 'chromium-hunspell-sources.zip');
  const marker = path.join(destination, '.wraiter-source-sha256');
  const manifestHash = hash(Buffer.from(JSON.stringify(hunspellChecksums.files)));
  const ready = await fs.readFile(marker, 'utf8').catch(() => '') === manifestHash &&
    (await Promise.all([sourceZip, ...spec.binaries.map(file => path.join(destination, file))].map(file => fs.access(file).then(() => true, () => false)))).every(Boolean);
  if (ready) return;
  console.log('Preparing bundled offline spelling dictionaries.');
  const notices = ['README.chromium', 'LICENSE', 'COPYING', 'COPYING.Apache', 'COPYING.GPL3', 'COPYING.LESSER', 'COPYING.LGPL', 'COPYING.MIT', 'COPYING.MPL'];
  const sourceNames = spec.sourcePrefixes.flatMap(prefix => [`README_${prefix}.txt`, `${prefix}.aff`, `${prefix}.dic`, `${prefix}.dic_delta`]);
  for (const name of [...spec.binaries, ...notices, ...sourceNames.filter(name => !name.endsWith('.dic_delta'))]) if (!Object.hasOwn(hunspellChecksums.files, name)) throw new Error(`Missing pinned dictionary member ${name}.`);
  validateFile(spec.file);
  const archive = path.join(cache, spec.file);
  let scratch;
  if (await fs.access(archive).then(() => true, () => false)) {
    try { scratch = await verifyHunspellArchive(archive); }
    catch { console.log('Cached dictionary archive could not be verified; fetching the pinned source again.'); }
  }
  if (!scratch) {
    const candidate = path.join(cache, `${spec.file}.download-${crypto.randomUUID()}`);
    await fs.writeFile(candidate, await download(spec.url));
    scratch = await verifyHunspellArchive(candidate);
    await fs.copyFile(candidate, archive);
  }
  await fs.mkdir(destination, { recursive: true });
  for (const name of spec.binaries) await fs.copyFile(path.join(scratch, name), path.join(destination, name));
  const zip = new JSZip(), date = new Date('1980-01-01T00:00:00Z');
  for (const name of [...notices, ...sourceNames]) {
    if (!Object.hasOwn(hunspellChecksums.files, name)) continue;
    const data = await fs.readFile(path.join(scratch, name));
    zip.file(name, data, { date });
    if (notices.includes(name) || name.startsWith('README_')) await writeInside(path.join(payload, 'notices', 'hunspell'), name, data);
  }
  await fs.writeFile(sourceZip, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
  await fs.writeFile(marker, manifestHash);
}
async function prepare() {
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(payload, { recursive: true });
  const jars = recipe.artifacts.map(item => ({ ...item, url: mavenUrl(item) }));
  await pool([...jars, ...recipe.sources], 6, async item => {
    const bytes = await cached(item);
    const directory = jars.includes(item) ? 'lib' : 'sources';
    let installed = bytes;
    if (item.excludeResources) {
      if (item.file !== 'language-en-6.8.jar' || item.excludeResources.length !== 1 || item.excludeResources[0] !== 'org/languagetool/resource/en/spelling_correction_model.bin') throw new Error('Invalid language resource exclusion.');
      const modified = await JSZip.loadAsync(bytes);
      if (!modified.file(item.excludeResources[0])) throw new Error('The excluded language resource was not found.');
      modified.remove(item.excludeResources[0]);
      installed = await modified.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      if (hash(installed) !== item.derivedSha256) throw new Error('Checksum mismatch for the repacked language rules.');
    }
    await writeInside(path.join(payload, directory), item.file, installed);
    if (directory === 'lib') {
      const zip = await JSZip.loadAsync(bytes);
      const names = Object.keys(zip.files).filter(name => /^(?:META-INF\/)?(?:LICENSE|NOTICE|COPYING)(?:[.-]|$)/i.test(name) && !zip.files[name].dir);
      for (const name of names) await writeInside(path.join(payload, 'notices', 'jars', item.artifact), path.basename(name), await zip.file(name).async('nodebuffer'));
    }
  });
  const runtime = path.join(payload, 'runtime'), marker = path.join(runtime, '.wraiter-runtime-sha256');
  if (await fs.readFile(marker, 'utf8').catch(() => '') !== recipe.runtime.sha256 || !await fs.access(path.join(runtime, 'bin', 'java.exe')).then(() => true, () => false)) {
    console.log('Preparing the bundled offline grammar runtime.');
    const archive = await JSZip.loadAsync(await cached(recipe.runtime), { checkCRC32: true });
    for (const [name, entry] of Object.entries(archive.files)) {
      if (entry.dir || !name.startsWith(recipe.runtime.root)) continue;
      const relative = name.slice(recipe.runtime.root.length);
      if (!relative || relative.split('/').includes('..') || relative.includes('\\')) throw new Error('Unsafe runtime archive path.');
      await writeInside(runtime, relative, await entry.async('nodebuffer'));
    }
    await fs.writeFile(marker, recipe.runtime.sha256);
  }
  await prepareDictionaries();
  await fs.cp(path.join(__dirname, 'local-grammar', 'notices'), path.join(payload, 'notices'), { recursive: true });
  await copyIfChanged(path.join(__dirname, 'local-grammar', 'WraiterGrammar.jar'), path.join(payload, 'WraiterGrammar.jar'));
  await copyIfChanged(path.join(__dirname, 'local-grammar', 'WraiterGrammar.java'), path.join(payload, 'WraiterGrammar.java'));
  await copyIfChanged(path.join(__dirname, 'local-grammar', 'RuleChunker.java'), path.join(payload, 'RuleChunker.java'));
  await copyIfChanged(path.join(__dirname, 'local-grammar', 'dependencies.json'), path.join(payload, 'dependencies.json'));
  await copyIfChanged(path.join(__dirname, 'local-grammar', 'hunspell-checksums.json'), path.join(payload, 'hunspell-checksums.json'));
  console.log(`Prepared local spelling and grammar resources in ${payload}.`);
}

module.exports = { prepare, mavenUrl, verifyHunspellArchive, verifyHunspellMembers };
if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
