import { syntaxCandidates } from './grammar-model-syntax.js';
import { relativeCandidates } from './grammar-model-relative.js';
import { coverageCandidates } from './grammar-model-coverage.js';

// Candidate generation is deliberately separate from scoring. All offsets use
// JavaScript UTF-16 indices, matching the editor and String.slice.
const WORD = /[\p{L}]+(?:['’][\p{L}]+)*/gu;
const AGREEMENT = {
  'i': { is: 'am', are: 'am', has: 'have', does: 'do' },
  'you': { is: 'are', am: 'are', has: 'have', does: 'do' },
  'he': { are: 'is', am: 'is', have: 'has', do: 'does' },
  'she': { are: 'is', am: 'is', have: 'has', do: 'does' },
  'it': { are: 'is', am: 'is', have: 'has', do: 'does' },
  'we': { is: 'are', am: 'are', has: 'have', does: 'do' },
  'they': { is: 'are', am: 'are', has: 'have', does: 'do' }
};
const PARTICIPLES = { went: 'gone', saw: 'seen', ate: 'eaten', took: 'taken', gave: 'given', wrote: 'written', broke: 'broken', spoke: 'spoken', did: 'done', knew: 'known', drank: 'drunk', ran: 'run', began: 'begun', came: 'come' };
const BASE = { went: 'go', saw: 'see', ate: 'eat', took: 'take', gave: 'give', wrote: 'write', broke: 'break', spoke: 'speak', did: 'do', knew: 'know', drank: 'drink', ran: 'run', began: 'begin', came: 'come', gone: 'go', seen: 'see', eaten: 'eat', taken: 'take', given: 'give', written: 'write', broken: 'break', spoken: 'speak', done: 'do', known: 'know', drunk: 'drink', begun: 'begin' };
const UNCOUNTABLE = new Set(['advice', 'information', 'furniture', 'equipment', 'luggage', 'baggage', 'homework', 'knowledge', 'evidence', 'research', 'traffic']);
// Closed vocabularies keep noun-number guesses from treating verbs or names as nouns.
const COUNT_NOUNS = new Set('book key cabinet box shelf drawer basket lock bottle door window table chair apple idea question answer problem person child dog cat friend student teacher visitor room house car tree letter word day year story captain sailor song scent rose sound footstep shadow keeper queen island stable edge cliff color leaf leader guard floor cellar room balcony corner end watch tower mountain valley orchard market report document bag bottle cup piece mistake example reason result change rule plan task file page hand eye foot man woman lantern lamp candle torch tower bridge gate pier dock quay stair step wall hall corridor passage tunnel shelf crate chest map compass rope sail ship boat beam chain bell wheel bench coat watch clock mirror portrait sword shield guard sailor dancer messenger horse wagon cart barrel sack pouch coin stone arch shutter hinge railing branch fence field yard garden tent village station platform building roof road path trail track fence jar vase carpet curtain spool thread needle hook nail tool'.split(' '));
const IRREGULAR_PLURAL = { people: 'person', children: 'child', men: 'man', women: 'woman', feet: 'foot' };
for (const noun of 'brother sister mother father uncle aunt cousin parent grandparent soldier scout traveler traveller hunter farmer baker carpenter clerk servant master mistress cook keeper priest king queen prince princess twin crowd group team family class committee owner manager wolf fox raven crow eagle owl bird cat kitten puppy lion tiger bear rabbit hare mouse rat deer sheep fish goose duck swan insect ant bee butterfly flower rose lily leaf branch root seed feather wing paw tail tooth bone skin footprint ring glove boot shoe sock sleeve pocket belt cloak scarf hat cap helmet crown buckle strap saddle rein blanket quilt pillow towel curtain sheet cloth ribbon thread needle dagger spear axe arrow bow shield staff rod stick handle blade point edge tip stump trunk bush hedge stream river lake pond sea ocean shore beach valley hill plain peak canyon cliff cave den nest web cobweb cloud storm snow rain ice fire flame ember smoke spark ash loaf bread apple pear berry nut meal feast dish bottle glass jar jug kettle pot pan tray chest drawer wardrobe cupboard stool armchair couch rug carpet bed cot bunk mattress frame nail screw pin peg page cover volume journal diary manuscript newspaper envelope parcel package poster notice label sign flag banner ticket passenger rider driver conductor pilot surgeon doctor nurse patient patient visitor guest host pupil apprentice instructor professor lesson speech phrase sentence clause paragraph poem line verse note tune song melody rhythm beat minute hour night morning evening afternoon season century journey voyage trip mile yard inch pound ounce dozen pair set row pile stack bundle load heap bunch cluster pack herd flock swarm crew army band troop lock latch bolt hinge lever switch button panel dial pipe wire cable chain gear spring wheel axle engine motor carriage cart chariot saddle stirrup bridle stable barn shed hut cottage mansion palace temple church chapel abbey monastery inn tavern bakery forge prison cell dungeon chamber attic balcony porch veranda lobby vestibule landing staircase stairwell flight pavement lane alley avenue highway crossroads clearing grove wood forest jungle marsh meadow pasture orchard vineyard harbor harbour port landing quay jetty wharf shipyard vessel ferry canoe raft barge yacht wreck mast sail oar anchor rudder hull deck prow stern cabin mast spar plank board timber log beam pillar column arch spire dome wall turret rampart moat ditch trench tunnel passage entrance exit opening crack hole gap crevice slit groove slot niche alcove nook' .split(' ')) COUNT_NOUNS.add(noun);
const PREPOSITIONS = new Set(['of', 'in', 'on', 'near', 'behind', 'under', 'beside', 'inside', 'outside', 'with', 'by', 'for', 'from', 'at', 'to']);
const DETERMINERS = new Set(['the', 'these', 'those', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'a', 'an', 'each', 'every']);
const QUANTIFIERS = new Set(['many', 'several', 'few', 'dozen', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']);
const MASS_UNIT = { advice: 'pieces', information: 'pieces', furniture: 'pieces', equipment: 'pieces', luggage: 'pieces', baggage: 'pieces', homework: 'assignments' };
const CLAUSE_STARTERS = new Set(['and', 'but', 'because', 'when', 'while', 'if', 'that', 'although']);
const FINITE = new Set(['is', 'was', 'are', 'were', 'has', 'have', 'had', 'does', 'do', 'did']);
const AMBIGUOUS_NUMBER = new Set('family crew group crowd team committee class army band herd flock pack swarm pair deer sheep fish'.split(' '));
const PHRASE_MODIFIERS = new Set('old young new small large little big red blue green black white gray grey silver golden wooden iron stone tall short narrow wide dark bright broken empty full lost missing heavy light strange quiet distant nearest next last first second third northern southern eastern western open closed local familiar ancient ruined solitary hungry tired frightened weary useful practical valuable spare helpful important useless large tiny enormous massive huge good bad great fine poor beautiful careful sudden rough smooth cold warm hot cool wet dry clean dirty sharp dull long short thick thin early late remaining other extra additional entire whole complete odd curious secret hidden silent spare soft hard recent previous ordinary unusual sturdy fragile useful young'.split(' '));
const AMBIGUOUS_COUNT = new Set('set read change watch guard plan report task cover lock hand head eye face brush turn light guide show work rest sail step mark sound place state dress play train block spring time fire corner dozen hundred thousand million billion'.split(' '));
function plural(noun) {
  if (noun === 'person') return 'people';
  if (noun === 'child') return 'children';
  if (noun === 'man') return 'men';
  if (noun === 'woman') return 'women';
  if (noun === 'foot') return 'feet';
  if (noun === 'shelf') return 'shelves';
  if (noun === 'leaf') return 'leaves';
  if (noun === 'wolf') return 'wolves';
  if (noun === 'knife') return 'knives';
  if (noun === 'mouse') return 'mice';
  if (noun === 'goose') return 'geese';
  if (noun === 'tooth') return 'teeth';
  if (['deer', 'sheep', 'fish'].includes(noun)) return noun;
  if (noun.endsWith('y') && !/[aeiou]y$/.test(noun)) return noun.slice(0, -1) + 'ies';
  if (/(?:s|x|ch|sh)$/.test(noun)) return noun + 'es';
  return noun + 's';
}
const PLURAL_NOUNS = new Map([...COUNT_NOUNS].map(noun => [plural(noun), noun]));
for (const [form, noun] of Object.entries(IRREGULAR_PLURAL)) PLURAL_NOUNS.set(form, noun);
const MASS_PLURALS = new Map([...UNCOUNTABLE].map(noun => [plural(noun), noun]));
const HAVE = new Set(['have', 'has', 'had', "'ve", '’ve']);
const AUX_CONTRACTIONS = { "hasn't": 'has', "haven't": 'have', "hadn't": 'had', "didn't": 'did', "doesn't": 'does', "don't": 'do', "can't": 'can', "couldn't": 'could', "won't": 'will', "wouldn't": 'would', "shouldn't": 'should', "mustn't": 'must', "mightn't": 'might' };
const MODIFIERS = new Set(['not', 'never', 'ever', 'already', 'just', 'always', 'often', 'sometimes', 'really', 'perhaps', 'probably', 'certainly', 'quickly', 'slowly', 'carefully', 'finally', 'yet', 'still']);
const PRESENT_VERBS = 'wait shine echo linger carry stretch sleep rule leak crumble change ride sway rattle hang creak move burn smell ring watch guard stand sit open close shake glow flicker march gather sail turn swing scrape rest follow crowd knock cover lean brush spill run drift fall reach point rise look lead face hold read write belong live work need seem make know speak understand remember believe want hope wish like love hate fear think expect promise keep help allow call answer listen sing dance eat drink talk travel visit return arrive disappear remain appear start stop begin finish end protect defend attack follow chase catch find give take bring buy sell pay cost weigh measure grow die survive breathe walk climb crawl swim fly jump hide wait hurt heal'.split(' ');
const presentThird = verb => /[^aeiou]y$/u.test(verb) ? verb.slice(0, -1) + 'ies' : /(?:s|x|ch|sh|o)$/u.test(verb) ? verb + 'es' : verb + 's';
const PLURAL_TO_SINGULAR_VERB = new Map([...PRESENT_VERBS.map(verb => [verb, presentThird(verb)]), ['are', 'is'], ['were', 'was'], ['have', 'has'], ['do', 'does']]);
const SINGULAR_TO_PLURAL_VERB = new Map([...PLURAL_TO_SINGULAR_VERB].map(([base, third]) => [third, base]));
const REGULAR_BASE = 'ask call change clean close cook dance decide explain finish help jump laugh like live look move need open play pull push rain reach remember return start stop talk touch try turn use visit wait walk want wash watch work burn learn spell dream smell travel'.split(' ');
function pastForm(verb) {
  if (verb.endsWith('e')) return verb + 'd';
  if (/[^aeiou]y$/.test(verb)) return verb.slice(0, -1) + 'ied';
  if (['stop', 'plan'].includes(verb)) return verb + verb.at(-1) + 'ed';
  return verb + 'ed';
}
const REGULAR_PAST = new Map(REGULAR_BASE.map(verb => [pastForm(verb), verb]));
const own = (record, key) => Object.hasOwn(record, key) ? record[key] : undefined;
function auxiliary(word) {
  const normalized = word.replaceAll('’', "'");
  return own(AUX_CONTRACTIONS, normalized) ?? normalized;
}
const MODAL = new Set(['can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'did', 'does', 'do']);

function tokensFor(text) {
  return Array.from(text.matchAll(WORD), match => ({ word: match[0], lower: match[0].toLowerCase(), from: match.index, to: match.index + match[0].length }));
}
function preserveCase(original, replacement) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}
function adjacent(text, a, b) { return /^[^\S\r\n]+$/u.test(text.slice(a.to, b.from)); }
function shape(word) {
  if (word === word.toUpperCase()) return 'upper';
  if (word[0] === word[0]?.toUpperCase()) return 'initial';
  return 'lower';
}
function featuresAt(text, tokens, index, candidate) {
  const token = tokens[index];
  const features = [`category=${candidate.category}`, `original=${candidate.original.toLowerCase()}`, `replacement=${candidate.replacement.toLowerCase()}`, `edit=${candidate.original.toLowerCase()}>${candidate.replacement.toLowerCase()}`, `shape=${shape(candidate.original)}`];
  for (const distance of [-2, -1, 1, 2]) {
    const other = tokens[index + distance];
    // Avoid features from another sentence, line, embedded object, or clause.
    const gap = other ? text.slice(Math.min(token.to, other.to), Math.max(token.from, other.from)) : '';
    const value = other && !/[.!?;:\n\ufffc]/u.test(gap) ? other.lower : '<boundary>';
    features.push(`word${distance > 0 ? '+' : ''}${distance}=${value}`);
    features.push(`category=${candidate.category}|word${distance > 0 ? '+' : ''}${distance}=${value}`);
  }
  // Structural features come from a bounded, punctuation-free left context.
  let start = index;
  while (start > 0 && index - start < 7 && adjacent(text, tokens[start - 1], tokens[start])) start--;
  const left = tokens.slice(start, index).map(item => item.lower);
  const prepIndex = left.findIndex(word => PREPOSITIONS.has(word));
  features.push(`left-length=${Math.min(left.length, 4)}`);
  features.push(`has-preposition=${prepIndex >= 0}`);
  features.push(`has-quantifier=${left.some(word => QUANTIFIERS.has(word))}`);
  if (prepIndex >= 0) {
    features.push(`preposition=${left[prepIndex]}`);
    features.push(`preposition-distance=${Math.min(left.length - prepIndex, 5)}`);
  }
  const line = text.slice(text.lastIndexOf('\n', token.from - 1) + 1, token.from);
  const straightQuotes = (line.match(/"/g) || []).length;
  const opens = (line.match(/[“]/g) || []).length;
  const closes = (line.match(/[”]/g) || []).length;
  const inDialogue = straightQuotes % 2 === 1 || opens > closes;
  features.push(`in-dialogue=${inDialogue}`);
  features.push(`category=${candidate.category}|in-dialogue=${inDialogue}`);
  const aux = [...left].reverse().map(auxiliary).find(word => HAVE.has(word) || MODAL.has(word) || word === 'to');
  features.push(`context-auxiliary=${aux || '<none>'}`);
  features.push(`category=${candidate.category}|context-auxiliary=${aux || '<none>'}`);
  const next = tokens[index + 1];
  features.push(`next-known-noun=${!!next && adjacent(text, token, next) && (COUNT_NOUNS.has(next.lower) || UNCOUNTABLE.has(next.lower) || PLURAL_NOUNS.has(next.lower))}`);
  return features;
}

// Supports externally supplied, single-token candidates as well as generated ones.
export function candidateFeatures(text, candidate) {
  const tokens = tokensFor(text);
  const index = tokens.findIndex(token => token.from === candidate.from && token.to === candidate.to);
  if (index < 0) return [`category=${candidate.category}`, `original=${candidate.original.toLowerCase()}`, `replacement=${candidate.replacement.toLowerCase()}`, `edit=${candidate.original.toLowerCase()}>${candidate.replacement.toLowerCase()}`];
  return featuresAt(text, tokens, index, candidate);
}

export function generateGrammarCandidates(text) {
  const tokens = tokensFor(text), result = [];
  function add(index, replacement, category) {
    const token = tokens[index];
    replacement = preserveCase(token.word, replacement);
    if (replacement === token.word) return;
    const candidate = { from: token.from, to: token.to, original: token.word, replacement, category };
    candidate.features = featuresAt(text, tokens, index, candidate);
    result.push(candidate);
  }
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1], token = tokens[i];
    if (!adjacent(text, prev, token)) continue;
    const paradigm = own(AGREEMENT, prev.lower);
    const agreement = paradigm && own(paradigm, token.lower);
    if (agreement) add(i, agreement, 'agreement');
    // At most three known adverbs may separate the auxiliary and verb.
    let auxIndex = i - 1;
    while (auxIndex > 0 && i - auxIndex <= 3 && MODIFIERS.has(tokens[auxIndex].lower) && adjacent(text, tokens[auxIndex - 1], tokens[auxIndex])) auxIndex--;
    const aux = auxiliary(tokens[auxIndex].lower);
    const participle = own(PARTICIPLES, token.lower), base = own(BASE, token.lower);
    if (HAVE.has(aux) && participle) add(i, participle, 'participle');
    if ((MODAL.has(aux) || aux === 'to') && base) add(i, base, 'base-form');
    // These are proposals, not corrections: 'to burned wood' can be a
    // prepositional phrase. The model sees following-noun and dialogue features.
    if (aux === 'to' && REGULAR_PAST.has(token.lower)) add(i, REGULAR_PAST.get(token.lower), 'regular-base-form');
    if (prev.lower === 'many' && UNCOUNTABLE.has(token.lower)) add(i - 1, 'much', 'countability');
    if ((prev.lower === 'a' || prev.lower === 'an') && UNCOUNTABLE.has(token.lower)) add(i - 1, 'some', 'countability');

    // A short noun phrase after a quantifier, possibly with adjectives. Do not
    // guess arbitrary noun morphology: only known count and mass nouns qualify.
    let phraseStart = i;
    while (phraseStart > 0 && i - phraseStart < 4 && adjacent(text, tokens[phraseStart - 1], tokens[phraseStart])) phraseStart--;
    const before = tokens.slice(phraseStart, i).map(item => item.lower);
    const quantity = before.findLastIndex(word => QUANTIFIERS.has(word) || ['some', 'much', 'more', 'the'].includes(word));
    const quantityTail = before.slice(quantity + 1);
    const contiguousPhrase = quantity >= 0 && quantityTail.every(word => PHRASE_MODIFIERS.has(word));
    const mass = MASS_PLURALS.get(token.lower);
    if (mass && Object.hasOwn(MASS_UNIT, mass) && contiguousPhrase) {
      const counted = QUANTIFIERS.has(before[quantity]);
      const unit = MASS_UNIT[mass];
      add(i, counted ? (mass === 'homework' ? 'homework ' + unit : unit + ' of ' + mass) : mass, 'mass-noun');
    }
    const follower = tokens[i + 1];
    const nounModifier = follower && adjacent(text, token, follower) && (COUNT_NOUNS.has(follower.lower) || PLURAL_NOUNS.has(follower.lower) || UNCOUNTABLE.has(follower.lower));
    const hyphenated = /^[‐‑–-]/u.test(text.slice(token.to));
    if (COUNT_NOUNS.has(token.lower) && !AMBIGUOUS_COUNT.has(token.lower) && contiguousPhrase && QUANTIFIERS.has(before[quantity]) && !nounModifier && !hyphenated) {
      add(i, plural(token.lower), 'quantified-noun');
    }

    // Look for a clause-leading determiner and a known head with an optional
    // prepositional phrase. A subject nested inside another noun phrase is not
    // the clause's head. Closed verb/noun lists constrain ambiguous edits.
    if (PLURAL_TO_SINGULAR_VERB.has(token.lower) || SINGULAR_TO_PLURAL_VERB.has(token.lower)) {
      for (let j = i - 1; j >= Math.max(1, i - 9); j--) {
        if (!adjacent(text, tokens[j], tokens[j + 1])) break;
        const head = tokens[j], pluralHead = PLURAL_NOUNS.has(head.lower);
        if (AMBIGUOUS_NUMBER.has(head.lower) || token.lower === 'read') continue;
        if ((!pluralHead && !COUNT_NOUNS.has(head.lower)) || !DETERMINERS.has(tokens[j - 1].lower) || !adjacent(text, tokens[j - 1], head)) continue;
        const previous = tokens[j - 2], joinsPrevious = previous && adjacent(text, previous, tokens[j - 1]);
        if (joinsPrevious && !CLAUSE_STARTERS.has(previous.lower)) continue;
        if (joinsPrevious && ['and', 'but'].includes(previous.lower) && tokens[j - 3] &&
            (COUNT_NOUNS.has(tokens[j - 3].lower) || PLURAL_NOUNS.has(tokens[j - 3].lower) || ['i', 'you', 'he', 'she', 'it', 'we', 'they'].includes(tokens[j - 3].lower) || DETERMINERS.has(tokens[j - 4]?.lower))) continue;
        // "If the lock on the doors were broken" can be counterfactual.
        if (!pluralHead && token.lower === 'were') continue;
        const middle = tokens.slice(j + 1, i);
        if (middle.length && (middle.length < 2 || !PREPOSITIONS.has(middle[0].lower) ||
            !middle.every(item => !/[’']/.test(item.word) && !FINITE.has(item.lower) && !CLAUSE_STARTERS.has(item.lower) &&
              (PREPOSITIONS.has(item.lower) || DETERMINERS.has(item.lower) || COUNT_NOUNS.has(item.lower) || PLURAL_NOUNS.has(item.lower) || PHRASE_MODIFIERS.has(item.lower))) ||
            !middle.some(item => COUNT_NOUNS.has(item.lower) || PLURAL_NOUNS.has(item.lower)))) continue;
        // Without a PP, the existing checker handles straightforward cases.
        if (!middle.length) break;
        const replacement = (pluralHead ? SINGULAR_TO_PLURAL_VERB : PLURAL_TO_SINGULAR_VERB).get(token.lower);
        if (replacement) add(i, replacement, 'noun-agreement');
        break;
      }
    }
  }
  return [...result, ...syntaxCandidates(text, tokens), ...relativeCandidates(text, tokens), ...coverageCandidates(text, tokens, {
    countNouns: COUNT_NOUNS, pluralNouns: PLURAL_NOUNS, plural,
    pluralToSingularVerb: PLURAL_TO_SINGULAR_VERB, singularToPluralVerb: SINGULAR_TO_PLURAL_VERB, ambiguousNumber: AMBIGUOUS_NUMBER
  })];
}

// A sparse logistic model: { bias: number, weights: { [feature]: number } }.
// Returns the probability that the suggested correction is appropriate.
export function scoreGrammarCandidate(candidate, model) {
  let score = Number.isFinite(model?.bias) ? model.bias : 0;
  for (const feature of candidate.features || []) {
    const weight = model?.weights?.[feature];
    if (Number.isFinite(weight)) score += weight;
  }
  return score >= 0 ? 1 / (1 + Math.exp(-score)) : Math.exp(score) / (1 + Math.exp(score));
}
