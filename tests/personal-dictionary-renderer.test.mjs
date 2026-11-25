import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { grammarExceptionStore } from '../electron/grammar-exceptions.mjs';
import { documentGrammar } from '../src/local-grammar.js';
import { addGrammarException, loadGrammarExceptions, removeGrammarException, updateGrammarException } from '../src/personal-grammar-exceptions.js';
import { addPersonalWord, currentDictionaryVersion, personalDictionary, removePersonalWord, subscribeDictionary, updatePersonalWord } from '../src/offline-grammar-client.js';

function useBridge(t, bridge) {
  const original = globalThis.window;
  globalThis.window = { wraiter: bridge };
  t.after(() => { if (original) globalThis.window = original; else delete globalThis.window; });
}

function grammarBridge() {
  let disk = null;
  const store = grammarExceptionStore({ read: () => disk, write: json => { disk = json; } });
  return {
    personalGrammarExceptions: store.list, addPersonalGrammarException: store.add,
    updatePersonalGrammarException: store.edit, removePersonalGrammarException: store.remove
  };
}

test('cached manuscript hints update when an exception changes language, correction or profile', async t => {
  const first = grammarBridge();
  useBridge(t, first);
  const doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('They is ready. We is here. I is tired.')));
  const corrections = (lang = 'en-US') => documentGrammar(doc, lang).map(hint => hint.replacement);
  assert.deepEqual(corrections(), ['are', 'are', 'am']);
  const hint = documentGrammar(doc)[0];
  const [entry] = await addGrammarException('en-US', hint);
  assert.deepEqual(corrections('en-GB'), ['am']);
  const [swedish] = await updateGrammarException(entry, { ...entry, language: 'sv' });
  assert.deepEqual(corrections(), ['are', 'are', 'am']);
  const entries = await updateGrammarException(swedish, { ...entry, replacement: 'am' });
  assert.deepEqual(corrections(), ['are', 'are']);
  globalThis.window.wraiter = grammarBridge();
  assert.deepEqual(await loadGrammarExceptions(), []);
  assert.deepEqual(corrections(), ['are', 'are', 'am']);
  globalThis.window.wraiter = first;
  assert.deepEqual(corrections(), ['are', 'are']);
  await removeGrammarException(entries[0]);
  assert.deepEqual(corrections(), ['are', 'are', 'am']);
});

test('a delayed initial exception read cannot restore hints suppressed by a later save', async t => {
  const bridge = grammarBridge();
  let resolveList;
  bridge.personalGrammarExceptions = () => new Promise(resolve => { resolveList = resolve; });
  useBridge(t, bridge);
  const initial = loadGrammarExceptions();
  await Promise.resolve();
  const entries = await addGrammarException('en', { category: 'grammar', original: 'is', replacement: 'are', rule: 'test', reason: '' });
  resolveList([]);
  assert.deepEqual(await initial, entries);
  await assert.rejects(addGrammarException('en', { category: 'spelling' }));
  assert.deepEqual(await loadGrammarExceptions(), entries);
});

test('a change from another browser window updates already cached manuscript hints', async t => {
  const bridge = grammarBridge();
  let externalChange;
  bridge.onPersonalGrammarExceptionsChanged = listener => { externalChange = listener; };
  useBridge(t, bridge);
  const doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('The the gate opened.')));
  const [hint] = documentGrammar(doc);
  await loadGrammarExceptions();
  const [entry] = await bridge.addPersonalGrammarException({ ...hint, language: 'en' });
  await externalChange();
  assert.deepEqual(documentGrammar(doc), []);
  await bridge.removePersonalGrammarException(entry);
  await externalChange();
  assert.equal(documentGrammar(doc).length, 1);
});

test('native menu adds and concurrent word edits refresh the word list and spelling caches', async t => {
  const words = new Set(['OldWord']), snapshots = [];
  let nativeChange;
  useBridge(t, {
    offlineDictionaryWords: () => [...words],
    onOfflineDictionaryChanged: listener => { nativeChange = listener; },
    addOfflineDictionaryWord(word) { words.add(word); return true; },
    updateOfflineDictionaryWord(before, after) { if (!words.delete(before)) return false; words.add(after); return true; },
    removeOfflineDictionaryWord: word => words.delete(word)
  });
  t.after(subscribeDictionary(entries => snapshots.push(entries)));
  const version = currentDictionaryVersion();
  assert.deepEqual(await personalDictionary(), ['OldWord']);
  words.add('NativeWord');
  nativeChange();
  assert.deepEqual(await personalDictionary(), ['OldWord', 'NativeWord']);
  await Promise.all([addPersonalWord('NewWord'), updatePersonalWord('NewWord', 'Renamed'), removePersonalWord('Renamed')]);
  assert.deepEqual(snapshots.map(list => list.at(-1)), ['NativeWord', 'NewWord', 'Renamed', 'NativeWord']);
  await assert.rejects(removePersonalWord('Missing'));
  assert.equal(currentDictionaryVersion(), version + 4);
  assert.deepEqual(await personalDictionary(), ['OldWord', 'NativeWord']);
  globalThis.window.wraiter = { offlineDictionaryWords: () => ['OtherProfile'] };
  assert.deepEqual(await personalDictionary(), ['OtherProfile']);
});
