import { grammarDismissal } from '../src/grammar-dismissal.js';

const maximumEntries = 1000;
export const maximumExceptionBytes = 1024 * 1024;

function languageOf(language) {
  if (typeof language !== 'string' || !/^(?:en|sv)(?:-[a-z0-9]{1,8})*$/i.test(language)) {
    throw new Error('Choose a supported grammar language.');
  }
  return language.split('-')[0].toLowerCase();
}

function textField(value, limit) {
  return typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000a-\u001f\u007f]/u.test(value);
}

function entryFor(value) {
  const { language, original, replacement, rule, reason } = value || {};
  if (!textField(original, 3500) || !original.length || !(replacement === null || textField(replacement, 3500)) ||
      !textField(rule, 256) || !rule || !textField(reason, 2000) || (replacement === null && !reason) ||
      (value.category && value.category !== 'grammar')) {
    throw new Error('Choose a local grammar suggestion to save as an exception.');
  }
  const { key } = grammarDismissal({ from: 0, to: original.length, category: 'grammar', original, replacement, rule, reason });
  return { language: languageOf(language), original, replacement, rule, reason, key };
}

function findEntry(entries, identity) {
  const language = languageOf(identity?.language);
  if (typeof identity.key !== 'string' || !identity.key) throw new Error('Choose a saved grammar exception.');
  return entries.findIndex(item => item.language === language && item.key === identity.key);
}

// The serialized dictionary contains only display fields. Derive every key
// from the actual edit, including after a restart or a changed matching rule.
export function grammarExceptionStore({ read, write, lock }) {
  let pending = Promise.resolve();
  async function list() {
    const json = await read();
    if (json === null) return [];
    const values = JSON.parse(json);
    if (!Array.isArray(values) || values.length > maximumEntries) throw new Error('The grammar dictionary could not be read.');
    return values.map(entryFor);
  }
  function update(change) {
    const run = async () => {
      const existing = await list();
      const updated = change(existing);
      if (updated !== existing) {
        const json = JSON.stringify(updated.map(({ key, ...fields }) => fields));
        if (updated.length > maximumEntries || new TextEncoder().encode(json).length > maximumExceptionBytes) {
          throw new Error('Your grammar dictionary is full. Remove an exception to make room.');
        }
        await write(json);
      }
      return updated;
    };
    const result = pending.then(() => lock ? lock(run) : run());
    pending = result.catch(() => {});
    return result;
  }
  return {
    list: () => pending.then(list),
    add(value) {
      return update(entries => {
        const entry = entryFor(value);
        return entries.some(item => item.language === entry.language && item.key === entry.key) ? entries : [...entries, entry];
      });
    },
    remove(value) {
      return update(entries => {
        const index = findEntry(entries, value);
        return index === -1 ? entries : entries.filter((_, i) => i !== index);
      });
    },
    edit(previous, value) {
      return update(entries => {
        const index = findEntry(entries, previous);
        if (index === -1) throw new Error('This grammar exception has already changed. Refresh the dictionary.');
        const entry = entryFor(value);
        return entries.map((item, i) => i === index ? entry : item)
          .filter((item, i) => i === index || item.language !== entry.language || item.key !== entry.key);
      });
    }
  };
}
