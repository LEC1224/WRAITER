const SAFE_INTRANSITIVE = new Set('arrive arrives arrived belong belongs belonged collapse collapses collapsed disappear disappears disappeared die dies died exist exists existed happen happens happened vanish vanishes vanished'.split(' '));
const OBJECT_CUES = new Set('a an the this that these those his her its my your our their some any how what when where why whether'.split(' '));
const ADVERBS = new Set('also always barely finally just never often only really still suddenly usually'.split(' '));
const space = (text, left, right) => /^[^\S\r\n]+$/u.test(text.slice(left.to, right.from));

// A relative pronoun can be the object ("which it took me hours to fix").
// Only propose dropping a resumptive pronoun before unambiguously
// intransitive verb uses, never from generic "which it" occurrences.
export function relativeCandidates(text, tokens) {
  const output = [];
  for (let i = 1; i + 1 < tokens.length; i++) {
    const which = tokens[i - 1], pronoun = tokens[i], antecedent = tokens[i - 2];
    if (which.lower !== 'which' || !/^(?:it|they|he|she)$/u.test(pronoun.lower) ||
        !antecedent || !/^\s*,\s*$/u.test(text.slice(antecedent.to, which.from)) ||
        !space(text, which, pronoun) || !space(text, pronoun, tokens[i + 1])) continue;
    let index = i + 1;
    if (ADVERBS.has(tokens[index].lower) && tokens[index + 1] && space(text, tokens[index], tokens[index + 1])) index++;
    const verb = tokens[index];
    if (!SAFE_INTRANSITIVE.has(verb.lower)) continue;
    const follower = tokens[index + 1];
    if (follower && space(text, verb, follower) && OBJECT_CUES.has(follower.lower)) continue;
    const from = pronoun.from, to = tokens[i + 1].from;
    const category = 'relative-subject';
    const start = text.lastIndexOf('\n', from - 1) + 1;
    const prefix = text.slice(start, from);
    const dialogue = (prefix.match(/"/gu)?.length ?? 0) % 2 === 1 ||
      (prefix.match(/“/gu)?.length ?? 0) > (prefix.match(/”/gu)?.length ?? 0);
    output.push({
      from, to, original: text.slice(from, to), replacement: '', category,
      features: [
        'category=' + category, 'relative-pronoun=' + pronoun.lower,
        'relative-verb=' + verb.lower, 'relative-adverb=' + String(index > i + 1),
        'in-dialogue=' + dialogue, 'category=' + category + '|in-dialogue=' + dialogue
      ]
    });
  }
  return output;
}

