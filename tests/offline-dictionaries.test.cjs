const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { seedOfflineDictionaries } = require('../electron/offline-dictionaries.cjs');
const { verifyHunspellMembers } = require('../tools/prepare-offline-grammar.cjs');
const payload = path.resolve(__dirname, '../build/offline-grammar/payload');

test('bundled dictionaries seed a fresh profile without replacing user files', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wraiter-dictionaries-'));
  const resources = path.join(temporary, 'resources'), source = path.join(resources, 'dictionaries');
  const userData = path.join(temporary, 'profile'), destination = path.join(userData, 'Dictionaries');
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(source, 'sv-SE-3-0.bdic'), 'bundled Swedish');
  fs.writeFileSync(path.join(source, 'pl-PL-3-0.bdic'), 'bundled Polish');
  fs.writeFileSync(path.join(source, 'unrelated.txt'), 'not a dictionary');
  fs.writeFileSync(path.join(destination, 'sv-SE-3-0.bdic'), 'existing user cache');
  fs.writeFileSync(path.join(userData, 'Custom Dictionary.txt'), 'Eldrak');
  assert.deepEqual(seedOfflineDictionaries(resources, userData), { copied: 1, failed: 0 });
  assert.equal(fs.readFileSync(path.join(destination, 'sv-SE-3-0.bdic'), 'utf8'), 'existing user cache');
  assert.equal(fs.readFileSync(path.join(destination, 'pl-PL-3-0.bdic'), 'utf8'), 'bundled Polish');
  assert.equal(fs.readFileSync(path.join(userData, 'Custom Dictionary.txt'), 'utf8'), 'Eldrak');
  assert.equal(fs.existsSync(path.join(destination, 'unrelated.txt')), false);
  assert.deepEqual(seedOfflineDictionaries(resources, userData), { copied: 0, failed: 0 });
  assert.deepEqual(seedOfflineDictionaries(path.join(temporary, 'absent'), userData), { copied: 0, failed: 0 });
});

test('staged dictionaries include their source and attribution', { skip: !fs.existsSync(path.join(payload, 'dictionaries', 'sv-SE-3-0.bdic')) }, async () => {
  const JSZip = require('jszip'), recipe = require('../tools/local-grammar/dependencies.json');
  const checksums = require('../tools/local-grammar/hunspell-checksums.json').files;
  const source = await JSZip.loadAsync(fs.readFileSync(path.join(payload, 'sources', 'chromium-hunspell-sources.zip')));
  for (const name of recipe.hunspell.binaries) {
    const bytes = fs.readFileSync(path.join(payload, 'dictionaries', name));
    assert.equal(bytes.subarray(0, 4).toString(), 'BDic', name);
  }
  for (const prefix of recipe.hunspell.sourcePrefixes) {
    for (const name of [`README_${prefix}.txt`, `${prefix}.aff`, `${prefix}.dic`]) assert.ok(source.file(name), name);
  }
  for (const name of ['README.chromium', 'LICENSE', 'COPYING']) assert.ok(source.file(name), name);
  for (const [name, expected] of Object.entries(checksums)) {
    const bytes = recipe.hunspell.binaries.includes(name) ? fs.readFileSync(path.join(payload, 'dictionaries', name)) : await source.file(name).async('nodebuffer');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, name);
  }
});

test('dictionary member verification rejects tampering, missing files, and unsafe paths', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wraiter-dictionary-hashes-'));
  const checksum = value => crypto.createHash('sha256').update(value).digest('hex');
  fs.writeFileSync(path.join(directory, 'word.aff'), 'expected');
  await verifyHunspellMembers(directory, { 'word.aff': checksum('expected') });
  await assert.rejects(verifyHunspellMembers(directory, { 'word.aff': checksum('different') }), /Checksum mismatch/);
  await assert.rejects(verifyHunspellMembers(directory, { 'missing.aff': checksum('expected') }), /ENOENT/);
  await assert.rejects(verifyHunspellMembers(directory, { '../outside.aff': checksum('expected') }), /Invalid dependency filename/);
});
