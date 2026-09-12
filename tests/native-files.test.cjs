const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DocumentStore, hash } = require('../electron/core.cjs');
const { DocumentFiles, formatOf } = require('../electron/document-files.cjs');
const { EditJournal } = require('../electron/edit-journal.cjs');

const project = (text = 'Synthetic original.', id = 'native-test') => ({ format: 'wraiter', version: 1, id, title: 'Synthetic document', chapters: [{ id: 'chapter-one', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }], references: [], notes: '', style: '', snapshots: [] });
const encoded = (format, text) => ({ format, data: ['odt', 'docx'].includes(format) ? new Uint8Array(Buffer.from(`PK${text}`)) : text });
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()); const directory = await fs.mkdtemp(path.join(parent, 'wraiter-native-test-'));
  t.after(async () => { const resolved = await fs.realpath(directory); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-native-test-')); await fs.rm(resolved, { recursive: true, force: true }); });
  const userData = path.join(directory, 'User data'); const store = new DocumentStore(userData); const files = new DocumentFiles(store, userData);
  return { directory, userData, store, files };
}
async function openSynthetic(f, format, fidelity = {}) {
  const target = path.join(f.directory, `Synthetic.${format}`); const original = Buffer.from(`PKOriginal ${format} document`);
  await fs.writeFile(target, original); const opened = await f.files.open(target);
  assert.equal(opened.import, true); assert.equal(opened.format, format);
  const draft = project(); const result = await f.files.bind(draft, { openToken: opened.openToken, fidelity });
  return { target, original, draft, result };
}

test('native ODT and DOCX save back to their existing path, retain the original and preceding backup, and reopen with rich state', async t => {
  for (const format of ['odt', 'docx']) {
    const f = await fixture(t); const { target, original } = await openSynthetic(f, format);
    const first = project('First edit.'); first.notes = 'A WRAITER note';
    const saved = await f.files.persist(first, encoded(format, 'First encoded version'));
    assert.equal(saved.path, target); assert.equal(saved.binding.format, format); assert.equal(f.store.currentPath, target);
    assert.equal((await fs.readFile(target)).toString(), 'PKFirst encoded version');
    assert.deepEqual(await fs.readFile(`${target}.bak`), original);
    const originalBackup = saved.binding.originalBackup; assert.deepEqual(await fs.readFile(originalBackup), original);
    const second = project('Second edit.'); second.notes = first.notes;
    await f.files.persist(second, encoded(format, 'Second encoded version'));
    assert.equal((await fs.readFile(`${target}.bak`)).toString(), 'PKFirst encoded version');
    assert.deepEqual(await fs.readFile(originalBackup), original, 'the first native original is immutable');
    assert.equal(f.files.binding.originalBackup, originalBackup);
    const store = new DocumentStore(f.userData), files = new DocumentFiles(store, f.userData);
    const reopened = await files.open(target); assert.ok(!reopened.import); assert.equal(reopened.project.notes, first.notes);
    assert.equal(reopened.project.chapters[0].content.content[0].content[0].text, 'Second edit.');
    assert.equal(reopened.binding.format, format); assert.equal(store.expectedHash, hash(await fs.readFile(target)));
    const recovery = new DocumentStore(f.userData); assert.equal((await recovery.boot()).path, target);
    const recoveredFiles = new DocumentFiles(recovery, f.userData); await recoveredFiles.recover(); assert.equal(recoveredFiles.binding.originalBackup, originalBackup);
  }
});

test('fidelity review stages a native edit in recovery without overwriting until explicit review', async t => {
  const f = await fixture(t); const { target, original } = await openSynthetic(f, 'odt', { requiresReview: true, warnings: ['Unsupported floating drawing.'] });
  const changed = project('A staged edit.'); changed.historySequence = 2;
  const pending = await f.files.persist(changed, encoded('odt', 'Reviewable edit'));
  assert.equal(pending.needsReview, true); assert.equal(pending.recoveryOnly, true); assert.deepEqual(await fs.readFile(target), original);
  assert.equal((await new DocumentStore(f.userData).boot()).project.chapters[0].content.content[0].content[0].text, 'A staged edit.');
  assert.equal((await f.files.readSidecar(target)).project.historySequence, 2);
  const saved = await f.files.persist(changed, encoded('odt', 'Reviewable edit'), { reviewed: true });
  assert.equal(saved.binding.reviewed, true); assert.equal((await fs.readFile(target)).toString(), 'PKReviewable edit');
  assert.deepEqual(await fs.readFile(saved.binding.originalBackup), original);
});

test('new formatting losses are reviewed once and new loss types stage recovery again', async t => {
  const f = await fixture(t), target = path.join(f.directory, 'Synthetic.txt');
  await fs.writeFile(target, 'Original plain text.');
  const opened = await f.files.open(target);
  const original = project('Original plain text.');
  await f.files.bind(original, { openToken: opened.openToken, fidelity: {} });
  const bold = project('Formatted wording.');
  bold.chapters[0].content.content[0].content[0].marks = [{ type: 'bold' }];
  const payload = { ...encoded('txt', 'Formatted wording.'), lossWarnings: ['Plain text removes emphasis.'] };
  assert.deepEqual(f.files.reviewWarnings(bold, payload), payload.lossWarnings);
  assert.equal((await f.files.persist(bold, payload)).needsReview, true);
  assert.equal(await fs.readFile(target, 'utf8'), 'Original plain text.');
  await f.files.persist(bold, payload, { reviewed: true });
  const later = { ...bold, title: 'More editing' };
  assert.deepEqual(f.files.reviewWarnings(later, payload), []);
  await f.files.persist(later, payload);
  const extra = { ...payload, lossWarnings: [...payload.lossWarnings, 'Plain text removes images.'] };
  assert.deepEqual(f.files.reviewWarnings({ ...later, title: 'New image' }, extra), ['Plain text removes images.']);
  const recovered = new DocumentStore(f.userData); await recovered.boot();
  const files = new DocumentFiles(recovered, f.userData); await files.recover();
  assert.deepEqual(files.binding.reviewedLossWarnings, payload.lossWarnings);
});

test('unchanged native documents need no compatibility review or file rewrite', async t => {
  const f = await fixture(t), opened = await openSynthetic(f, 'docx', { requiresReview: true, warnings: ['Unsupported headers.'] });
  const privateChange = { ...opened.draft, notes: 'A private note only.' };
  assert.deepEqual(f.files.reviewWarnings(privateChange, null), []);
  const result = await f.files.persist(privateChange, null);
  assert.equal(result.recoveryOnly, undefined);
  assert.deepEqual(await fs.readFile(opened.target), opened.original);
  assert.equal((await f.files.readSidecar(opened.target)).project.notes, privateChange.notes);
});

test('Save As converts a reviewed or unreviewed native document while preserving its original path', async t => {
  const f = await fixture(t); const { target, original } = await openSynthetic(f, 'odt', { requiresReview: true });
  const changed = project('Save this as DOCX.'); const destination = path.join(f.directory, 'Converted.docx');
  const chosen = await f.files.authorizeTarget(destination); const saved = await f.files.persist(changed, encoded('docx', 'Converted document'), { token: chosen.token });
  assert.equal(saved.path, destination); assert.equal(saved.binding.format, 'docx'); assert.equal(saved.binding.reviewed, true);
  assert.deepEqual(await fs.readFile(target), original); assert.equal((await fs.readFile(destination)).toString(), 'PKConverted document');
  assert.equal(f.store.currentPath, destination); await assert.rejects(f.files.persist(changed, encoded('docx', 'Again'), { token: chosen.token }), /destination again/);
});

test('native autosave preserves edits when another application changes or deletes the bound file', async t => {
  for (const action of ['changed', 'deleted']) {
    const f = await fixture(t); const { target } = await openSynthetic(f, 'docx');
    if (action === 'changed') await fs.writeFile(target, 'PKExternal editor version'); else await fs.unlink(target);
    const changed = project('Unsaved local edit.');
    await assert.rejects(f.files.persist(changed, encoded('docx', 'Local encoded document')), /changed outside WRAITER/);
    assert.equal((await new DocumentStore(f.userData).boot()).project.chapters[0].content.content[0].content[0].text, 'Unsaved local edit.');
    if (action === 'changed') assert.equal((await fs.readFile(target)).toString(), 'PKExternal editor version'); else await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  }
});

test('native open binding refuses an altered source and stale sidecars trigger fresh parsing', async t => {
  const f = await fixture(t); const target = path.join(f.directory, 'Race.odt'); await fs.writeFile(target, 'PKOriginal');
  const open = await f.files.open(target); await fs.writeFile(target, 'PKChanged before binding');
  await assert.rejects(f.files.bind(project(), { openToken: open.openToken }), /changed while opening/);
  const fresh = await f.files.open(target); await f.files.bind(project(), { openToken: fresh.openToken });
  await fs.writeFile(target, 'PKChanged after sidecar'); const external = await f.files.open(target);
  assert.equal(external.import, true); assert.equal(Buffer.from(external.bytes).toString(), 'PKChanged after sidecar');
});

test('native Save As checks destination freshness and invalid encodings before replacement', async t => {
  const f = await fixture(t); await openSynthetic(f, 'odt'); const destination = path.join(f.directory, 'Existing.docx'); await fs.writeFile(destination, 'PKExisting');
  const chosen = await f.files.authorizeTarget(destination); await fs.writeFile(destination, 'PKOutside change');
  await assert.rejects(f.files.persist(project('New text.'), encoded('docx', 'New'), { token: chosen.token }), /changed outside WRAITER/);
  assert.equal((await fs.readFile(destination)).toString(), 'PKOutside change');
  const chosenAgain = await f.files.authorizeTarget(destination);
  await assert.rejects(f.files.persist(project('New text.'), { format: 'docx', data: new Uint8Array(Buffer.from('not a ZIP')) }, { token: chosenAgain.token }), /Invalid or oversized/);
  assert.equal((await fs.readFile(destination)).toString(), 'PKOutside change');
});

test('plain text and common aliases remain bound to their text format without JSON conversion', async t => {
  const f = await fixture(t); await f.store.replace(project());
  for (const extension of ['txt', 'md', 'markdown', 'html', 'htm']) {
    const target = path.join(f.directory, `Text.${extension}`); const chosen = await f.files.authorizeTarget(target); const format = formatOf(target);
    await f.files.persist(project(`Format ${extension}.`), encoded(format, `Native ${extension} text`), { token: chosen.token });
    assert.equal(await fs.readFile(target, 'utf8'), `Native ${extension} text`); assert.equal(f.files.binding.format, format); assert.equal(f.store.currentPath, target);
  }
});

test('editing journal appends durable immutable events, deduplicates retries, and filters to recovery sequence', async t => {
  const f = await fixture(t); const journal = new EditJournal(f.userData);
  const first = { sequence: 1, kind: 'init', projectId: 'journal', fingerprint: 'initial' }; const second = { sequence: 2, kind: 'edit', entry: { id: 'first-change', text: 'Typed character' } };
  assert.deepEqual(await journal.append('journal', [first, second]), { sequence: 2 });
  const before = await fs.readFile(journal.filename('journal'), 'utf8'); await journal.append('journal', [first, second]); assert.equal(await fs.readFile(journal.filename('journal'), 'utf8'), before);
  await assert.rejects(journal.append('journal', [{ ...second, entry: { id: 'changed' } }]), /cannot be overwritten/);
  await assert.rejects(journal.append('journal', [{ sequence: 4, kind: 'edit' }]), /missing an earlier event/);
  const reopened = new EditJournal(f.userData); assert.deepEqual((await reopened.read('journal')).events, [first, second]);
  assert.deepEqual(await reopened.read('journal', 1), { events: [first], totalEvents: 2 });
  assert.equal(await fs.readFile(journal.filename('journal'), 'utf8'), before);
});

test('journal append resolves only after fsync, so recovery cannot name a not-yet-durable event', async t => {
  const f = await fixture(t); const journal = new EditJournal(f.userData); const originalOpen = fs.open; const order = [];
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === journal.filename('durable')) {
      const sync = handle.sync.bind(handle); handle.sync = async () => { order.push('sync started'); await sync(); order.push('sync finished'); };
    }
    return handle;
  });
  await journal.append('durable', [{ sequence: 1, kind: 'init', projectId: 'durable' }]); order.push('append resolved');
  assert.deepEqual(order, ['sync started', 'sync finished', 'append resolved']);
  assert.equal((await new EditJournal(f.userData).read('durable')).events.length, 1);
});

test('an unreadable interior history record never silently discards later saved edits', async t => {
  const f = await fixture(t); const journal = new EditJournal(f.userData); await fs.mkdir(journal.directory, { recursive: true });
  const text = '{"sequence":1,"kind":"init"}\n{bad}\n{"sequence":3,"kind":"edit"}\n'; await fs.writeFile(journal.filename('corrupt'), text);
  await assert.rejects(journal.read('corrupt'), /unreadable record/); assert.equal(await fs.readFile(journal.filename('corrupt'), 'utf8'), text);
});

test('native Save As cannot overwrite a newly changed WRAITER destination', async t => {
  const f = await fixture(t); await openSynthetic(f, 'odt'); const destination = path.join(f.directory, 'Existing.wraiter');
  await fs.writeFile(destination, JSON.stringify(project('Original destination.', 'other'))); const chosen = await f.files.authorizeTarget(destination);
  const external = JSON.stringify(project('External changes.', 'other')); await fs.writeFile(destination, external);
  await assert.rejects(f.files.persist(project('My converted text.'), null, { token: chosen.token }), /destination changed|changed outside WRAITER/);
  assert.equal(await fs.readFile(destination, 'utf8'), external);
});

test('a crash-truncated final journal line is preserved separately before safe future appends', async t => {
  const f = await fixture(t); const journal = new EditJournal(f.userData); const first = { sequence: 1, kind: 'init', projectId: 'partial' }; const second = { sequence: 2, kind: 'edit', entry: { id: 'next' } };
  await fs.mkdir(journal.directory, { recursive: true }); const original = JSON.stringify(first) + '\n{"sequence":2,"kind":"ed'; await fs.writeFile(journal.filename('partial'), original);
  assert.deepEqual((await journal.read('partial')).events, [first]); await journal.append('partial', [second]);
  const loaded = await new EditJournal(f.userData).read('partial'); assert.deepEqual(loaded.events, [first, second]);
  const siblingNames = await fs.readdir(journal.directory); const archives = siblingNames.filter(name => name !== path.basename(journal.filename('partial')));
  assert.ok(archives.length > 0, 'the truncated original must remain available for recovery');
  const retained = await Promise.all(archives.map(name => fs.readFile(path.join(journal.directory, name), 'utf8'))); assert.ok(retained.includes(original));
});
