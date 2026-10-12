const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { atomicWrite, hash, DocumentStore } = require('../electron/core.cjs');
const { DocumentFiles } = require('../electron/document-files.cjs');

async function temporary(t) {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'wraiter-atomic-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-atomic-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return directory;
}
const draft = text => ({ format: 'wraiter', version: 1, id: 'atomic-test', title: 'Atomic test', chapters: [{ id: 'one', title: 'Chapter', status: 'Draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }], references: [], notes: '', style: '', snapshots: [] });
const locked = code => Object.assign(new Error('Synthetic file lock'), { code });

test('brief replacement locks retry the staged bytes and retain the complete preceding backup', async t => {
  const directory = await temporary(t), target = path.join(directory, 'Draft.wraiter');
  const previous = Buffer.from([0, 255, 10, 13]), next = Buffer.from([1, 254, 0]);
  await fs.writeFile(target, previous);
  const rename = fs.rename; let attempts = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    assert.equal(to, target); assert.deepEqual(await fs.readFile(from), next);
    if (attempts++ < 3) throw locked(['EPERM', 'EBUSY', 'EACCES'][attempts - 1]);
    return rename(from, to);
  });
  await atomicWrite(target, next, true, { expectedHash: hash(previous) });
  assert.equal(attempts, 4); assert.deepEqual(await fs.readFile(target), next);
  assert.deepEqual(await fs.readFile(`${target}.bak`), previous);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['Draft.wraiter', 'Draft.wraiter.bak']);
});

test('brief backup locks also retry without exposing partial destination contents', async t => {
  const directory = await temporary(t), target = path.join(directory, 'Draft.wraiter');
  await fs.writeFile(target, 'Previous'); const copy = fs.copyFile; let attempts = 0;
  t.mock.method(fs, 'copyFile', async (from, to) => {
    assert.equal(await fs.readFile(target, 'utf8'), 'Previous');
    if (attempts++ === 0) throw locked('EBUSY');
    return copy(from, to);
  });
  await atomicWrite(target, 'Next', true, { expectedHash: hash('Previous') });
  assert.equal(attempts, 2); assert.equal(await fs.readFile(target, 'utf8'), 'Next');
  assert.equal(await fs.readFile(`${target}.bak`, 'utf8'), 'Previous');
});

test('permanent locks and unrelated failures preserve the named file and remove staging files', async t => {
  const directory = await temporary(t), target = path.join(directory, 'Draft.wraiter');
  await fs.writeFile(target, 'Original');
  for (const [code, expectedAttempts] of [['EPERM', 6], ['ENOSPC', 1]]) {
    let attempts = 0; const failure = locked(code);
    const mock = t.mock.method(fs, 'rename', async () => { attempts++; throw failure; });
    await assert.rejects(atomicWrite(target, 'Replacement', true), error => error === failure);
    mock.mock.restore();
    assert.equal(attempts, expectedAttempts); assert.equal(await fs.readFile(target, 'utf8'), 'Original');
    assert.equal(await fs.readFile(`${target}.bak`, 'utf8'), 'Original');
    assert.ok((await fs.readdir(directory)).every(name => !name.endsWith('.tmp')));
  }
});

test('a named manuscript changed during a retry is preserved, with local edits still in recovery', async t => {
  const directory = await temporary(t), target = path.join(directory, 'Draft.wraiter');
  const store = new DocumentStore(path.join(directory, 'Profile')); await store.persist(draft('Original'), target);
  const external = JSON.stringify(draft('External author edit'));
  const rename = fs.rename; let attempts = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === target) { attempts++; await fs.writeFile(target, external); throw locked('EPERM'); }
    return rename(from, to);
  });
  await assert.rejects(store.persist(draft('Local revision')), /changed outside/);
  assert.equal(attempts, 1); assert.equal(await fs.readFile(target, 'utf8'), external);
  assert.match(await fs.readFile(`${target}.bak`, 'utf8'), /Original/);
  assert.match(JSON.stringify((await new DocumentStore(store.directory).boot()).project), /Local revision/);
  assert.ok((await fs.readdir(directory)).every(name => !name.endsWith('.tmp')));
});

test('a newly created Save-as destination during a retry is preserved', async t => {
  const directory = await temporary(t), target = path.join(directory, 'New.wraiter'); let attempts = 0;
  t.mock.method(fs, 'rename', async () => { attempts++; await fs.writeFile(target, 'External file'); throw locked('EBUSY'); });
  await assert.rejects(atomicWrite(target, 'Local file', true, { expectedHash: null }), /changed outside/);
  assert.equal(attempts, 1); assert.equal(await fs.readFile(target, 'utf8'), 'External file');
  await assert.rejects(fs.readFile(`${target}.bak`), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(directory), ['New.wraiter']);
});

test('native text saves also recheck external changes before a replacement retry', async t => {
  const directory = await temporary(t), target = path.join(directory, 'Native.txt'), profile = path.join(directory, 'Profile');
  await fs.writeFile(target, 'Original native text');
  const store = new DocumentStore(profile), files = new DocumentFiles(store, profile);
  const pending = await files.open(target); await files.bind(draft('Original native text'), { openToken: pending.openToken });
  const rename = fs.rename; let attempts = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === target) { attempts++; await fs.writeFile(target, 'External native text'); throw locked('EACCES'); }
    return rename(from, to);
  });
  await assert.rejects(files.persist(draft('Local native text'), { format: 'txt', data: 'Local native text', lossWarnings: [] }), /changed outside/);
  assert.equal(attempts, 1); assert.equal(await fs.readFile(target, 'utf8'), 'External native text');
  assert.match(JSON.stringify((await new DocumentStore(profile).boot()).project), /Local native text/);
});
