// Group ordinary case adaptations in a chapter while keeping an explicit
// capitalization correction distinguishable from a change in wording.
function correctionKey(hint, original) {
  const replacement = hint.replacement;
  if (typeof replacement !== 'string') return ['review', hint.rule, hint.reason];
  if (!replacement) return '';
  const lower = replacement.toLowerCase();
  let adapted = lower;
  if (original.length > 1 && original === original.toUpperCase()) adapted = lower.toUpperCase();
  else if (/^\p{Lu}/u.test(original)) adapted = lower.replace(/^./u, c => c.toUpperCase());
  return replacement === adapted ? lower : ['literal', original, replacement];
}

// Ignore follows the occurrence and the proposed edit. Two engines may offer
// the same deletion while including different surrounding spaces in the range.
export function grammarDismissal(hint) {
  let { from, to, original } = hint;
  if (hint.replacement === '' && /\S/u.test(original)) {
    const word = original.trim();
    from += original.indexOf(word);
    to = from + word.length;
    original = word;
  }
  return { from, to, original, key: JSON.stringify([hint.category, original.toLowerCase(), correctionKey(hint, original)]) };
}

export function mapGrammarDismissal(dismissal, transaction) {
  // Map inward at both boundaries so newly typed neighboring text stays
  // outside the dismissed occurrence. Paragraph objects change on every edit.
  const from = transaction.mapping.mapResult(dismissal.from, 1);
  const to = transaction.mapping.mapResult(dismissal.to, -1);
  if (from.deleted || to.deleted || to.pos - from.pos !== dismissal.original.length) return null;
  if (transaction.doc.textBetween(from.pos, to.pos, '\n', '\ufffc') !== dismissal.original) return null;
  return { ...dismissal, from: from.pos, to: to.pos };
}
