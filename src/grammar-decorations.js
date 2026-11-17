import { DecorationSet } from '@tiptap/pm/view';

// A status update, a completed worker batch or a keystroke often leaves most
// underlines intact. A replace step can drop a mark within its span, so use
// the actual mapped ranges and restore any missing decoration.
export function updateHintDecorations(tr, set, previous, hints, decorate) {
  if (!hints.length) return DecorationSet.empty;
  if (!tr.docChanged && hints.length === previous.length && hints.every((hint, i) => hint === previous[i])) return set;
  const mapped = tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
  if (mapped === DecorationSet.empty) return DecorationSet.create(tr.doc, hints.map(decorate));

  const missing = new Map(hints.map(hint => [hint.id, hint])), removed = [];
  for (const mark of mapped.find()) {
    const old = mark.spec.hint, hint = missing.get(old.id);
    if (hint && hint.from === mark.from && hint.to === mark.to &&
        hint.reason === old.reason && hint.replacement === old.replacement && hint.category === old.category) missing.delete(old.id);
    else removed.push(mark);
  }
  if (missing.size === hints.length) return DecorationSet.create(tr.doc, hints.map(decorate));
  return mapped.remove(removed).add(tr.doc, Array.from(missing.values(), decorate));
}
