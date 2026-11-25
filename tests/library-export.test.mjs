import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { createVault, sealDocument } from '../src/cloud-vault.js';
import { createHistory, recordProjectChange, prepareHistoryLoad, historyStatus } from '../src/history.js';
import { writeLibraryArchive, exportLibrary } from '../src/web/library-export.js';

const { validateProject } = createRequire(import.meta.url)('../electron/core.cjs');
const userId = 'archive-fixture-user';
const documentPassphrase = 'archive-only independent document passphrase';
const vaultFixture = createVault(userId, documentPassphrase);
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });

function manuscript(id, title = 'The Ångström manuscript') {
  return {
    format: 'wraiter', version: 1, id, title, language: 'en-GB',
    chapters: [{ id: `${id}-chapter`, title: 'Opening', content: { type: 'doc', content: [paragraph('Synthetic prose: blåbär, 日本語, and an ending.')] } }],
    notes: 'Private author notes remain in the complete document.', style: '',
    references: [{ id: `${id}-reference`, name: 'World notes', text: 'A private reference.', enabled: true }],
    chats: [{ id: `${id}-chat`, title: 'A saved conversation', messages: [{ id: `${id}-message`, role: 'user', text: 'A private question.' }] }],
    activeChatId: `${id}-chat`,
    snapshots: [{ id: `${id}-snapshot`, name: 'Before revision', title, createdAt: '2026-11-11T00:00:00.000Z', chapters: [{ id: `${id}-chapter`, title: 'Opening', content: { type: 'doc', content: [paragraph('An earlier checkpoint.')] } }], references: [] }]
  };
}

async function fixture(titles = ['The Ångström manuscript']) {
  const { key, vault, recoveryKey } = await vaultFixture;
  const documents = [], details = new Map(), originals = new Map();
  for (let index = 0; index < titles.length; index++) {
    const cloudId = `cloud-document-${index}`, initial = manuscript(`project-${index}`, titles[index]);
    const project = { ...initial, notes: initial.notes + ' A later edit.' };
    const history = recordProjectChange(createHistory(initial), initial, project, { label: 'Revise private notes' });
    project.historySequence = history.sequence;
    validateProject(project);
    const journal = JSON.parse(JSON.stringify(history.events));
    documents.push({ id: cloudId, title: titles[index], revision: index + 3 });
    details.set(cloudId, { id: cloudId, sealed: await sealDocument(key, userId, cloudId, { project, journal }), revision: index + 3 });
    originals.set(cloudId, { project, journal });
  }
  return { documents, key, vault, recoveryKey, details, originals, userId, loadDocument: async id => details.get(id) };
}

async function archive(options) {
  const chunks = [];
  const result = await writeLibraryArchive(options, chunk => chunks.push(Buffer.from(chunk)));
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, result.bytes);
  return { result, bytes, zip: await JSZip.loadAsync(bytes, { checkCRC32: true }) };
}

function browser(t, picker) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const state = { blobs: [], links: [], revoked: [], timers: [] };
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: picker ? { showSaveFilePicker: picker } : {} });
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { createElement(tag) { assert.equal(tag, 'a'); const link = { clicks: 0, click() { this.clicks++; } }; state.links.push(link); return link; } } });
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete globalThis.window;
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document;
  });
  t.mock.method(URL, 'createObjectURL', blob => { state.blobs.push(blob); return `blob:archive-${state.blobs.length}`; });
  t.mock.method(URL, 'revokeObjectURL', url => state.revoked.push(url));
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 60000) { state.timers.push(callback); return 0; }
    return originalTimeout(callback, delay, ...args);
  });
  return state;
}

test('library ZIP extracts with verified CRCs and round-trips complete native documents with fresh local history', async () => {
  const source = await fixture(), before = structuredClone(source.originals.get(source.documents[0].id)), progress = [];
  const { result, zip } = await archive({ ...source, onProgress: event => progress.push(event) });
  assert.equal(result.count, 1);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.format, 'wraiter-library'); assert.equal(manifest.version, 1);
  assert.ok(Number.isFinite(Date.parse(manifest.exportedAt)));
  assert.equal(manifest.documents.length, 1);
  const entry = manifest.documents[0];
  assert.deepEqual({ id: entry.id, projectId: entry.projectId, title: entry.title, revision: entry.revision }, { id: source.documents[0].id, projectId: before.project.id, title: before.project.title, revision: 3 });
  const portable = JSON.parse(await zip.file(entry.document).async('string'));
  const expected = { ...before.project }; delete expected.historySequence;
  assert.deepEqual(portable, expected); assert.equal(validateProject(portable), portable);
  assert.equal(Object.hasOwn(portable, 'historySequence'), false);
  const opened = prepareHistoryLoad(portable, { events: [] });
  assert.equal(opened.requiresJournalReset, false); assert.equal(opened.project.historySequence, 1);
  assert.equal(historyStatus(opened.journal).canUndo, false);
  const savedHistory = JSON.parse(await zip.file(entry.history).async('string'));
  assert.deepEqual(savedHistory, { projectId: before.project.id, historySequence: before.project.historySequence, journal: before.journal });
  const restored = prepareHistoryLoad(before.project, { events: savedHistory.journal });
  assert.equal(restored.requiresJournalReset, false); assert.equal(historyStatus(restored.journal).canUndo, true);
  assert.deepEqual(source.originals.get(source.documents[0].id), before, 'export must not mutate the current cloud document or journal');
  assert.match(await zip.file('README.txt').async('string'), /decrypted documents/);
  assert.deepEqual(Object.keys(zip.files).sort(), [entry.document, entry.history, 'manifest.json', 'README.txt'].sort());
  assert.equal(progress.at(-1).completed, 1); assert.equal(progress.at(-1).total, 1);
  assert.ok(progress.every((event, index) => !index || event.bytes >= progress[index - 1].bytes));
});

test('filenames normalize Unicode, resolve case collisions and stay inside their folders on Windows', async t => {
  t.mock.method(globalThis, 'CompressionStream', function () { throw new Error('Raw deflate unsupported'); });
  const titles = ['Ångström', 'A\u030Angström', 'ångström', 'CON', 'con.txt', 'NUL  ', 'LPT1', '../../escape\\..\\out:side?*', '.', 'Name.   ', 'Draft (2)', 'draft', 'DRAFT'];
  const source = await fixture(titles), { zip } = await archive(source);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.deepEqual(manifest.documents.map(entry => entry.document), [
    'documents/Ångström.wraiter', 'documents/Ångström (2).wraiter', 'documents/ångström (3).wraiter',
    'documents/_CON.wraiter', 'documents/_con.txt.wraiter', 'documents/_NUL.wraiter', 'documents/_LPT1.wraiter',
    'documents/....escape..outside.wraiter', 'documents/Untitled manuscript.wraiter', 'documents/Name.wraiter',
    'documents/Draft (2).wraiter', 'documents/draft.wraiter', 'documents/DRAFT (3).wraiter'
  ]);
  const names = Object.keys(zip.files);
  assert.equal(new Set(names.map(name => name.normalize('NFC').toLocaleLowerCase('en-US'))).size, names.length);
  for (const name of names) {
    assert.equal(name, zip.file(name).unsafeOriginalName, 'JSZip must not have silently repaired a traversal path');
    assert.ok(!name.includes('\\')); assert.ok(!name.startsWith('/')); assert.ok(!name.split('/').includes('..'));
    assert.ok(name === 'README.txt' || name === 'manifest.json' || /^(documents|history)\/[^/]+\.(wraiter|json)$/.test(name));
    assert.ok(!/[<>:"|?*\x00-\x1f\x7f]/.test(name));
  }
  for (let index = 0; index < titles.length; index++) {
    const entry = manifest.documents[index], project = JSON.parse(await zip.file(entry.document).async('string'));
    assert.equal(project.title, titles[index], 'safe archive filenames must preserve the title inside each document');
    assert.equal(project.id, `project-${index}`);
    assert.ok(zip.file(entry.history));
  }
});

test('archive includes only documents, their histories and manifest, with no account, provider or vault secrets', async () => {
  const source = await fixture(), sentinel = { password: 'ACCOUNT-PASSWORD-DO-NOT-EXPORT', apiKey: 'PROVIDER-KEY-DO-NOT-EXPORT', token: 'SESSION-TOKEN-DO-NOT-EXPORT' };
  source.details.get(source.documents[0].id).settings = sentinel;
  const { zip } = await archive({ ...source, account: sentinel, settings: sentinel, documentPassphrase, recoveryKey: source.recoveryKey, vault: source.vault });
  const text = (await Promise.all(Object.values(zip.files).map(file => file.async('string')))).join('\n');
  for (const secret of [...Object.values(sentinel), documentPassphrase, source.recoveryKey, source.vault.wrappedKey.ciphertext, source.vault.recovery.ciphertext, userId]) assert.equal(text.includes(secret), false);
  assert.match(text, /Private author notes/); assert.match(text, /A private reference/); assert.match(text, /A private question/); assert.match(text, /An earlier checkpoint/);
});

test('Blob download publishes a complete valid ZIP only after all documents finish', async t => {
  const source = await fixture(['First', 'Second']), state = browser(t);
  const result = await exportLibrary(source);
  assert.equal(result.streamed, false); assert.equal(result.count, 2);
  assert.match(result.filename, /^WRAITER Library - \d{4}-\d{2}-\d{2}\.zip$/);
  assert.equal(state.blobs.length, 1); assert.equal(state.blobs[0].type, 'application/zip');
  assert.equal(state.links[0].clicks, 1); assert.equal(state.links[0].download, result.filename);
  const zip = await JSZip.loadAsync(await state.blobs[0].arrayBuffer(), { checkCRC32: true });
  assert.equal(JSON.parse(await zip.file('manifest.json').async('string')).documents.length, 2);
  assert.equal(state.timers.length, 1); state.timers[0](); assert.deepEqual(state.revoked, ['blob:archive-1']);
});

test('streamed save closes only after a complete ZIP and starts the picker before document requests', async t => {
  const source = await fixture(), calls = [], chunks = [];
  const state = browser(t, async options => {
    calls.push('picker'); assert.equal(options.types[0].accept['application/zip'][0], '.zip');
    return { createWritable: async () => ({ write: async chunk => { calls.push('write'); chunks.push(Buffer.from(chunk)); }, close: async () => calls.push('close'), abort: async () => calls.push('abort') }) };
  });
  const result = await exportLibrary({ ...source, loadDocument: async id => { calls.push('load'); return source.details.get(id); } });
  assert.equal(result.streamed, true); assert.deepEqual(calls.slice(0, 2), ['picker', 'load']);
  assert.equal(calls.at(-1), 'close'); assert.equal(calls.filter(call => call === 'close').length, 1); assert.ok(!calls.includes('abort'));
  assert.equal(state.links.length, 0); assert.equal(state.blobs.length, 0);
  const zip = await JSZip.loadAsync(Buffer.concat(chunks), { checkCRC32: true }); assert.ok(zip.file('manifest.json'));
});

test('cancelled picker and already aborted exports make no document requests or partial downloads', async t => {
  const source = await fixture(); let loads = 0;
  const state = browser(t, async () => { throw new DOMException('User cancelled', 'AbortError'); });
  await assert.rejects(exportLibrary({ ...source, loadDocument: async () => { loads++; } }), { name: 'AbortError' });
  delete window.showSaveFilePicker;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(exportLibrary({ ...source, signal: controller.signal, loadDocument: async () => { loads++; } }), { name: 'AbortError' });
  assert.equal(loads, 0); assert.equal(state.blobs.length, 0); assert.equal(state.links.length, 0);
});

test('cancellation after one document aborts a streamed temporary file instead of committing a partial ZIP', async t => {
  const source = await fixture(['First', 'Second']), controller = new AbortController(); let loads = 0, writes = 0, closes = 0, aborts = 0;
  const state = browser(t, async () => ({ createWritable: async () => ({ write: async () => writes++, close: async () => closes++, abort: async () => aborts++ }) }));
  await assert.rejects(exportLibrary({ ...source, signal: controller.signal,
    loadDocument: async id => { loads++; return source.details.get(id); },
    onProgress: ({ completed }) => { if (completed === 1) controller.abort(); }
  }), { name: 'AbortError' });
  assert.equal(loads, 1); assert.ok(writes > 0); assert.equal(closes, 0); assert.equal(aborts, 1); assert.equal(state.links.length, 0); assert.equal(state.blobs.length, 0);
});

test('a later request failure aborts a streamed temporary file and preserves the original error', async t => {
  const source = await fixture(['First', 'Second']), failure = new Error('Synthetic network failure'); let loads = 0, writes = 0, closes = 0, aborts = 0;
  browser(t, async () => ({ createWritable: async () => ({ write: async () => writes++, close: async () => closes++, abort: async () => { aborts++; throw new Error('Synthetic abort failure'); } }) }));
  await assert.rejects(exportLibrary({ ...source, loadDocument: async id => { if (++loads === 2) throw failure; return source.details.get(id); } }), error => error === failure);
  assert.equal(loads, 2); assert.ok(writes > 0); assert.equal(closes, 0); assert.equal(aborts, 1);
});

test('a later decryption failure or legacy document never publishes a partial Blob download', async t => {
  const source = await fixture(['First', 'Second']), state = browser(t);
  const secondId = source.documents[1].id;
  const original = source.details.get(secondId);
  source.details.set(secondId, { ...original, sealed: source.details.get(source.documents[0].id).sealed });
  await assert.rejects(exportLibrary(source), /could not be decrypted/);
  source.details.set(secondId, { id: secondId, legacy: true, project: manuscript('legacy'), journal: [] });
  await assert.rejects(exportLibrary(source), /Finish encrypting your library/);
  assert.equal(state.blobs.length, 0); assert.equal(state.links.length, 0);
});

test('invalid export prerequisites fail before fetching or writing any documents', async () => {
  const source = await fixture(); let loads = 0, writes = 0;
  const options = { ...source, loadDocument: async () => { loads++; } }, write = async () => { writes++; };
  await assert.rejects(writeLibraryArchive({ ...options, key: null }, write), /Unlock your document library/);
  await assert.rejects(writeLibraryArchive({ ...options, userId: '' }, write), /Unlock your document library/);
  await assert.rejects(writeLibraryArchive({ ...options, documents: [] }, write), /no documents/);
  await assert.rejects(writeLibraryArchive({ ...options, documents: new Array(32761) }, write), /too many documents/);
  assert.equal(loads, 0); assert.equal(writes, 0);
});
