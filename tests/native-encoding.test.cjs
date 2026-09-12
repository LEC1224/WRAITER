const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DocumentStore } = require('../electron/core.cjs');
const { DocumentFiles } = require('../electron/document-files.cjs');

const project = text => ({ format: 'wraiter', version: 1, id: 'encoding-document', title: 'Text encoding fixture', chapters: [{ id: 'main', title: 'Manuscript', status: 'Draft', content: { type: 'doc', content: text.split(/\r\n|\r|\n/).map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) } }], notes: '', style: '', references: [], snapshots: [] });
const encode = (text, little) => { const data = Buffer.from('\ufeff' + text, 'utf16le'); return little ? data : data.swap16(); };
async function temporary(t) {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-encoding-'));
  t.after(async () => { const resolved = await fs.realpath(directory); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-encoding-')); await fs.rm(resolved, { recursive: true, force: true }); });
  return directory;
}

for (const little of [true, false]) test(`native UTF-16${little ? 'LE' : 'BE'} saves preserve BOM, Unicode, CRLF, trailing newline and prior bytes`, async t => {
  const directory = await temporary(t), target = path.join(directory, 'Manuscript.txt'), initialText = 'Första raden\r\nOld version\r\n', editedText = 'Första raden\r\nEdited text with 😀\r\n';
  const original = encode(initialText, little); await fs.writeFile(target, original);
  const store = new DocumentStore(directory), files = new DocumentFiles(store, directory);
  const opened = await files.open(target); assert.ok(opened.import);
  const fidelity = { format: 'txt', encoding: little ? 'utf-16le' : 'utf-16be', bom: true, lineEnding: '\r\n', warnings: [], requiresReview: false };
  await files.bind(project(initialText), { openToken: opened.openToken, fidelity });
  const expected = encode(editedText, little), padded = new Uint8Array(expected.length + 4); padded.set(expected, 2);
  // LE uses a typed-array view with a nonzero offset; BE uses ArrayBuffer.
  const bytes = little ? padded.subarray(2, padded.length - 2) : new Uint8Array(expected).buffer;
  const saved = await files.persist(project(editedText), { format: 'txt', data: bytes });
  assert.equal(saved.path, target); assert.equal(saved.recoveryOnly, undefined);
  assert.deepEqual(await fs.readFile(target), expected);
  assert.deepEqual(await fs.readFile(`${target}.bak`), original);
  assert.deepEqual(await fs.readFile(saved.binding.originalBackup), original);
  const reopenedStore = new DocumentStore(directory); await reopenedStore.boot();
  const reopened = new DocumentFiles(reopenedStore, directory); await reopened.recover();
  assert.equal(reopened.binding.fidelity.encoding, fidelity.encoding);
  const roundtrip = await reopened.open(target);
  assert.equal(roundtrip.project.chapters[0].content.content[1].content[0].text, 'Edited text with 😀');
  assert.deepEqual(await fs.readFile(target), expected, 'Reopening the document must not rewrite encoded bytes');
});

test('native UTF-8 string save retains normal text handling and rejects arbitrary object payloads', async t => {
  const directory = await temporary(t), target = path.join(directory, 'Plain.txt'), store = new DocumentStore(directory), files = new DocumentFiles(store, directory);
  await store.replace(project('Before'));
  const chosen = await files.authorizeTarget(target);
  await assert.rejects(files.persist(project('After'), { format: 'txt', data: { text: 'After' } }, { token: chosen.token }), /Invalid encoded/);
  await files.persist(project('After'), { format: 'txt', data: 'After\n' }, { token: chosen.token });
  assert.deepEqual(await fs.readFile(target), Buffer.from('After\n', 'utf8'));
});
