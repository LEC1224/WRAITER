// Supplemental syntax proposals; UTF-16 spans match the editor's offsets.
// The caller supplies its existing tokenization so this pass is linear.
const PAST = { gone: 'went', seen: 'saw', eaten: 'ate', taken: 'took', given: 'gave', written: 'wrote', broken: 'broke', spoken: 'spoke', done: 'did', known: 'knew', drunk: 'drank', run: 'ran', begun: 'began', come: 'came', been: 'was', had: 'had', made: 'made', found: 'found', left: 'left', said: 'said', told: 'told', bought: 'bought', brought: 'brought', thought: 'thought', felt: 'felt', met: 'met', read: 'read', heard: 'heard', slept: 'slept', lost: 'lost', built: 'built', sent: 'sent', kept: 'kept', won: 'won' };
const REGULAR = new Set('arrived asked called changed cleaned closed cooked danced decided explained finished helped jumped laughed liked lived looked moved needed opened played pulled pushed reached remembered returned started stopped talked touched tried turned used visited waited walked wanted washed watched worked'.split(' '));
const NUMBER = new Set('a one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred several few couple'.split(' '));
const UNIT = new Set('second seconds minute minutes hour hours day days week weeks month months year years decade decades'.split(' '));
const REPORT = new Set('asked ask asks wondered wonder wonders knew know knows learned learn realised realized remember remembered tell told explain explained discovered discover'.split(' '));
const WH = new Set('where when why how'.split(' '));
const BE = new Set('is are was were'.split(' '));
const NP_HEADS = new Set('inn inns ferry ferries horse horses sky skies patient patients stranger strangers sailor sailors feast feasts window windows well wells brother brothers coat coats name names ring rings captain captains station stations house houses door doors room rooms key keys book books shop shops store stores road roads path paths village villages town towns city cities building buildings hotel hotels school schools library libraries museum museums hospital hospitals office offices market markets park parks bridge bridges train trains bus buses car cars person people man men woman women child children dog dogs cat cats friend friends teacher teachers student students manager managers answer answers problem problems meeting meetings party parties event events restaurant restaurants entrance entrances exit exits bathroom bathrooms kitchen kitchens garden gardens castle castles dragon dragons guard guards'.split(' '));
const NP_MODIFIERS = new Set('far near nearby nearest next old new large small big little main local central first last lost missing red blue green black white tall short young strange abandoned secret locked open north south east west'.split(' '));
const SUBJECT = new Set('i you he she it we they'.split(' '));
const BREAK = /[.!?;:\n\ufffc]/u;
function joined(text, a, b) { return /^[^\S\r\n]+$/u.test(text.slice(a.to, b.from)); }
function quoteAt(text, position) {
  const line = text.slice(text.lastIndexOf('\n', position - 1) + 1, position);
  return (line.match(/"/g) || []).length % 2 === 1 || (line.match(/“/g) || []).length > (line.match(/”/g) || []).length;
}
function contextFeatures(text, tokens, start, end, category) {
  let left = start;
  while (left > 0 && start - left < 12 && !BREAK.test(text.slice(tokens[left - 1].to, tokens[left].from))) left--;
  const context = tokens.slice(left, end + 1).map(token => token.lower);
  const quoted = quoteAt(text, tokens[start].from);
  return [`category=${category}`, `syntax-quoted=${quoted}`, `category=${category}|syntax-quoted=${quoted}`, `syntax-has-since=${context.includes('since')}`, `syntax-has-ago=${context.includes('ago')}`, `syntax-clause-length=${Math.min(end - left + 1, 12)}`];
}
function capitalization(original, replacement) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}
export function syntaxCandidates(text, tokens) {
  const candidates = [];
  function add(start, end, replacement, category, extra = []) {
    const from = tokens[start].from, to = tokens[end].to, original = text.slice(from, to);
    candidates.push({ from, to, original, replacement: capitalization(original, replacement), category,
      features: [...contextFeatures(text, tokens, start, end, category), ...extra] });
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Require a complete, immediately adjacent duration and "ago" after a
    // known participle. "since ... ago" and embedded clauses are excluded.
    if ((t.lower === 'has' || t.lower === 'have') && i + 4 < tokens.length) {
      const part = tokens[i + 1], number = tokens[i + 2], unit = tokens[i + 3], ago = tokens[i + 4];
      const past = Object.hasOwn(PAST, part.lower) ? PAST[part.lower] : (REGULAR.has(part.lower) ? part.lower : null);
      if (past && (part.lower !== 'been' || SUBJECT.has(tokens[i - 1]?.lower)) && NUMBER.has(number.lower) && UNIT.has(unit.lower) && ago.lower === 'ago' &&
          [t, part, number, unit].every((item, n) => joined(text, item, tokens[i + n + 1]))) {
        let left = i;
        while (left > 0 && i - left < 12 && !BREAK.test(text.slice(tokens[left - 1].to, tokens[left].from))) left--;
        const preceding = tokens.slice(left, i).map(item => item.lower);
        if (!preceding.includes('since') && !preceding.includes('that') && !preceding.includes('when')) {
          const subject = tokens[i - 1]?.lower;
          const replacement = part.lower === 'been' && ['you', 'we', 'they'].includes(subject) ? 'were' : past;
          add(i, i + 1, replacement, 'perfect-finished-time', ['syntax-finished-duration=true', `syntax-subject=${subject || '<none>'}`]);
        }
      }
    }
    // Only unambiguous pronoun subjects are moved. Reporting word and WH must
    // be close and separated by whitespace, optionally with an object pronoun.
    if (REPORT.has(t.lower)) {
      let wh = i + 1;
      if (['me', 'him', 'her', 'us', 'them'].includes(tokens[wh]?.lower)) wh++;
      if (wh + 2 >= tokens.length || !WH.has(tokens[wh].lower) || !BE.has(tokens[wh + 1].lower)) continue;
      const subjectStart = wh + 2;
      let subjectEnd = subjectStart;
      if (!SUBJECT.has(tokens[subjectStart].lower)) {
        if (tokens[subjectStart].lower !== 'the') continue;
        let head = subjectStart + 1;
        while (head < tokens.length && head - subjectStart <= 2 && NP_MODIFIERS.has(tokens[head].lower)) head++;
        if (head >= tokens.length || head - subjectStart > 3 || !NP_HEADS.has(tokens[head].lower)) continue;
        subjectEnd = head;
        // A following relative clause changes the phrase being reordered.
        if (['who', 'which', 'that', 'whose'].includes(tokens[head + 1]?.lower) && joined(text, tokens[head], tokens[head + 1])) continue;
      }
      let consecutive = true;
      for (let j = i; j < subjectEnd; j++) if (!joined(text, tokens[j], tokens[j + 1])) consecutive = false;
      if (!consecutive || quoteAt(text, tokens[wh].from)) continue;
      const verb = tokens[wh + 1], subject = tokens[subjectStart];
      const subjectText = text.slice(subject.from, tokens[subjectEnd].to);
      add(wh + 1, subjectEnd, `${subjectText} ${verb.word}`, 'indirect-question-order', [`syntax-wh=${tokens[wh].lower}`, `syntax-report=${t.lower}`, `syntax-subject=${SUBJECT.has(subject.lower) ? subject.lower : 'definite-np'}`]);
    }
  }
  return candidates;
}

