'use strict';
// Build-time only: installed applications never fetch these weights.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const revision = '2232e0ef109dd12e11e2c74b565b7318e36379e4';
const source = 'https://huggingface.co/deepquillapp/gector-grammar';
const files = [
  ['model.onnx', 'c8ce4fcc952f33d399cd668e200527f28b94136b61bec24d7852504d5c7c53e9', 256279090],
  ['tokenizer.json', 'c9cbd55a5b79c5b8d99108dcd4978c16610a5f9cb5f7b27502efc2f893b5e720', 3558978],
  ['labels.json', '753bb8bd179ba56c169d950bce77ad40893490bce47be9f74281263582d3ec43', 96276],
  ['verb-form-vocab.txt', '5906804ec8a1acd8cbfc2918522bf429ce5edded8bbc46ffc2be861d280d3abf', 4390076],
  ['README.md', 'd5833dc1ec88d4655c3a0cd6dd8f6439767d0a6e4908faa1a31d27d0cb767f4a', 2683],
];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function checked(file, checksum, size) {
  const info = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info || info.size !== size) return null;
  const data = await fs.readFile(file);
  return hash(data) === checksum ? data : null;
}
async function prepare() {
  const cache = path.join(root, 'build', 'neural-grammar-cache');
  const output = path.join(root, 'build', 'neural-grammar');
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  for (const [name, checksum, size] of files) {
    const destination = path.join(output, name === 'README.md' ? 'MODEL-CARD.md' : name);
    if (await checked(destination, checksum, size)) continue;
    let data = await checked(path.join(cache, name), checksum, size);
    if (!data) {
      console.log('Fetching pinned neural grammar dependency ' + name);
      const response = await fetch(source + '/resolve/' + revision + '/' + name, { signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw new Error('Neural grammar download failed (' + response.status + '): ' + name);
      data = Buffer.from(await response.arrayBuffer());
      if (data.length !== size || hash(data) !== checksum) throw new Error('Neural grammar checksum mismatch: ' + name);
      await fs.writeFile(path.join(cache, name), data);
    }
    await fs.writeFile(destination, data);
  }
  for (const name of ['Apache-2.0.txt', 'RoBERTa-MIT.txt', 'NEURAL-NOTICE.txt']) {
    await fs.copyFile(path.join(root, 'tools', 'grammar-model', 'licenses', name), path.join(output, name));
  }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
    model: 'deepquillapp/gector-grammar', source, revision, license: 'Apache-2.0',
    files: files.map(([name, sha256, bytes]) => ({ name: name === 'README.md' ? 'MODEL-CARD.md' : name, sha256, bytes }))
  }, null, 2) + '\n');
  console.log('Prepared pinned offline neural grammar resources in ' + output);
}
module.exports = { prepare, revision, files };
if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
