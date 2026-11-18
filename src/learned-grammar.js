import { generateGrammarCandidates, scoreGrammarCandidate } from './grammar-model.js';
import model from './grammar-model-weights.js';

const reasons = {
  'local-number-agreement': 'Check whether the verb agrees with the subject.',
  'demonstrative-number': 'Check the singular or plural form after this determiner.',
  'subject-case': 'Use the subject form of this pronoun here.',
  'contextual-homophone': 'Check this word in the surrounding sentence.',
  'manner-form': 'Use an adverb to describe the action here.',
  'finite-verb-form': 'Check the past-tense form of this verb.',
  agreement: 'Check whether the verb agrees with its subject.',
  'noun-agreement': 'Check whether the verb agrees with its subject.',
  participle: 'Use the past participle with this auxiliary verb.',
  'base-form': 'Use the base form of the verb here.',
  'regular-base-form': 'Use the base form of the verb in this infinitive.',
  'mass-noun': 'This noun is usually uncountable in this context.',
  countability: 'Check the quantity expression with this uncountable noun.',
  'quantified-noun': 'Use a plural noun after this quantity.',
  'indirect-question-order': 'Use statement word order inside an indirect question.',
  'perfect-finished-time': 'A finished time like this usually takes the simple past.',
  'relative-subject': 'The relative pronoun already serves as the subject here.'
};

export function learnedGrammarHints(text, language) {
  if (!/^en(?:-|$)/iu.test(language)) return [];
  const hints = [];
  for (const candidate of generateGrammarCandidates(text)) {
    const { from, to, original, replacement, category } = candidate;
    const reason = reasons[category];
    const threshold = model.thresholds[category];
    if (!reason || threshold == null || scoreGrammarCandidate(candidate, model) < threshold) continue;
    hints.push({ from, to, original, replacement, reason, alternatives: [replacement], category: 'grammar', rule: 'learned:' + category });
  }
  return hints;
}

