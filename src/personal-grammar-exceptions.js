// The desktop bridge lives for the window's lifetime. A browser login creates
// a new adapter, so each account gets its own cache and subscriptions.
const profiles = new WeakMap();
const offline = {};

function profile() {
  const api = globalThis.window?.wraiter || offline;
  if (!profiles.has(api)) {
    const state = { api, keys: new Map(), entries: null, listeners: new Set(), loading: null, updates: Promise.resolve() };
    profiles.set(api, state);
    // A manuscript in another browser window shares this account's dictionary.
    api.onPersonalGrammarExceptionsChanged?.(() => update(state, api => api.personalGrammarExceptions()).catch(() => {}));
  }
  return profiles.get(api);
}

function publish(state, entries) {
  if (!Array.isArray(entries)) throw new Error('Could not read the personal grammar exceptions.');
  const keys = new Map();
  for (const entry of entries) {
    if (!keys.has(entry.language)) keys.set(entry.language, new Set());
    keys.get(entry.language).add(entry.key);
  }
  state.entries = entries;
  state.keys = keys;
  for (const listener of state.listeners) listener(entries);
  return entries;
}

export function subscribeGrammarExceptions(listener) {
  const { listeners } = profile();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function grammarExceptionKeys(language) {
  return profile().keys.get(language.toLowerCase().split('-')[0]);
}

export function loadGrammarExceptions() {
  const state = profile();
  if (state.entries) return Promise.resolve(state.entries);
  if (!state.loading) {
    state.loading = Promise.resolve().then(() => state.api.personalGrammarExceptions?.() ?? [])
      .then(entries => state.entries ?? publish(state, entries))
      .finally(() => { state.loading = null; });
  }
  return state.loading;
}

function update(state, action) {
  const request = state.updates.then(() => action(state.api)).then(entries => publish(state, entries));
  state.updates = request.catch(() => {});
  return request;
}

export function addGrammarException(language, hint) {
  if (hint.category !== 'grammar') return Promise.reject(new Error('Choose a local grammar suggestion.'));
  const { original, replacement, rule, reason } = hint;
  return update(profile(), api => api.addPersonalGrammarException({ language, original, replacement, rule, reason }));
}

export function removeGrammarException({ language, key }) {
  return update(profile(), api => api.removePersonalGrammarException({ language, key }));
}

export function updateGrammarException({ language, key }, entry) {
  return update(profile(), api => api.updatePersonalGrammarException({ language, key }, entry));
}
