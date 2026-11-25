import test from 'node:test';
import assert from 'node:assert/strict';
import { grammarExceptionStore } from '../electron/grammar-exceptions.mjs';
import { nativeSpellingDictionary } from '../electron/personal-spelling.mjs';
import { grammarDismissal } from '../src/grammar-dismissal.js';
import { sealGrammarDictionary, openGrammarDictionary } from '../src/cloud-vault.js';
import { createBrowserAdapter } from '../src/web/adapter.js';

const suggestion = (original, replacement, language = 'en-US') => ({
  language, original, replacement, rule: 'wraiter', reason: 'Check this wording.'
});

test('saved exceptions preserve the proposed edit, scope and language after a restart', async () => {
  let disk = null;
  const open = () => grammarExceptionStore({ read: () => disk, write: json => { disk = json; } });
  const store = open(), hint = suggestion('had ', '');
  const [entry] = await store.add(hint);
  assert.equal(entry.key, grammarDismissal({ ...hint, from: 0, to: 4, category: 'grammar' }).key);
  await Promise.all([
    store.add({ ...hint, original: 'had', rule: 'other', language: 'en-GB' }),
    store.add(suggestion('had', 'has')), store.add(suggestion('had', '', 'sv-SE'))
  ]);
  assert.equal((await open().list()).length, 3);
  await store.edit(entry, suggestion('had', 'has'));
  assert.deepEqual((await open().list()).map(e => [e.language, e.replacement]), [['en', 'has'], ['sv', '']]);
  await assert.rejects(store.edit(entry, suggestion('another', 'word')), /already changed/);
  await store.remove((await store.list())[0]);
  assert.deepEqual((await open().list()).map(e => e.language), ['sv']);
});

test('invalid changes and failed or malformed storage preserve existing data', async () => {
  let disk = null, fail = false;
  const store = grammarExceptionStore({
    read: () => disk,
    write: json => { if (fail) throw new Error('disk full'); disk = json; }
  });
  const [existing] = await store.add(suggestion('red', 'read'));
  const saved = disk;
  await assert.rejects(store.add(suggestion('', 'read')), /Choose/);
  await assert.rejects(store.add({ ...suggestion('red', 'read'), category: 'spelling' }), /Choose/);
  fail = true;
  await assert.rejects(store.edit(existing, suggestion('read', 'red')), /disk full/);
  assert.equal(disk, saved);
  disk = '{';
  await assert.rejects(store.remove(existing));
  assert.equal(disk, '{');
});

test('native spelling edits preserve legacy words, merge duplicates and roll back failed writes', async () => {
  const saved = new Set(['R2-D2', 'Tess']);
  let failRemove = false;
  const store = nativeSpellingDictionary({
    listWordsInSpellCheckerDictionary: async () => [...saved],
    addWordToSpellCheckerDictionary(word) { if (word === 'Denied') return false; saved.add(word); return true; },
    removeWordFromSpellCheckerDictionary(word) {
      if (word === 'R2-D2' && failRemove) return false;
      return saved.delete(word);
    }
  });
  await assert.rejects(store.edit('R2-D2', 'Denied'));
  assert.ok(saved.has('R2-D2'));
  failRemove = true;
  await assert.rejects(store.edit('R2-D2', 'Tess'));
  await assert.rejects(store.edit('R2-D2', 'Aldric'));
  assert.deepEqual(await store.list(), ['R2-D2', 'Tess']);
  failRemove = false;
  await store.edit('R2-D2', 'Tess');
  await Promise.all([store.add('Aldric'), store.remove('Tess')]);
  assert.deepEqual(await store.list(), ['Aldric']);
});

test('web grammar phrases stay encrypted and can only be opened for their account', async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const text = JSON.stringify([suggestion('Two gates', 'Two Gates')]);
  const sealed = await sealGrammarDictionary(key, 'author-one', text);
  assert.ok(!JSON.stringify(sealed).includes('gates'));
  assert.equal(await openGrammarDictionary(key, 'author-one', sealed), text);
  await assert.rejects(openGrammarDictionary(key, 'author-two', sealed));
});

test('browser dictionary survives reopening and applying the surrounding Settings draft', async t => {
  const boxes = new Map();
  const storage = { getItem: key => boxes.get(key) ?? null, setItem: (key, value) => boxes.set(key, value) };
  const events = new EventTarget();
  let settings = { personalDictionary: ['Aldric'] };
  const server = async (path, options) => {
    assert.equal(path, '/api/settings');
    assert.equal(options.method, 'PUT');
    settings = JSON.parse(options.body);
    return Response.json(settings);
  };
  for (const [name, value] of Object.entries({ window: events, localStorage: storage, fetch: server })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const open = () => createBrowserAdapter({ user: { id: 'author' }, vaultKey, settings });
  const first = open(), draft = { ...settings, theme: 'dark' };
  await first.updateOfflineDictionaryWord('Aldric', 'Alderburg');
  await first.addOfflineDictionaryWord('Eldrak');
  await first.removeOfflineDictionaryWord('Eldrak');
  await first.settings(draft);
  assert.deepEqual(settings.personalDictionary, ['Alderburg']);
  assert.equal(settings.theme, 'dark');
  const [entry] = await first.addPersonalGrammarException(suggestion('had ', ''));
  const second = open();
  assert.deepEqual(await second.offlineDictionaryWords(), ['Alderburg']);
  assert.deepEqual(await second.personalGrammarExceptions(), [entry]);
  await second.updatePersonalGrammarException(entry, suggestion('has ', ''));
  let changes = 0;
  first.onPersonalGrammarExceptionsChanged(() => { changes++; });
  const announce = key => events.dispatchEvent(Object.assign(new Event('storage'), { key, storageArea: storage }));
  announce('wraiter-grammar-exceptions:other-author');
  assert.equal(changes, 0);
  announce('wraiter-grammar-exceptions:author');
  assert.equal(changes, 1);
  const [edited] = await first.personalGrammarExceptions();
  assert.equal(edited.original, 'has ');
  await second.removePersonalGrammarException(edited);
  assert.deepEqual(await first.personalGrammarExceptions(), []);
  first.dispose();
  announce('wraiter-grammar-exceptions:author');
  assert.equal(changes, 1);
  second.dispose();
});
