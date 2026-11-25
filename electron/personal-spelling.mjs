export function validateNewWord(word) {
  if (typeof word !== 'string' || word.length > 100 || !/^\p{L}+(?:[’'-]\p{L}+)*$/u.test(word)) {
    throw new Error('Choose a single word to add to the dictionary.');
  }
}

// Chromium and earlier app versions can supply entries outside the current
// input rules. Validate the new word, but accept any exact saved word as the
// source of a rename or removal.
export function updateWordList(words, previous, next) {
  if (previous === null && next === null) throw new Error('Choose a dictionary word.');
  if (next !== null) validateNewWord(next);
  if (previous !== null && (typeof previous !== 'string' || !words.includes(previous))) {
    throw new Error('This word is no longer in the dictionary. Refresh the list.');
  }
  if (previous === next) return words;
  const updated = words.filter(word => word !== previous);
  if (next !== null && !updated.includes(next)) updated.push(next);
  return updated;
}

export function nativeSpellingDictionary(session) {
  let pending = Promise.resolve();
  function change(previous, next) {
    const result = pending.then(async () => {
      const words = await session.listWordsInSpellCheckerDictionary();
      updateWordList(words, previous, next);
      if (previous === next) return true;
      const needsAdd = next !== null && !words.includes(next);
      if (needsAdd && !session.addWordToSpellCheckerDictionary(next)) throw new Error('Could not save the new dictionary word.');
      if (previous !== null && !session.removeWordFromSpellCheckerDictionary(previous)) {
        // Never remove an existing target when rolling back a failed rename.
        if (needsAdd && !session.removeWordFromSpellCheckerDictionary(next)) {
          throw new Error('Both words are still in the dictionary. Refresh the list and try again.');
        }
        throw new Error('Could not remove the saved dictionary word.');
      }
      return true;
    });
    pending = result.catch(() => {});
    return result;
  }
  return {
    list: () => pending.then(() => session.listWordsInSpellCheckerDictionary()),
    add: word => change(null, word), remove: word => change(word, null),
    edit(previous, next) {
      if (typeof previous !== 'string') throw new Error('Choose the saved word to edit.');
      validateNewWord(next);
      return change(previous, next);
    }
  };
}
