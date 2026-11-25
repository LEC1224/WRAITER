const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
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

test('installed dictionaries keep unsorted and case-insensitive index behavior', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-thesaurus-unsorted-'));
  try {
    const dir = path.join(root, 'LibreOffice', 'share', 'extensions', 'dict-en'); await fs.mkdir(dir, { recursive: true });
    const header = 'UTF-8\n', first = 'CAFÉ|1\n(noun)|first\n', last = 'café|1\n(noun)|last\n';
    await fs.writeFile(path.join(dir, 'th_en_US_v2.dat'), header + first + last);
    await fs.writeFile(path.join(dir, 'th_en_US_v2.idx'), `UTF-8\n2\nCAFÉ|${Buffer.byteLength(header)}\ncafé|${Buffer.byteLength(header + first)}\n`);
    assert.deepEqual((await lookup('CAFÉ', 'en-US', root)).senses[0].words, ['last']);
    assert.deepEqual(await lookup('missing', 'en-US', root), { available: true, senses: [] });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('bundled lookups agree with index offsets and concurrent requests share one load', async () => {
  const originalRoot = process.env.ProgramFiles, originalRead = fs.readFile;
  process.env.ProgramFiles = path.join(os.tmpdir(), `wraiter-no-office-shared-${Date.now()}`);
  const reads = { idx: 0, dat: 0 };
  fs.readFile = async (file, ...args) => {
    const name = String(file);
    if (name.endsWith('th_en_US_v2.idx.gz')) reads.idx++;
    if (name.endsWith('th_en_US_v2.dat.gz')) reads.dat++;
    return originalRead(file, ...args);
  };
  try {
    const simultaneous = await Promise.all(Array.from({ length: 8 }, () => lookup('happy', 'en-US')));
    assert.ok(simultaneous.every(result => result.available && result.senses.length));
    assert.deepEqual(reads, { idx: 1, dat: 1 });
    fs.readFile = originalRead;
    const base = path.join(__dirname, '..', 'assets', 'thesaurus', 'th_en_US_v2');
    const index = gunzipSync(await fs.readFile(base + '.idx.gz')).toString('utf8').split(/\r?\n/).slice(2).filter(Boolean);
    const data = gunzipSync(await fs.readFile(base + '.dat.gz'));
    let previous = '';
    for (const line of index) {
      const word = line.slice(0, line.lastIndexOf('|'));
      assert.ok(/^[\x00-\x7f]+$/.test(word) && word === word.toLowerCase() && word > previous, 'The bundled index must remain sorted, unique and lowercase ASCII');
      previous = word;
    }
    let seed = 123456;
    const positions = [0, 1, index.length - 2, index.length - 1];
    for (let i = 0; i < 250; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; positions.push(seed % index.length); }
    for (const position of positions) {
      const line = index[position], divider = line.lastIndexOf('|'), word = line.slice(0, divider), offset = Number(line.slice(divider + 1));
      const lines = data.subarray(offset, Math.min(data.length, offset + 32768)).toString('utf8').split(/\r?\n/);
      const count = Math.min(50, Number(lines[0].split('|').at(-1)) || 0);
      const senses = lines.slice(1, count + 1).map(item => { const [meaning, ...words] = item.split('|'); return { meaning, words: words.filter(Boolean).slice(0, 60) }; }).filter(item => item.words.length);
      assert.deepEqual(await lookup(word.toUpperCase(), 'en-US'), { available: true, senses }, word);
    }
    assert.deepEqual(await lookup('a word absent from the dictionary', 'en-US'), { available: true, senses: [] });
  } finally {
    fs.readFile = originalRead;
    if (originalRoot === undefined) delete process.env.ProgramFiles; else process.env.ProgramFiles = originalRoot;
  }
});
