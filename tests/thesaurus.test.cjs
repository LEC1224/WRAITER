const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { lookup } = require('../electron/thesaurus.cjs');

test('local thesaurus reads UTF-8 byte offsets and reports missing dictionaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-thesaurus-'));
  try {
    const dir = path.join(root, 'LibreOffice', 'share', 'extensions', 'dict-en'); await fs.mkdir(dir, { recursive: true });
    const header = 'UTF-8\n', first = 'café|1\n(noun)|coffee house|café bar\n';
    await fs.writeFile(path.join(dir, 'th_en_US_v2.dat'), header + first);
    await fs.writeFile(path.join(dir, 'th_en_US_v2.idx'), `UTF-8\n1\ncafé|${Buffer.byteLength(header)}\n`);
    assert.deepEqual((await lookup('CAFÉ', 'en-US', root)).senses[0].words, ['coffee house', 'café bar']);
    assert.deepEqual(await lookup('unknown', 'en-US', root), { available: true, senses: [] });
    assert.equal((await lookup('test', 'sv-SE', root)).available, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('English thesaurus is available without LibreOffice from the bundled licensed data', async () => {
  const original = process.env.ProgramFiles;
  try {
    process.env.ProgramFiles = path.join(os.tmpdir(), 'wraiter-no-office-' + Date.now());
    const result = await lookup('happy', 'en-US');
    assert(result.available); assert(result.senses.length > 0);
  } finally { if (original === undefined) delete process.env.ProgramFiles; else process.env.ProgramFiles = original; }
});
