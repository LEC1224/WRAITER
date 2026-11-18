import { dialogueLookup } from './grammar-dialogue.js';

// Keep ordinary grammar checks in dialogue, while leaving recognizable
// informal verb forms and optional style distinctions to the author.
export function grammarVoiceFilter(text) {
  const inDialogue = dialogueLookup(text);
  return hint => {
    if (hint.rule === 'lt:FEWER_LESS') return false;
    if (hint.category === 'spelling') return true;
    const clause = text.slice(Math.max(0, hint.from - 24), hint.to).replaceAll('’', "'").toLowerCase();
    if (!/\b(?:(?:we|you|they)\s+was|(?:i|you|we|they|he|she)\s+(?:done|seen)|(?:he|she|it)\s+don't)$/u.test(clause)) return true;
    // Multiple engines can return hundreds of findings in a single long
    // paragraph. Index its quotation marks once, including unmatched quotes.
    return !inDialogue(hint.from);
  };
}

export function keepGrammarHint(text, hint) {
  return grammarVoiceFilter(text)(hint);
}

