import { SuggestionKind } from 'harper.js';

// Harper's full model analyzes sentence structure locally. Limit what it can
// flag: several default rules rewrite dialogue, proper names or valid prose.
const enabledRules = new Set(`SpellCheck Ado AnAnother AnotherAn AnotherThings CanBeSeen DespiteOf
  GetRidOf HavePassed WillContain HungerPang InOfItself InsteadOf LetAlone MootPoint WorseOrWorst
  FreeRein BatedBreath BareInMind BareWithMe BeckAndCall Haphazard HomeInOn OneFellSwoop
  JustDeserts NerveRacking OldWivesTale OneAndTheSame PiqueInterest RifeWith ScantilyClad
  SneakingSuspicion TakeItPersonally WhetYourAppetite WorstCaseScenario CorrectNumberSuffix
  ExplanationMark FirstAidKit FewUnitsOfTimeAgo InflectedVerbAfterTo GoingTo SpecialAttention
  DidPast ItsContraction ItsPossessive NounVerbConfusion RegularIrregulars
  SimplePastToPastParticiple SupposedTo ThenThan`.split(/\s+/u));

export async function configureHarper(linter) {
  const defaults = await linter.getDefaultLintConfig();
  await linter.setLintConfig(Object.fromEntries(Object.keys(defaults).map(name => [name, enabledRules.has(name)])));
}

const suggestionCaches = new WeakMap();
const wordKey = word => word.normalize('NFC').replaceAll('’', "'").toLocaleLowerCase('en');

// Generate common single-edit corrections against the same dictionary that
// accepts words. Unlike an unbounded distance-two search, this stays cheap for
// chapters with many unfamiliar character names. Only use this when Harper
// has too few usable suggestions, and keep Harper's ranked fixes first.
function dictionarySuggestions(dictionary, word) {
  if (!dictionary || !/^[A-Za-z]{2,32}$/u.test(word)) return [];
  let cache = suggestionCaches.get(dictionary);
  if (!cache) { cache = new Map(); suggestionCaches.set(dictionary, cache); }
  if (cache.has(word)) return cache.get(word);
  const found = [], seen = new Set([word]);
  const tryWord = candidate => {
    if (found.length >= 5 || seen.has(candidate)) return;
    seen.add(candidate);
    if (dictionary.correct(candidate)) found.push(candidate);
  };
  const alphabet = word === word.toUpperCase() ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i + 1 < word.length; i++) tryWord(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  for (let i = 0; i < word.length; i++) tryWord(word.slice(0, i) + word.slice(i + 1));
  for (let i = 0; i <= word.length && found.length < 5; i++) {
    for (const letter of alphabet) tryWord(word.slice(0, i) + letter + word.slice(i));
  }
  for (let i = 0; i < word.length && found.length < 5; i++) {
    for (const letter of alphabet) tryWord(word.slice(0, i) + letter + word.slice(i + 1));
  }
  if (cache.size >= 2048) cache.clear();
  cache.set(word, found);
  return found;
}

function useGrammarFinding(rule, original, following) {
  // “Did not found a city”, “its being late” and “it’s time to go” are valid.
  if (rule === 'DidPast' && /^found$/iu.test(original)) return false;
  if (rule === 'ItsContraction' && /^\s+being\b/iu.test(following)) return false;
  if (rule === 'ItsPossessive' && /^\s+time\b/iu.test(following)) return false;
  // Both words can be nouns and verbs, including “to effect a rescue” and
  // the clinical noun “affect”. Leave this pair to more specific rules.
  if (rule === 'NounVerbConfusion' && /^(?:affect|effect)(?:s|ed|ing)?$/iu.test(original)) return false;
  return true;
}

// Harper 2.x reports UTF-16 offsets. Require an exact match and never repair
// a bad range by searching for another occurrence of the same text.
export async function analyzeHarper(linter, text, dictionary, customWords = []) {
  const groups = await linter.organizedLints(text, { language: 'plaintext' });
  const hints = [], acceptedWords = new Set(customWords.map(wordKey));
  try {
    for (const [rule, lints] of Object.entries(groups)) {
      if (!enabledRules.has(rule)) continue;
      const isSpelling = rule === 'SpellCheck';
      for (const lint of lints) {
        const original = lint.get_problem_text();
        if (typeof original !== 'string' || !original || original.includes('\ufffc')) continue;
        const span = lint.span();
        const { start: from, end: to } = span;
        span.free?.();
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > text.length || text.slice(from, to) !== original) continue;
        if (isSpelling ? acceptedWords.has(wordKey(original)) || dictionary?.correct(original) : !useGrammarFinding(rule, original, text.slice(to))) continue;
        const alternatives = [], dictionaryBacked = [], seen = new Set();
        const suggestions = lint.suggestions();
        try {
          for (const suggestion of suggestions) {
            const kind = suggestion.kind(), added = suggestion.get_replacement_text();
            const value = kind === SuggestionKind.Remove ? '' : kind === SuggestionKind.InsertAfter ? original + added : added;
            if (typeof value !== 'string' || value === original || value.length > 1000 || /[\r\n\0\ufffc]/u.test(value) || seen.has(value)) continue;
            if (isSpelling && (!value || /\s/u.test(value))) continue;
            seen.add(value);
            if (isSpelling && dictionary?.correct(value)) dictionaryBacked.push(value);
            else alternatives.push(value);
          }
        } finally { for (const suggestion of suggestions) suggestion.free?.(); }
        if (isSpelling && dictionary) {
          const fallback = dictionaryBacked.length < 3 ? dictionarySuggestions(dictionary, original) : [];
          alternatives.unshift(...dictionaryBacked, ...fallback.filter(value => !seen.has(value)));
        }
        const choices = alternatives.slice(0, 5);
        hints.push({ from, to, original, replacement: choices[0] ?? null, alternatives: choices,
          reason: lint.message(), category: isSpelling ? 'spelling' : 'grammar', rule: isSpelling ? 'harper:spelling' : `harper:${rule}` });
      }
    }
  } finally { for (const lints of Object.values(groups)) for (const lint of lints) lint.free?.(); }
  return hints;
}
