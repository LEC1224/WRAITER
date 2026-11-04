import { TextSelection } from '@tiptap/pm/state';

const letters = /\p{L}/u, wordCharacter = /[\p{L}\p{N}\p{M}'’]/u;

// Build one transaction from individual text runs. Replacing from the end
// keeps the original positions valid and preserves every run's existing marks,
// including private comment/bookmark anchors, even when Unicode casing expands.
export function changeCaseTransaction(state, mode) {
  if (!['upper', 'lower', 'title', 'sentence'].includes(mode)) throw new Error('Choose a supported case conversion.');
  const { from, to, empty } = state.selection;
  if (empty) throw new Error('Select text to change its case.');
  const runs = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const start = Math.max(pos, from), end = Math.min(pos + node.nodeSize, to);
    if (start < end) runs.push({ start, end, text: node.text.slice(start - pos, end - pos), marks: node.marks, parent: state.doc.resolve(start).parent });
  });
  let atWordStart = true, atSentenceStart = true, previousParent;
  for (const run of runs) {
    if (run.parent !== previousParent) { atWordStart = true; atSentenceStart = true; previousParent = run.parent; }
    run.replacement = Array.from(run.text, char => {
      if (mode === 'upper') return char.toUpperCase();
      if (mode === 'lower') return char.toLowerCase();
      if (mode === 'title') {
        const value = letters.test(char) ? (atWordStart ? char.toUpperCase() : char.toLowerCase()) : char;
        atWordStart = !wordCharacter.test(char);
        return value;
      }
      const value = letters.test(char) ? (atSentenceStart ? char.toUpperCase() : char.toLowerCase()) : char;
      if (letters.test(char)) atSentenceStart = false;
      else if (/[.!?]/u.test(char)) atSentenceStart = true;
      return value;
    }).join('');
  }
  const tr = state.tr;
  for (const run of runs.reverse()) if (run.replacement !== run.text) tr.replaceWith(run.start, run.end, state.schema.text(run.replacement, run.marks));
  if (!tr.docChanged) return null;
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from, -1), tr.mapping.map(to, 1)));
  tr.setMeta('historyLabel', 'Change text case');
  return tr;
}
