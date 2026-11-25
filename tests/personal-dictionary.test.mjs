import test from 'node:test';
import assert from 'node:assert/strict';
import { grammarExceptionStore } from '../electron/grammar-exceptions.mjs';
import { grammarDismissal } from '../src/grammar-dismissal.js';
import { sealGrammarDictionary, openGrammarDictionary } from '../src/cloud-vault.js';

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

test('web grammar phrases stay encrypted and can only be opened for their account', async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const text = JSON.stringify([suggestion('Two gates', 'Two Gates')]);
  const sealed = await sealGrammarDictionary(key, 'author-one', text);
  assert.ok(!JSON.stringify(sealed).includes('gates'));
  assert.equal(await openGrammarDictionary(key, 'author-one', sealed), text);
  await assert.rejects(openGrammarDictionary(key, 'author-two', sealed));
});
