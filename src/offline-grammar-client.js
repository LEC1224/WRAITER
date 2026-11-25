import { passageQueue } from './grammar-passage-queue.js';

// A single shared worker prevents a second 20 MB grammar engine from being
// loaded for every chapter or multitask pane.
let worker, nextId = 0, dictionaryVersion = 0;
const waiting = new Map();
const profiles = new WeakMap(), offline = {};

const basicQueue = passageQueue(), deepQueue = passageQueue();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./offline-grammar-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = event => {
    const { id, results, error, cancelled } = event.data || {}, request = waiting.get(id);
    if (!request) return;
    waiting.delete(id);
    if (cancelled) request.reject(new DOMException('Grammar check cancelled.', 'AbortError'));
    else if (error) request.reject(new Error(error)); else request.resolve(results);
  };
  worker.onerror = event => {
    const error = new Error(event.message || 'The offline checker could not start.');
    for (const request of waiting.values()) request.reject(error);
    waiting.clear(); worker?.terminate(); worker = undefined;
  };
  return worker;
}

export function currentDictionaryVersion() { return dictionaryVersion; }
function dictionaryProfile() {
  const api = globalThis.window?.wraiter || offline;
  if (!profiles.has(api)) {
    const state = { api, listeners: new Set(), reading: null, updates: Promise.resolve() };
    profiles.set(api, state);
    // Chromium can also add a word directly from its native spelling menu.
    api.onOfflineDictionaryChanged?.(() => queueDictionaryUpdate(state).catch(() => {}));
  }
  return profiles.get(api);
}
export function subscribeDictionary(listener) {
  const { listeners } = dictionaryProfile();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function readDictionary(state) {
  if (!state.reading) {
    const request = Promise.resolve().then(() => state.api.offlineDictionaryWords?.() ?? []).then(words => {
      if (!Array.isArray(words)) throw new Error('Could not read the personal dictionary.');
      return [...new Set(words.filter(word => typeof word === 'string'))];
    });
    state.reading = request;
    request.catch(() => { if (state.reading === request) state.reading = null; });
  }
  return state.reading;
}
export function personalDictionary() {
  const state = dictionaryProfile();
  return state.updates.then(() => readDictionary(state));
}
function queueDictionaryUpdate(state, change) {
  const request = state.updates.then(change).then(async () => {
    state.reading = null;
    const words = await readDictionary(state);
    dictionaryVersion++;
    for (const listener of state.listeners) listener(words);
    return words;
  });
  state.updates = request.catch(() => {});
  return request;
}
function changeDictionaryWord(command, ...args) {
  const state = dictionaryProfile();
  return queueDictionaryUpdate(state, async () => {
    if (!state.api[command]) throw new Error('The personal dictionary is unavailable.');
    if (!await state.api[command](...args)) throw new Error('Could not update the personal dictionary.');
  });
}
export function addPersonalWord(word) { return changeDictionaryWord('addOfflineDictionaryWord', word); }
export function updatePersonalWord(previous, word) { return changeDictionaryWord('updateOfflineDictionaryWord', previous, word); }
export function removePersonalWord(word) { return changeDictionaryWord('removeOfflineDictionaryWord', word); }
export function checkOffline(texts, language, version, signal) {
  return basicQueue(signal, async () => {
    const words = await personalDictionary().catch(() => []);
    signal?.throwIfAborted();
    const target = getWorker(), id = ++nextId;
    const cancel = () => { if (target === worker && waiting.has(id)) target.postMessage({ cancel: id }); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        target.postMessage({ id, texts, language, words, dictionaryVersion: version });
      });
    } finally { waiting.delete(id); signal?.removeEventListener('abort', cancel); }
  });
}

export function checkAdvancedOffline(texts, language, signal) {
  return deepQueue(signal, () => advancedResults(texts, language, signal));
}

async function advancedResults(texts, language, signal) {
  if (!globalThis.window?.wraiter?.offlineGrammar) throw new Error('The expanded local grammar engine is unavailable.');
  const safe = texts.map(text => text.replace(/[\p{L}\p{N}_]{128,}/gu, word => '\ufffc'.repeat(word.length)));
  const batches = await globalThis.window.wraiter.offlineGrammar({ texts: safe, language });
  signal?.throwIfAborted();
  if (!Array.isArray(batches) || batches.length !== texts.length) throw new Error('The expanded local grammar engine returned an invalid result.');
  return batches.map((items, index) => {
    if (!Array.isArray(items)) return [];
    return items.filter(hint => Number.isInteger(hint?.from) && Number.isInteger(hint?.to) && hint.from >= 0 && hint.to > hint.from && hint.to <= texts[index].length &&
      typeof hint.original === 'string' && texts[index].slice(hint.from, hint.to) === hint.original && !hint.original.includes('\ufffc') &&
      typeof hint.replacement === 'string' && Array.isArray(hint.alternatives) && hint.alternatives.length <= 5 && hint.alternatives.every(value => typeof value === 'string' && value.length <= 1000 && !/[\r\n\0\ufffc]/u.test(value)) &&
      typeof hint.reason === 'string' && typeof hint.rule === 'string').map(hint => ({ ...hint, category: 'grammar', reason: hint.reason.slice(0, 1000), rule: hint.rule.slice(0, 150) }));
  });
}
