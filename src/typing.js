// Return a single insertion or replacement for optional, local typography.
// Existing text is never rewritten in bulk and undo remains an ordinary edit.
export function smartPunctuation(before, text) {
  if (text === '-' && before.endsWith('-')) return { remove: 1, text: '—' };
  if (text === '.' && before.endsWith('..')) return { remove: 2, text: '…' };
  if (text === '"' || text === "'") {
    const previous = before.at(-1) || '';
    const opening = !previous || /[\s([{\u2014]/u.test(previous);
    return { remove: 0, text: text === '"' ? (opening ? '“' : '”') : (opening ? '‘' : '’') };
  }
  return null;
}

// Substitutions trigger on a typed space and only at a word boundary. They are
// literal, case-sensitive, and never run over pasted or existing manuscript.
export function textSubstitution(before, typed, rules) {
  if (typed !== ' ' || !Array.isArray(rules)) return null;
  for (const rule of [...rules].sort((a, b) => (b.from?.length || 0) - (a.from?.length || 0))) {
    if (!rule.from || rule.from.includes('\ufffc') || typeof rule.to !== 'string' || !before.endsWith(rule.from)) continue;
    const previous = before.slice(0, -rule.from.length).at(-1) || '';
    if (previous && /[\p{L}\p{N}\p{M}_]/u.test(previous) && /^[\p{L}\p{N}\p{M}_]/u.test(rule.from)) continue;
    return { remove: rule.from.length, text: rule.to + typed };
  }
  return null;
}
