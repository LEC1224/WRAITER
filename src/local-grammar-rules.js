// A repeated word is not inherently an error: “had had”, “that that”,
// “what it is is”, “her her book”, and “very very” are all valid. Only
// suggest removal for a small set of common accidental function-word repeats.
const accidentalRepeats = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'although', 'because', 'unless', 'whether']);
const modals = new Set(['could', 'would', 'should', 'might', 'must']);
const ambiguousAbbreviations = new Set('api cpu css ftp gpu html http https json lgbt mba mri sql ssh ssl svg tcp ufo uri url usb uuid xml'.split(' '));
const irregularParticiples = new Set('been had done gone seen known left said found put read told brought got gotten bought taken made come become run won worn written broken felt lost heard given shown sent kept met paid set cut hurt let held stood understood taught thought built driven eaten fallen forgotten forgiven chosen begun drunk flown grown hidden ridden risen shaken spoken stolen swum thrown woken bound caught drawn fought hung laid led lent meant ridden sat slept spent struck swept torn withdrawn'.split(' '));
const singularSubjects = new Set('boy girl child man woman person dragon dog cat horse door house room book story hand head face eye mouth tail paw heart voice body bird tree road friend mother father brother sister king queen guard knight soldier stranger creature animal village castle town forest river light night day sun moon wind rain fire water sky ground floor wall window table chair information advice furniture equipment knowledge news'.split(' '));
const pluralSubjects = new Set('boys girls children men women people dragons dogs cats horses doors houses rooms books stories hands heads faces eyes mouths tails paws hearts voices bodies birds trees roads friends mothers fathers brothers sisters kings queens guards knights soldiers strangers creatures animals villages castles towns forests rivers nights days winds fires windows tables chairs'.split(' '));
const nounPhrasePrepositions = new Set('about above across after against among around at before behind below beneath beside between by down for from in inside into near of off on onto outside over past through to under underneath until up upon with within without'.split(' '));
const gerundPredicates = new Set('is are was were has have had caused concerned surprised bothers bothered upset disappointed meant made prompted worried impressed delighted annoyed'.split(' '));
// Avoid common imperatives such as “Everybody say hello” or “Everyone run”.
const indefiniteVerbs = { know: 'knows', want: 'wants', believe: 'believes', understand: 'understands', mean: 'means' };
const choiceVerbs = new Set('arrive be begin come dance eat fall feel fight fly go help hide hold laugh leave listen live look meet play read return run say see sing sleep speak stay stop swim talk travel try wait walk work write'.split(' '));
const unambiguousInfinitives = new Set('arrive come depart go leave return sleep swim travel walk'.split(' '));
const gradableAdjectives = new Set('big bright cold dark difficult easy fast heavy high hot large light little long loose narrow old quiet short slow small strong thick thin tight tired weak wide young'.split(' '));
const comparatives = new Set('bigger brighter colder darker easier faster heavier higher hotter larger lighter longer narrower older quieter shorter slower smaller stronger thicker thinner tighter weaker wider younger'.split(' '));
const passiveParticiples = { broke: 'broken', chose: 'chosen', drove: 'driven', ate: 'eaten', fell: 'fallen', froze: 'frozen', gave: 'given', saw: 'seen', spoke: 'spoken', stole: 'stolen', took: 'taken', tore: 'torn', wrote: 'written' };
const countablePlurals = { child: 'children', man: 'men', woman: 'women', person: 'people', story: 'stories', body: 'bodies',
  ...Object.fromEntries('boy girl dragon dog cat horse door house room book hand head face eye mouth tail paw heart voice bird tree road friend mother father brother sister king queen guard knight soldier stranger creature animal village castle town forest river window table chair'.split(' ').map(word => [word, word + 's'])) };
const possessableNouns = new Set('bag book car cat child children coat dog friend hat horse house jacket key keys letter mother father name room shoes umbrella'.split(' '));
const quietNouns = new Set('cottage forest garden house lake night place river road room street stream village woods'.split(' '));
const pastAfterDid = { went: 'go', saw: 'see', ate: 'eat', came: 'come', gave: 'give', took: 'take', made: 'make', wrote: 'write', spoke: 'speak', knew: 'know', thought: 'think', bought: 'buy', brought: 'bring', told: 'tell', felt: 'feel', left: 'leave', heard: 'hear', broke: 'break', chose: 'choose', drove: 'drive', fell: 'fall', forgot: 'forget', ran: 'run', slept: 'sleep', stood: 'stand', understood: 'understand', wore: 'wear', won: 'win' };
const articleNonNouns = new Set('and or but if then as at by for from in into of on onto out over past per than through to under up with without is are was were be been being do does did have has had can could may might must shall should will would'.split(' '));
const sameCase = (word, source) => source.length > 1 && source === source.toUpperCase() ? word.toUpperCase() : /^[A-Z]/.test(source) ? word[0].toUpperCase() + word.slice(1) : word;

function subjunctiveBefore(tokens, index, text) {
  const previous = tokens[index - 1], before = tokens[index - 2];
  const adjacent = (a, b) => a && b && /^[ \t]+$/.test(text.slice(a.to, b.from));
  if (!adjacent(previous, tokens[index])) return false;
  if (['if', 'wish', 'wishes', 'wished', 'though', 'whether', 'suppose', 'supposing', 'unless'].includes(previous.word)) return true;
  if (!adjacent(before, previous)) return false;
  return previous.word === 'only' && before.word === 'if' || previous.word === 'that' && ['wish', 'wishes', 'wished', 'insist', 'insisted', 'request', 'requested', 'require', 'required', 'demand', 'demands', 'demanded', 'suggest', 'suggests', 'suggested', 'recommend', 'recommends', 'recommended', 'propose', 'proposes', 'proposed', 'ask', 'asks', 'asked', 'order', 'orders', 'ordered', 'essential', 'necessary', 'important', 'vital', 'crucial'].includes(before.word);
}

function articleBefore(source) {
  // Pronunciation, not the first written letter, determines the article.
  // Initialisms, names, single-letter labels, dialect-sensitive words and
  // contractions cannot be inferred reliably by this small offline checker.
  const word = source.toLowerCase();
  if (/^x-ray(?:s|ed|ing)?$/.test(word)) return 'an';
  if (source.length < 2 || ambiguousAbbreviations.has(word) || /[A-Z’']/u.test(source) || /^[a-z]-/.test(word) || !/^[a-z]+(?:-[a-z]+)*$/.test(source) || /^(?:herb|homage|historic|hotel|horrendous|hysteric|yttr|ytterb|euler|ukulele)/.test(word)) return null;
  if (/^(?:honest|honou?r|hour|heir)/.test(word)) return 'an';
  if (/^(?:ewe(?:$|-|s$)|eu|one(?:$|-)|once(?:$|-)|ubiqu|unanim|uni(?:corn|cycl|f|later|on|que|son|t(?:$|-|s$|ed|ing|ary|ari|i)|vers|val|vocal)|uran|urin|uro|use(?:$|-|d|r|ful|less)|usual|uter|util|utopi)/.test(word)) return 'a';
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}

export function grammarHints(text, language = 'en-US') {
  if (!/^en(?:-|$)/i.test(language)) return [];
  // Full Unicode word tokens prevent English rules matching a fragment of a
  // contraction, identifier, number or non-English word.
  const tokens = [...text.matchAll(/[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu)].map(match => ({ text: match[0], word: match[0].toLowerCase(), from: match.index, to: match.index + match[0].length }));
  const hints = [], add = (from, to, replacement, reason) => hints.push({ from, to, original: text.slice(from, to), replacement, reason });
  const adjacent = (a, b) => a && b && /^[ \t]+$/.test(text.slice(a.to, b.from));
  for (let i = 0; i + 1 < tokens.length; i++) {
    const current = tokens[i], next = tokens[i + 1];
    if (!adjacent(current, next)) continue;
    if (current.word === next.word && accidentalRepeats.has(current.word)) {
      add(current.from, next.to, current.text, 'This word may have been typed twice. Remove the duplicate if it was unintentional.');
      continue;
    }
    if (modals.has(current.word) && next.word === 'of') {
      const following = tokens[i + 2];
      // Require evidence of a perfect-tense construction. This leaves
      // “could of course”, “must of necessity” and unfinished prose alone.
      if (adjacent(next, following) && (irregularParticiples.has(following.word) || /^[a-z]+ed$/.test(following.word))) {
        add(current.from, next.to, current.text + text.slice(current.to, next.from) + sameCase('have', next.text), 'Use “have”, rather than “of”, before this past participle.');
      }
    }
    if ((current.word === 'a' || current.word === 'an') && !articleNonNouns.has(next.word)) {
      const expected = articleBefore(next.text);
      if (expected && current.word !== expected) add(current.from, current.to, sameCase(expected, current.text), 'Use “' + expected + '” before the opening sound of “' + next.text + '”.');
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i], next = tokens[i + 1], following = tokens[i + 2];
    // "Built-in" is a past participle used as an adjective. The unhyphenated
    // verb "build in" remains valid ("build in a shelf").
    if (current.word === 'build-in') add(current.from, current.to, sameCase('built-in', current.text), 'Use “built-in” for something included as part of another object.');
    if (!adjacent(current, next)) continue;
    if (['want', 'wants', 'wanted'].includes(current.word) && unambiguousInfinitives.has(next.word)) {
      add(next.from, next.to, 'to ' + next.text, 'Use “to” before this infinitive.');
    }
    if (current.word === 'their' && next.word === 'going' && adjacent(next, following) && following.word === 'to') {
      const verb = tokens[i + 3], before = tokens[i - 1];
      // “I appreciated their going to help” and “Their going to help early
      // surprised me” use possessive gerunds. Require an independent clause
      // and abstain if we see a potential predicate after the infinitive.
      const startsSentence = !before || /[.!?…\n]/u.test(text.slice(before.to, current.from));
      if (!startsSentence || !adjacent(following, verb)) continue;
      let hasPredicate = false;
      for (let j = i + 4; j < Math.min(i + 16, tokens.length) && adjacent(tokens[j - 1], tokens[j]); j++) {
        if (gerundPredicates.has(tokens[j].word)) { hasPredicate = true; break; }
      }
      const place = tokens[i + 4], when = tokens[i + 5];
      const simpleDestination = ['the', 'a'].includes(verb.word) && adjacent(verb, place) && ['village', 'town', 'city', 'forest', 'castle', 'market', 'station', 'store', 'shop', 'park'].includes(place.word) && adjacent(place, when) && ['today', 'tomorrow', 'tonight', 'now', 'soon'].includes(when.word) && /^\s*[.!?](?:\s|$)/u.test(text.slice(when.to));
      if (!hasPredicate && (choiceVerbs.has(verb.word) || verb.word === 'loose' || simpleDestination)) {
        add(current.from, current.to, sameCase("they're", current.text), 'Use “they’re” for “they are” in this construction.');
      }
    }
    if (current.word === 'its' && ['raining', 'snowing', 'hailing', 'drizzling'].includes(next.word)) {
      const weatherContext = adjacent(next, following) && ['outside', 'inside', 'here', 'there', 'again', 'today', 'tonight', 'now', 'hard', 'heavily'].includes(following.word);
      if (weatherContext || /^\s*[.!?](?:\s|$)/u.test(text.slice(next.to))) add(current.from, current.to, sameCase("it's", current.text), 'Use “it’s” for “it is” when describing the weather.');
    }
    if (current.word === 'your' && ['standing', 'sitting', 'kneeling'].includes(next.word) && adjacent(next, following) && following.word === 'on') {
      const owner = tokens[i + 3], noun = tokens[i + 4];
      if (adjacent(following, owner) && ['my', 'the'].includes(owner.word) && adjacent(owner, noun) && ['foot', 'hand', 'chair', 'bed', 'bench'].includes(noun.word) && /^\s*[.!?](?:\s|$)/u.test(text.slice(noun.to))) {
        add(current.from, current.to, sameCase("you're", current.text), 'Use “you’re” for “you are” in this construction.');
      }
    }
    if (['been', 'being', 'was', 'were', 'is', 'are'].includes(current.word) && passiveParticiples[next.word] && adjacent(next, following) && following.word === 'by') {
      const actor = tokens[i + 3];
      if (adjacent(following, actor) && ['a', 'an', 'the', 'my', 'your', 'his', 'her', 'our', 'their', 'him', 'her', 'them', 'us', 'me'].includes(actor.word)) {
        add(next.from, next.to, sameCase(passiveParticiples[next.word], next.text), 'Use the past participle in this passive construction.');
      }
    }
    if (current.word === 'to' && gradableAdjectives.has(next.word) && adjacent(next, following) && following.word === 'to') {
      const before = tokens[i - 1], verb = tokens[i + 3];
      if (adjacent(before, current) && ['am', 'is', 'are', 'was', 'were', 'be', 'been', 'became', 'seems', 'seemed', 'looks', 'looked'].includes(before.word) && adjacent(following, verb) && choiceVerbs.has(verb.word)) {
        add(current.from, next.to, sameCase('too', current.text) + text.slice(current.to, next.from) + next.text, 'Use “too” to mean more than is suitable.');
      }
    }
    if (comparatives.has(current.word) && next.word === 'then') {
      const before = tokens[i - 1];
      if (adjacent(before, current) && ['is', 'are', 'was', 'were', 'seems', 'seemed', 'looks', 'looked', 'became'].includes(before.word) && adjacent(next, following)) {
        add(next.from, next.to, sameCase('than', next.text), 'Use “than” after this comparative.');
      }
    }
    if (['many', 'several', 'few'].includes(current.word) && countablePlurals[next.word] && adjacent(next, following) && ['are', 'were', 'have', 'do', 'in', 'at', 'on', 'outside', 'inside'].includes(following.word)) {
      add(next.from, next.to, sameCase(countablePlurals[next.word], next.text), 'Use a plural noun after this quantity.');
    }
    if (['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].includes(current.word) && next.word === 'stone' && adjacent(next, following) && following.word === 'from') {
      const previous = tokens[i - 1], action = tokens[i - 2];
      if (adjacent(previous, current) && previous.word === 'up' && adjacent(action, previous) && ['pick', 'picks', 'picked'].includes(action.word)) {
        add(next.from, next.to, sameCase('stones', next.text), 'Use the plural for separate stones.');
      }
    }
    // A passive "be build by/with/on ..." requires the participle "built".
    // Require the following preposition rather than guessing that every use
    // of the noun "build" after a form of "be" is a verb.
    if (['is', 'are', 'was', 'were', 'be', 'been', 'being'].includes(current.word) && next.text === 'build' && adjacent(next, following) && ['by', 'with', 'on', 'upon', 'from', 'around', 'into'].includes(following.word)) {
      add(next.from, next.to, 'built', 'Use the past participle “built” in this passive construction.');
    }
    if (['everyone', 'everybody', 'someone', 'somebody', 'anyone', 'anybody', 'no-one', 'nobody'].includes(current.word) && indefiniteVerbs[next.word] && !subjunctiveBefore(tokens, i, text)) {
      add(next.from, next.to, sameCase(indefiniteVerbs[next.word], next.text), 'This singular pronoun takes a singular verb.');
    }
    if (current.word === 'each' && next.word === 'of' && adjacent(next, following) && ['the', 'these', 'those', 'my', 'your', 'our', 'their'].includes(following.word)) {
      const noun = tokens[i + 3], verb = tokens[i + 4];
      if (adjacent(following, noun) && adjacent(noun, verb) && pluralSubjects.has(noun.word)) {
        const replacement = { have: 'has', are: 'is', were: 'was' }[verb.word];
        if (replacement && !(verb.word === 'were' && subjunctiveBefore(tokens, i, text))) add(verb.from, verb.to, sameCase(replacement, verb.text), '“Each” takes a singular verb here.');
      }
    }
    if (current.word === 'rather' && choiceVerbs.has(next.word) && adjacent(next, following) && following.word === 'then') {
      const other = tokens[i + 3];
      if (adjacent(following, other) && choiceVerbs.has(other.word)) add(following.from, following.to, sameCase('than', following.text), 'Use “than” when comparing these choices.');
    }
    if (['can', 'could', 'may', 'might', 'will', 'would'].includes(current.word) && next.word === 'hard' && adjacent(next, following) && ['hear', 'see', 'breathe', 'speak'].includes(following.word)) {
      add(next.from, next.to, sameCase('hardly', next.text), '“Hardly” means almost not in this expression.');
    }
    if (['who', "who's", 'who’s'].includes(current.word)) {
      const isExpanded = current.word === 'who' && next.word === 'is';
      const noun = isExpanded ? following : next, verb = tokens[i + (isExpanded ? 3 : 2)];
      if (noun && verb && adjacent(isExpanded ? next : current, noun) && adjacent(noun, verb) && noun.text === noun.word && possessableNouns.has(noun.word) && ['is', 'are', 'was', 'were', 'has', 'have'].includes(verb.word)) {
        add(current.from, isExpanded ? next.to : current.to, sameCase('whose', current.text), '“Whose” asks who possesses this.');
      }
    }
    if (['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].includes(current.word) && ['child', 'man', 'woman', 'person'].includes(next.word) && following && adjacent(next, following) && (Object.hasOwn(pastAfterDid, following.word) || ['are', 'were', 'have', 'do'].includes(following.word) || /^[a-z]+ed$/.test(following.word))) {
      add(next.from, next.to, sameCase(countablePlurals[next.word], next.text), 'Use the plural form after this number.');
    }
    if (['the', 'a', 'this', 'that'].includes(current.word) && next.word === 'quite' && adjacent(next, following) && quietNouns.has(following.word)) {
      add(next.from, next.to, sameCase('quiet', next.text), 'Did you mean “quiet” (making little noise)?');
    }
    if (['i', 'you', 'he', 'she', 'we', 'they'].includes(current.word) && next.word === 'past' && adjacent(next, following) && ['the', 'a'].includes(following.word)) {
      const place = tokens[i + 3];
      if (adjacent(following, place) && ['bridge', 'door', 'gate', 'house', 'tree', 'window'].includes(place.word)) add(next.from, next.to, sameCase('passed', next.text), 'Did you mean “passed” (went past)?');
    }
    if (['take', 'takes', 'taking', 'took'].includes(current.word) && next.word === 'a' && adjacent(next, following) && following.word === 'brake') {
      const from = tokens[i + 3], owner = tokens[i + 4], subject = tokens[i + 5];
      if (adjacent(following, from) && from.word === 'from' && adjacent(from, owner) && ['my', 'your', 'his', 'her', 'our', 'their', 'the'].includes(owner.word) && adjacent(owner, subject) && ['work', 'studies', 'training', 'writing', 'reading', 'walking', 'running'].includes(subject.word)) add(following.from, following.to, sameCase('break', following.text), 'A “break” is a pause from an activity.');
    }
    if (['can', 'could', 'will', 'would'].includes(current.word) && next.word === 'not' && adjacent(next, following) && following.word === 'bare') {
      const article = tokens[i + 3], noun = tokens[i + 4], after = tokens[i + 5];
      if (adjacent(following, article) && ['the', 'my', 'your', 'his', 'her', 'our', 'their'].includes(article.word) && adjacent(article, noun) && ['pain', 'burden', 'weight'].includes(noun.word) && !(adjacent(noun, after) && after.word === 'to')) add(following.from, following.to, sameCase('bear', following.text), 'Did you mean “bear” (endure or carry)?');
    }
    // Demonstratives have an unambiguous number. Avoid guessing the number of
    // arbitrary nouns, which can be names, collective nouns, or quoted titles.
    const preceding = text.slice(0, current.from);
    const atSentenceStart = /^[\s"'“‘([{]*$/u.test(preceding) || /[.!?]["'”’\])}]*\s+["'“‘([{]*$/u.test(preceding);
    if (atSentenceStart && ['him', 'her', 'me', 'them', 'us'].includes(current.word) && next.word === 'and' && adjacent(next, following) && ['i', 'we', 'he', 'she', 'they'].includes(following.word)) {
      const verb = tokens[i + 3], replacement = { him: 'he', her: 'she', me: 'i', them: 'they', us: 'we' }[current.word];
      if (adjacent(following, verb) && (Object.hasOwn(pastAfterDid, verb.word) || ['are', 'were', 'have', 'do'].includes(verb.word) || /^[a-z]+ed$/.test(verb.word))) {
        add(current.from, current.to, sameCase(replacement, current.text), 'Use a subject pronoun in this compound subject.');
      }
    }
    if (['this', 'that'].includes(current.word) && pluralSubjects.has(next.word) && adjacent(next, following) && ['are', 'were', 'have'].includes(following.word)) {
      add(current.from, current.to, sameCase(current.word === 'this' ? 'these' : 'those', current.text), 'Use the plural demonstrative with this plural noun.');
    }
    if (atSentenceStart && current.word === 'me' && (Object.hasOwn(pastAfterDid, next.word) || ['was', 'had'].includes(next.word) || /^[a-z]+ed$/.test(next.word))) {
      add(current.from, current.to, sameCase('I', current.text), 'Use the subject pronoun “I” before this verb.');
    }
    const demonstrative = atSentenceStart ? { 'this are': 'is', 'that are': 'is', 'these is': 'are', 'those is': 'are', 'these was': 'were', 'those was': 'were' }[current.word + ' ' + next.word] : null;
    if (demonstrative) add(next.from, next.to, sameCase(demonstrative, next.text), 'The demonstrative and verb should agree in number.');
    const pronoun = { 'i is': 'am', 'i are': 'am', 'he are': 'is', 'she are': 'is', 'we is': 'are', 'they is': 'are', 'we was': 'were', 'they was': 'were' }[current.word + ' ' + next.word];
    const beforePronoun = tokens[i - 1];
    const pronounIsObject = adjacent(beforePronoun, current) && nounPhrasePrepositions.has(beforePronoun.word);
    const compoundSubject = adjacent(beforePronoun, current) && ['and', 'or'].includes(beforePronoun.word);
    if (pronoun && !pronounIsObject && !compoundSubject) add(next.from, next.to, sameCase(pronoun, next.text), 'The pronoun and verb should agree.');
    // A numbered duration, distance, or sum may act as one quantity:
    // “There is two miles to go.” Do not infer agreement from a bare number.
    if (current.word === 'there' && next.word === 'is' && adjacent(next, following) && ['many', 'several'].includes(following.word)) {
      const after = tokens[i + 3];
      if (!(following.word === 'many' && adjacent(following, after) && after.word === 'a')) add(next.from, next.to, sameCase('are', next.text), 'Use a plural verb with this plural quantity.');
    }
    if (current.word === 'there' && ['is', 'are', 'was', 'were'].includes(next.word) && adjacent(next, following) && following.word === 'much') {
      const noun = tokens[i + 3];
      if (adjacent(following, noun) && pluralSubjects.has(noun.word)) add(following.from, following.to, sameCase('many', following.text), 'Use “many” with this plural count noun.');
    }
    if (current.word === 'one' && next.word === 'of' && adjacent(next, following) && ['the', 'these', 'those', 'my', 'your', 'our', 'their'].includes(following.word)) {
      const noun = tokens[i + 3], verb = tokens[i + 4];
      if (adjacent(following, noun) && adjacent(noun, verb) && countablePlurals[noun.word] && ['is', 'was', 'has', 'does'].includes(verb.word)) {
        add(noun.from, noun.to, sameCase(countablePlurals[noun.word], noun.text), 'Use a plural noun after “one of”.');
      }
    }
    const beforeArticle = tokens[i - 1];
    const inPrepositionalPhrase = adjacent(beforeArticle, current) && nounPhrasePrepositions.has(beforeArticle.word);
    if (current.word === 'the' && !inPrepositionalPhrase && following && adjacent(next, following) && /^[a-z]+$/.test(next.text)) {
      const replacement = singularSubjects.has(next.word) ? { are: 'is', were: 'was' }[following.word] : pluralSubjects.has(next.word) ? { is: 'are', was: 'were' }[following.word] : null;
      const conditional = following.word === 'were' && subjunctiveBefore(tokens, i, text);
      if (replacement && !conditional) add(following.from, following.to, sameCase(replacement, following.text), 'The noun and verb may not agree in number.');
    }
    if (current.word === 'did') {
      const verb = next.word === 'not' && adjacent(next, following) ? following : next;
      const base = pastAfterDid[verb.word];
      if (base) add(verb.from, verb.to, sameCase(base, verb.text), 'Use the base form of the verb after “did”.');
    }
  }
  const accepted = [];
  for (const hint of hints.sort((a, b) => a.from - b.from)) if (!accepted.length || hint.from >= accepted.at(-1).to) accepted.push(hint);
  return accepted;
}

