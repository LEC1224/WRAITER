import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Mark } from '@tiptap/pm/model';
import { diffChars } from 'diff';
import { suggestText, trackModeKey } from './tracked-editor.js';

export const aiGrammarKey = new PluginKey('aiGrammar');
export const AIGrammar = Extension.create({
  name: 'aiGrammar',
  addProseMirrorPlugins() {
    return [new Plugin({ key: aiGrammarKey, state: {
      init: () => ({ hints: [], decorations: DecorationSet.empty }),
      apply(tr, previous) {
        const hints = tr.getMeta(aiGrammarKey) ?? (tr.docChanged ? [] : null);
        if (!hints) return previous;
        return { hints, decorations: DecorationSet.create(tr.doc, hints.map(hint => Decoration.inline(hint.from, hint.to, {
          class: 'ai-grammar-hint', 'data-ai-grammar-id': hint.id,
          'aria-description': ['AI grammar suggestion.', hint.reason, hint.replacement ? `Suggested wording: ${hint.replacement}` : 'Remove the underlined text.'].filter(Boolean).join(' ')
        }))) };
      }
    }, props: { decorations: state => aiGrammarKey.getState(state).decorations } })];
  }
});

// Only the paragraph at the caret is sent. Notes, image captions, code and
// paragraphs with pending revisions are excluded, rather than flattening them.
export function inlineGrammarPassage(state, { forCache = false } = {}) {
  const { empty, $from, $to } = state.selection, block = $from.parent;
  if (!empty && !(forCache && $from.sameParent($to))) return null;
  if (!$from.depth || !block.isTextblock || block.type.spec.code || block.content.size > 4000) return null;
  let supported = true;
  block.forEach(child => {
    if (!child.isText && child.type.name !== 'hardBreak' || child.marks.some(mark => mark.type.name === 'trackedChange')) supported = false;
  });
  if (!supported) return null;
  const text = block.textBetween(0, block.content.size, '', '\n');
  if (!text.trim() || text.length < 8) return null;
  return { id: 'active-paragraph', chapterTitle: '', paragraph: 1, text, from: $from.start(), to: $from.end() };
}

const categories = new Set(['grammar', 'spelling', 'punctuation', 'wrong-word-typo', 'wrong-word-meaning', 'agreement-tense', 'capitalization']);
export function inlineGrammarFindings(result, passage) {
  const hints = [];
  for (const item of result?.findings || []) {
    if (hints.length >= 32) break;
    if (item.passageId !== passage.id || !['definite', 'likely'].includes(item.severity) || !categories.has(item.category)) continue;
    if (!Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > passage.text.length) continue;
    if (typeof item.original !== 'string' || passage.text.slice(item.start, item.end) !== item.original || typeof item.replacement !== 'string' || item.replacement.length > 4000 || /[\r\n\0]/.test(item.replacement) || item.original === item.replacement) continue;
    if (hints.some(hint => passage.from + item.start < hint.to && passage.from + item.end > hint.from)) continue;
    hints.push({ id: `ai-${passage.from}-${item.start}-${item.end}`, from: passage.from + item.start, to: passage.from + item.end,
      original: item.original, replacement: item.replacement, reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 800) : '', category: item.category, severity: item.severity });
  }
  return hints;
}

export function grammarHintForMenu(state, targetId, keyboard) {
  const hints = aiGrammarKey.getState(state)?.hints || [];
  if (!keyboard) return hints.find(hint => hint.id === targetId);
  const { from, to, empty } = state.selection;
  return hints.find(hint => hint.from <= from && from < hint.to && to <= hint.to)
    || (empty ? hints.find(hint => hint.to === from) : undefined);
}

// Send only a short display preview to the native menu. The editor retains
// the complete finding; a change too long to show in full opens review first.
export function grammarMenuPreview({ original, replacement }) {
  const wording = value => /^ +$/.test(value) ? (value.length === 1 ? '1 space' : value.length + ' spaces')
    : value.replace(/\n/g, '↵').replace(/\t/g, '⇥').replace(/^ +| +$/g, spaces => '␣'.repeat(spaces.length));
  const before = wording(original), after = wording(replacement);
  if (/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u.test(before + after)) return { preview: '', reviewOnly: true };
  const change = replacement === '' ? 'Remove “' + before + '”' : before + ' → ' + after;
  if ([...change].length <= 52) return { preview: change, reviewOnly: false };
  // Dropping shared whole words keeps a change at the end of a long phrase
  // visible. This is display-only; review still shows the entire finding.
  const words = text => text.match(/\s+|\S+/gu) || [], a = words(original), b = words(replacement);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (start < endA && start < endB && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const removed = wording(a.slice(start, endA).join('')), added = wording(b.slice(start, endB).join(''));
  const clip = (value, limit) => { const chars = Array.from(value); return chars.length <= limit ? value : chars.slice(0, limit - 1).join('') + '…'; };
  const preview = !added ? 'Remove “' + clip(removed, 36) + '”' : !removed ? 'Insert “' + clip(added, 36) + '”' : clip(removed, 23) + ' → ' + clip(added, 23);
  return { preview, reviewOnly: true };
}

export function aiGrammarTransaction(state, hint) {
  if (!hint || !aiGrammarKey.getState(state)?.hints.includes(hint) || hint.to > state.doc.content.size || state.doc.textBetween(hint.from, hint.to, '', '\n') !== hint.original) throw new Error('This passage changed. Wait for a fresh grammar check.');
  const uniformMarks = (from, to) => {
    let marks;
    state.doc.nodesBetween(from, to, node => {
      if (!node.isInline) return;
      if (!node.isText) throw new Error('Review changes to line breaks in the proofreading dialog.');
      if (marks && !Mark.sameSet(marks, node.marks)) throw new Error('This correction crosses formatting or comment boundaries. Review it manually to preserve them.');
      marks = node.marks;
    });
    return marks || [];
  };
  if (trackModeKey.getState(state)) {
    const marks = uniformMarks(hint.from, hint.to);
    const transaction = suggestText(state, hint.from, hint.to, hint.replacement);
    if (!transaction) throw new Error('Review the existing tracked change before correcting this passage.');
    if (hint.replacement) {
      const insertion = transaction.doc.nodeAt(hint.to), revision = insertion?.marks.find(mark => mark.type.name === 'trackedChange');
      if (!revision) throw new Error('This tracked correction is no longer valid.');
      transaction.removeMark(hint.to, hint.to + hint.replacement.length);
      for (const mark of [...marks, revision]) transaction.addMark(hint.to, hint.to + hint.replacement.length, mark);
    }
    return closeHistory(transaction).setMeta('historyLabel', 'Apply AI grammar hint');
  }
  // Keep unchanged characters in their original runs. Refuse an individual
  // changed span that crosses a formatting/comment boundary instead of moving
  // that boundary or flattening the whole suggested phrase.
  const edits = []; let offset = 0, pending;
  const flush = () => { if (pending) edits.push(pending); pending = null; };
  for (const part of diffChars(hint.original, hint.replacement)) {
    if (part.added || part.removed) {
      if (!pending) pending = { from: hint.from + offset, to: hint.from + offset, text: '' };
      if (part.added) pending.text += part.value;
      else { offset += part.value.length; pending.to = hint.from + offset; }
    } else { flush(); offset += part.value.length; }
  }
  flush();
  for (const edit of edits) {
    if (edit.to > edit.from) edit.marks = uniformMarks(edit.from, edit.to);
    else {
      const $at = state.doc.resolve(edit.from), before = $at.nodeBefore?.marks || [], after = $at.nodeAfter?.marks || [];
      if (edit.from === hint.from) edit.marks = after;
      else if (edit.from === hint.to) edit.marks = before;
      else if (Mark.sameSet(before, after)) edit.marks = before;
      else throw new Error('This insertion is on a formatting or comment boundary. Review it manually to preserve that boundary.');
    }
  }
  const tr = state.tr;
  for (const edit of edits.reverse()) tr.replaceWith(edit.from, edit.to, edit.text ? state.schema.text(edit.text, edit.marks) : []);
  return closeHistory(tr).setMeta('historyLabel', 'Apply AI grammar hint');
}
