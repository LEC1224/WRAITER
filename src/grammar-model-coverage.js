// Additional bounded edit proposals. These are scored by the learned model;
// they are never displayed directly. All spans use JavaScript UTF-16 offsets.
const SUBJECT_CASE = { him: 'he', her: 'she', them: 'they', me: 'I', us: 'we' };
const PERSONAL = new Set('i you he she it we they'.split(' '));
const FINITE = new Set('am is are was were has have had does do did can could will would shall should may might must'.split(' '));
const MODIFIERS = new Set('old young new small large little big red blue green black white gray grey silver golden wooden iron stone tall short narrow wide dark bright broken empty full lost missing heavy light strange quiet distant nearest next last first second third northern southern eastern western open closed local familiar ancient ruined solitary hungry tired frightened weary'.split(' '));
const STARTERS = new Set('and but because when while although unless then'.split(' '));
const BEFORE_NOUN = new Set('a an the my your his her its our their this that these those each every'.split(' '));
const MANNER = new Map([['careful', 'carefully'], ['beautiful', 'beautifully'], ['sudden', 'suddenly'], ['deliberate', 'deliberately'], ['accurate', 'accurately'], ['accidental', 'accidentally']]);
const MANNER_VERBS = new Set('answer answered answering speak spoke speaking whisper whispered whispering sing sang singing listen listened listening move moved moving open opened opening close closed closing turn turned turning write wrote writing read walk walked walking watch watched watching step stepped stepping measure measured measuring check checked checking count counted counting calculate calculated calculating describe described describing fall fell falling stop stopped stopping start started starting appear appeared appearing'.split(' '));
const LOCATIONS = new Set('inside outside nearby upstairs downstairs beneath overhead here there'.split(' '));
const PREDICATES = new Set('welcome ready late tired exhausted hungry thirsty sure certain afraid awake asleep alone wrong lucky safe mistaken'.split(' '));
const TRANSITIVE = new Set('lost lose loses losing packed pack packs packing took take takes taking found find finds finding followed follow follows following carried carry carries carrying brought bring brings bringing kept keep keeps keeping searched search searches searching chose choose chooses choosing gathered gather gathers gathering tightened tighten tightens tightening gripped grip grips gripping pulled pull pulls pulling held hold holds holding'.split(' '));
const DIRECT_OBJECTS = new Set('book sword knife cup bowl plate child baby box letter map stone rock rope bundle coat blanket bag sack basket lantern lamp coin key pen pencil hand arm head foot'.split(' '));
const DISPLACEMENT = new Set('laid put set placed dropped moved lifted carried left tucked'.split(' '));
const MASS = new Set('news information advice equipment furniture luggage baggage homework'.split(' '));
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
const space = (text, a, b) => a && b && /^[^\S\r\n]+$/u.test(text.slice(a.to, b.from));
const sentenceBoundary = (text, a, b) => !a || /[.!?;:\r\n\ufffc]/u.test(text.slice(a.to, b.from));

function caseLike(original, replacement) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  return original[0] === original[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

function quoted(text, at) {
  const prefix = text.slice(text.lastIndexOf('\n', at - 1) + 1, at);
  // Apostrophes inside words are not dialogue delimiters.
  const straight = prefix.match(/"/gu)?.length ?? 0;
  const opening = prefix.match(/“/gu)?.length ?? 0;
  const closing = prefix.match(/”/gu)?.length ?? 0;
  const singleOpening = prefix.match(/‘/gu)?.length ?? 0;
  const singleClosing = prefix.match(/(?<!\p{L})’|’(?!\p{L})/gu)?.length ?? 0;
  return straight % 2 === 1 || opening > closing || singleOpening > singleClosing;
}

export function coverageCandidates(text, tokens, lexicon) {
  const { countNouns, pluralNouns, plural, pluralToSingularVerb, singularToPluralVerb, ambiguousNumber } = lexicon;
  const result = [];
  const isNoun = word => countNouns.has(word) || pluralNouns.has(word) || MASS.has(word);
  const isHeadStart = index => {
    if (sentenceBoundary(text, tokens[index - 1], tokens[index])) return true;
    const previous = tokens[index - 1], before = tokens[index - 2];
    return space(text, previous, tokens[index]) && STARTERS.has(previous.lower) &&
      !(['and', 'but'].includes(previous.lower) && before && (isNoun(before.lower) || PERSONAL.has(before.lower) || BEFORE_NOUN.has(tokens[index - 3]?.lower)));
  };
  const connected = (start, end) => {
    for (let i = start; i < end; i++) if (!space(text, tokens[i], tokens[i + 1])) return false;
    return true;
  };
  function add(index, replacement, category, extra = []) {
    const token = tokens[index], original = token.word;
    replacement = caseLike(original, replacement);
    if (replacement === original) return;
    const inDialogue = quoted(text, token.from);
    const features = [`category=${category}`, `original=${token.lower}`, `replacement=${replacement.toLowerCase()}`,
      `edit=${token.lower}>${replacement.toLowerCase()}`, `in-dialogue=${inDialogue}`, `category=${category}|in-dialogue=${inDialogue}`, ...extra];
    for (const offset of [-2, -1, 1, 2]) {
      const other = tokens[index + offset];
      const hasContext = other && connected(Math.min(index, index + offset), Math.max(index, index + offset));
      features.push(`coverage-word${offset}=${hasContext ? other.lower : '<boundary>'}`);
    }
    result.push({ from: token.from, to: token.to, original, replacement, category, features });
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], word = token.lower, next = tokens[i + 1], previous = tokens[i - 1];

    // Local noun subjects with a clear determiner. Never infer number from an
    // arbitrary trailing 's' or treat a noun used as a modifier as the head.
    if (BEFORE_NOUN.has(word) && isHeadStart(i)) {
      let head = i + 1;
      while (head < tokens.length && head - i <= 3 && MODIFIERS.has(tokens[head].lower)) head++;
      if (head < tokens.length && isNoun(tokens[head].lower) && connected(i, head + 1) && tokens[head + 1]) {
        const noun = tokens[head].lower, verb = tokens[head + 1].lower;
        const pluralSubject = pluralNouns.has(noun);
        // Irrealis 'were' has many valid literary uses; leave it to context.
        const replacement = (pluralSubject ? singularToPluralVerb : pluralToSingularVerb).get(verb);
        if (replacement && !ambiguousNumber.has(noun) && verb !== 'read' && !(verb === 'were' && !pluralSubject) && !['each', 'every'].includes(word))
          add(head + 1, replacement, 'local-number-agreement', [`subject-number=${pluralSubject ? 'plural' : 'singular'}`, `subject-head=${noun}`]);
      }
    }

    // 'One of the wolves' and 'each of them' retain a singular head. Either
    // and neither are intentionally excluded: plural agreement is widespread.
    if (['one', 'each'].includes(word) && isHeadStart(i) && next?.lower === 'of') {
      let end = i + 2;
      if (tokens[end]?.lower === 'the') end++;
      while (tokens[end] && end - i < 6 && MODIFIERS.has(tokens[end].lower)) end++;
      if (tokens[end] && (pluralNouns.has(tokens[end].lower) || ['them', 'us', 'you'].includes(tokens[end].lower)) && connected(i, end + 1) && tokens[end + 1]) {
        const verb = tokens[end + 1].lower;
        const replacement = pluralToSingularVerb.get(verb);
        if (replacement) add(end + 1, replacement, 'local-number-agreement', ['subject-number=singular', `subject-quantifier=${word}`]);
      }
    }

    // Inversion after a place expression: reject coordination/list readings.
    if (LOCATIONS.has(word) && isHeadStart(i) && ['were', 'are'].includes(next?.lower)) {
      const article = tokens[i + 2];
      let head = i + 3;
      while (tokens[head] && head - i <= 5 && MODIFIERS.has(tokens[head].lower)) head++;
      if (['a', 'an'].includes(article?.lower) && tokens[head] && countNouns.has(tokens[head].lower) && connected(i, head)) {
        let end = head;
        while (tokens[end + 1] && end - head < 8 && !sentenceBoundary(text, tokens[end], tokens[end + 1])) end++;
        const tail = tokens.slice(head + 1, end + 1);
        if (!tail.some(t => t.lower === 'and') && !text.slice(tokens[head].to, tokens[end].to).includes(','))
          add(i + 1, next.lower === 'were' ? 'was' : 'is', 'local-number-agreement', ['subject-number=singular', 'subject-inverted=true']);
      }
    }

    // Demonstratives require a plural noun, except when a singular noun is an
    // attributive modifier (those horse blankets, these stone walls).
    if (['these', 'those'].includes(word)) {
      let head = i + 1;
      while (tokens[head] && head - i <= 3 && MODIFIERS.has(tokens[head].lower)) head++;
      if (tokens[head] && countNouns.has(tokens[head].lower) && connected(i, head)) {
        const following = tokens[head + 1];
        const boundary = !following || sentenceBoundary(text, tokens[head], following);
        const finiteFollower = following && !isNoun(following.lower) && (FINITE.has(following.lower) || pluralToSingularVerb.has(following.lower) || singularToPluralVerb.has(following.lower) || /(?:ed|ing)$/u.test(following.lower));
        if (!/^[‐‑–-]/u.test(text.slice(tokens[head].to)) && (boundary || finiteFollower) && !ambiguousNumber.has(tokens[head].lower))
          add(head, plural(tokens[head].lower), 'demonstrative-number', [`demonstrative=${word}`]);
      }
    }

    // Subject-case pronouns before a finite verb or a coordinated proper name.
    const nominative = own(SUBJECT_CASE, word);
    if (nominative && isHeadStart(i) && next && space(text, token, next)) {
      let finite = i + 1;
      if (next.lower === 'and' && tokens[i + 2]) {
        const other = tokens[i + 2];
        if (PERSONAL.has(other.lower) || /^[\p{Lu}]/u.test(other.word)) finite = i + 3;
      }
      const verb = tokens[finite];
      if (verb && connected(i, finite) && (FINITE.has(verb.lower) ||
          (word !== 'her' || finite > i + 1) && (singularToPluralVerb.has(verb.lower) || pluralToSingularVerb.has(verb.lower) || /ed$/u.test(verb.lower))))
        add(i, nominative, 'subject-case', [`coordinated=${finite > i + 1}`]);
    }

    if (word === 'your' && isHeadStart(i) && next && space(text, token, next) && PREDICATES.has(next.lower)) {
      const following = tokens[i + 2];
      const complement = following && space(text, next, following) && ['to', 'for', 'of', 'that', 'here', 'there', 'when', 'if', 'but', 'and'].includes(following.lower);
      const boundary = !following || sentenceBoundary(text, next, following);
      const hyphenated = /^[‐‑–-]/u.test(text.slice(next.to));
      const infinitive = tokens[i + 3];
      const welcomeVerb = infinitive && (pluralToSingularVerb.has(infinitive.lower) || ['stay', 'come', 'go', 'leave', 'join', 'use', 'borrow', 'try'].includes(infinitive.lower));
      const nominalWelcome = next.lower === 'welcome' && !(following?.lower === 'to' && welcomeVerb);
      if (!hyphenated && !nominalWelcome && (boundary || complement))
        add(i, "you're", 'contextual-homophone', ['homophone-pattern=your-predicate']);
    }
    if (word === 'there' && next && space(text, token, next) && isNoun(next.lower) && previous && space(text, previous, token) && TRANSITIVE.has(previous.lower))
      add(i, 'their', 'contextual-homophone', ['homophone-pattern=possessive-after-verb']);
    if (word === 'their' && previous && ['over', 'under', 'in', 'out', 'from', 'around', 'near'].includes(previous.lower) && space(text, previous, token) &&
        (!next || sentenceBoundary(text, token, next)))
      add(i, 'there', 'contextual-homophone', ['homophone-pattern=locative']);
    if (word === 'then') {
      let start = i;
      while (start > 0 && i - start < 7 && space(text, tokens[start - 1], tokens[start])) start--;
      if (tokens.slice(start, i).some(t => t.lower === 'rather') && next && space(text, token, next))
        add(i, 'than', 'contextual-homophone', ['homophone-pattern=rather-than']);
    }

    // Manner adjectives whose ordinary adverb form is explicit. Common flat
    // adverbs (fast, hard, late, loud, slow, quick, quiet) are not proposed.
    const manner = MANNER.get(word);
    if (manner && previous && space(text, previous, token)) {
      let start = i;
      while (start > 0 && i - start < 5 && space(text, tokens[start - 1], tokens[start])) start--;
      const left = tokens.slice(start, i);
      const verbIndex = left.findLastIndex(t => MANNER_VERBS.has(t.lower));
      const verbPosition = start + verbIndex;
      const subject = tokens[verbPosition - 1];
      let determinerIndex = verbPosition - 2;
      while (determinerIndex >= 0 && verbPosition - determinerIndex <= 4 && MODIFIERS.has(tokens[determinerIndex].lower)) determinerIndex--;
      const determiner = tokens[determinerIndex];
      const hasSubject = verbIndex >= 0 && subject && space(text, subject, tokens[verbPosition]) &&
        (PERSONAL.has(subject.lower) || (isNoun(subject.lower) && determiner && BEFORE_NOUN.has(determiner.lower) && isHeadStart(determinerIndex)));
      const mannerTail = !next || sentenceBoundary(text, token, next) || (space(text, token, next) && ['at', 'in', 'on', 'with', 'without', 'through', 'toward', 'towards', 'to', 'for', 'before', 'after', 'until', 'when', 'while', 'as', 'than', 'and', 'but'].includes(next.lower));
      if (hasSubject && mannerTail &&
          !left.some(t => ['be', 'been', 'being', 'am', 'is', 'are', 'was', 'were', 'seem', 'seemed', 'remain', 'remained', 'look', 'looked', 'sound', 'sounded', 'feel', 'felt', 'call', 'called', 'found', 'made'].includes(t.lower)) &&
          (!next || !space(text, token, next) || (!isNoun(next.lower) && !/ly$/u.test(next.lower))))
        add(i, manner, 'manner-form', ['manner-verb=' + left.findLast(t => MANNER_VERBS.has(t.lower)).lower]);
    }

    // Lie/lay: use an explicit object and past-time evidence rather than
    // treating every occurrence of 'lay' as an error.
    if (word === 'lay' && next && ['a', 'an', 'the', 'my', 'his', 'her', 'our', 'their'].includes(next.lower)) {
      let object = i + 2;
      while (tokens[object] && object - i <= 4 && MODIFIERS.has(tokens[object].lower)) object++;
      if (tokens[object] && DIRECT_OBJECTS.has(tokens[object].lower) && connected(i, object)) {
        let end = object;
        while (tokens[end + 1] && end - object < 12 && !sentenceBoundary(text, tokens[end], tokens[end + 1])) end++;
        const tail = tokens.slice(object + 1, end + 1).map(t => t.lower);
        const pastTime = tail.includes('yesterday') || tail.includes('ago') || tail.some((w, j) => w === 'last' && ['night', 'week', 'month', 'year'].includes(tail[j + 1]));
        if (pastTime) add(i, 'laid', 'finite-verb-form', ['finite-pattern=lay-object-past']);
      }
    }
    if (['rung', 'sung', 'swum', 'begun'].includes(word) && previous && space(text, previous, token) &&
        (PERSONAL.has(previous.lower) || word === 'rung' && ['bell', 'bells', 'alarm', 'alarms', 'phone', 'phones', 'telephone', 'telephones', 'clock', 'clocks', 'chime', 'chimes', 'gong', 'gongs'].includes(previous.lower))) {
      const before = tokens[i - 2];
      if ((!before || !['have', 'has', 'had', 'be', 'been', 'is', 'are', 'was', 'were'].includes(before.lower)) && next?.lower !== 'by')
        add(i, { rung: 'rang', sung: 'sang', swum: 'swam', begun: 'began' }[word], 'finite-verb-form', ['finite-pattern=bare-participle']);
    }
  }
  return result;
}
