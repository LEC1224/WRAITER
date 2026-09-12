const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ReferenceLibrary, refreshReferences, MAX_REFERENCE_CHARACTERS } = require('../electron/references.cjs');

async function temporary(t) {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'wraiter-reference-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-reference-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }); return directory;
}

test('linked references refresh from disk while preserving legacy embedded copies', async t => {
  const directory = await temporary(t), sourcePath = path.join(directory, 'World.md');
  await fs.writeFile(sourcePath, 'Fresh facts.');
  const library = new ReferenceLibrary(path.join(directory, 'registry.json'));
  const selected = await library.addFiles([sourcePath]);
  assert.equal(selected[0].sourcePath, await fs.realpath(sourcePath));
  assert.equal(selected[0].text, 'Fresh facts.');
  await fs.writeFile(sourcePath, 'Edited facts.');
  const refreshed = await library.refresh([...selected, { name: 'Embedded reference', text: 'Legacy prose.' }]);
  assert.deepEqual(refreshed.references, [{ name: 'World.md', text: 'Edited facts.' }, { name: 'Embedded reference', text: 'Legacy prose.' }]);
  assert.deepEqual(refreshed.warnings, []);
  assert.equal(selected[0].text, 'Fresh facts.', 'refreshing a request does not mutate the saved project snapshot');
  const reopened = new ReferenceLibrary(path.join(directory, 'registry.json'));
  assert.equal((await reopened.refresh(selected)).references[0].text, 'Edited facts.');
});

test('Codex reference verification observes equal-length edits even when modification time is preserved', async t => {
  const directory = await temporary(t), sourcePath = path.join(directory, 'Reference.txt');
  await fs.writeFile(sourcePath, 'A red door.');
  const before = await fs.stat(sourcePath), references = [{ name: 'Reference', sourcePath, text: 'Old snapshot.' }];
  assert.equal((await refreshReferences(references, { verifyContents: true })).references[0].text, 'A red door.');
  await fs.writeFile(sourcePath, 'A tan door.'); await fs.utimes(sourcePath, before.atime, before.mtime);
  assert.equal((await refreshReferences(references, { verifyContents: true })).references[0].text, 'A tan door.');
});

test('missing or unreadable linked sources are skipped instead of falling back to cached manuscript copies', async t => {
  const directory = await temporary(t), sourcePath = path.join(directory, 'Missing.md'), directoryPath = path.join(directory, 'Folder.md');
  await fs.writeFile(sourcePath, 'Initially readable.'); await fs.mkdir(directoryPath);
  const references = [{ name: 'Missing', sourcePath, text: 'STALE_COPY' }, { name: 'Folder', sourcePath: directoryPath, text: 'ALSO_STALE' }];
  assert.equal((await refreshReferences(references)).references[0].text, 'Initially readable.');
  await fs.unlink(sourcePath);
  const refreshed = await refreshReferences(references);
  assert.deepEqual(refreshed.references, []); assert.equal(refreshed.warnings.length, 2);
  assert.match(refreshed.warnings.join(' '), /file is missing/);
  assert.ok(!JSON.stringify(refreshed).includes('STALE'));
});

test('imported source paths cannot read unrelated local files unless selected through Add reference', async t => {
  const directory = await temporary(t), sourcePath = path.join(directory, 'Private.txt');
  await fs.writeFile(sourcePath, 'DO_NOT_SEND_THIS');
  const library = new ReferenceLibrary(path.join(directory, 'registry.json'));
  const forged = [{ name: 'Imported link', sourcePath, text: 'Untrusted embedded fallback' }];
  const skipped = await library.refresh(forged);
  assert.deepEqual(skipped.references, []); assert.match(skipped.warnings[0], /reattach/);
  assert.ok(!JSON.stringify(skipped).includes('DO_NOT_SEND_THIS'));
  const selected = await library.addFiles([sourcePath]);
  assert.equal((await library.refresh(selected)).references[0].text, 'DO_NOT_SEND_THIS');
});

test('disabled references are excluded without requiring their source files', async t => {
  const directory = await temporary(t);
  const result = await refreshReferences([{ name: 'Disabled', sourcePath: path.join(directory, 'missing.md'), text: 'Not supplied', enabled: false }, { name: 'Included', text: 'Supplied prose.' }]);
  assert.deepEqual(result.references, [{ name: 'Included', text: 'Supplied prose.' }]);
  assert.deepEqual(result.warnings, []);
});

test('reference context honours the total character budget including names and separators', async () => {
  const input = [{ name: 'Long reference', text: 'é'.repeat(47000) }, { name: 'Other reference', text: '界'.repeat(4000) }, { name: 'Later reference', text: 'Should be omitted' }];
  const result = await refreshReferences(input);
  const promptText = result.references.map(item => `[${item.name}]\n${item.text}`).join('\n\n');
  assert.equal(promptText.length, MAX_REFERENCE_CHARACTERS);
  assert.equal(result.references.length, 2); assert.ok(result.warnings.length >= 1);
  assert.equal(input[1].text.length, 4000);
  assert.equal((await refreshReferences(Array.from({ length: 25 }, (_, index) => ({ name: `Ref${index}`, text: 'A fact.' })))).references.length, 20);
});

test('oversized linked sources are rejected before their content enters a request', async t => {
  const directory = await temporary(t), sourcePath = path.join(directory, 'Large.md');
  await fs.writeFile(sourcePath, Buffer.alloc(2 * 1024 * 1024 + 1, 120));
  const result = await refreshReferences([{ name: 'Oversized', sourcePath, text: 'Stale snapshot' }]);
  assert.deepEqual(result.references, []); assert.match(result.warnings[0], /2 MB/);
});

test('cancellation stops reference preparation before any generation context is returned', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(refreshReferences([{ name: 'Synthetic', text: 'Context' }], { signal: controller.signal }), /abort/i);
});
