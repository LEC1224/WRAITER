import { paragraphPositions, paragraphCovering } from './grammar-positions.js';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Mark } from '@tiptap/pm/model';
import { diffChars } from 'diff';
import { suggestText, trackModeKey } from './tracked-editor.js';
import { updateHintDecorations } from './grammar-decorations.js';

export const aiGrammarKey = new PluginKey('aiGrammar');

// Passages are non-overlapping and ordered by document position. Keep only
// hints outside checked passages without comparing every hint with every block.
export function outsideCheckedPassages(hints, passages) {
  return hints.filter(hint => {
    let low = 0, high = passages.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (passages[middle].from <= hint.from) low = middle + 1; else high = middle;
    }
    const passage = passages[low - 1];
    return !(passage && hint.from >= passage.from && hint.to <= passage.to);
  });
}
function hintDecoration(hint) {
  return Decoration.inline(hint.from, hint.to, {
    class: 'ai-grammar-hint', 'data-ai-grammar-id': hint.id,
    'aria-description': ['AI grammar suggestion.', hint.reason, hint.replacement ? `Suggested wording: ${hint.replacement}` : 'Remove the underlined text.'].filter(Boolean).join(' ')
  }, { hint });
}

export const AIGrammar = Extension.create({
  name: 'aiGrammar',
  addProseMirrorPlugins() {
    return [new Plugin({ key: aiGrammarKey, state: {
      init: () => ({ hints: [], decorations: DecorationSet.empty }),
      apply(tr, previous) {
        const update = tr.getMeta(aiGrammarKey);
        if (!update && (!tr.docChanged || !previous.hints.length)) return previous;
        // Resolving thousands of absolute positions separately walks the same
        // top-level siblings repeatedly. Index this transaction once.
        const blocks = !update && previous.hints.length >= 32 ? paragraphPositions(tr.doc) : null;
        const hints = update ?? previous.hints.map(hint => mapGrammarHint(hint, tr, blocks)).filter(Boolean);
        return { hints, decorations: updateHintDecorations(tr, previous.decorations, previous.hints, hints, hintDecoration) };
      }
    }, props: { decorations: state => aiGrammarKey.getState(state).decorations } })];
  }
});

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const paragraphCache = new WeakMap();
const passageCache = new WeakMap();
function sentenceRanges(text) {
  const ranges = [];
  for (const part of sentenceSegmenter.segment(text)) {
    const previous = ranges.at(-1), before = previous && text.slice(previous.from, previous.to).trimEnd();
    // ICU treats some titles and hard line breaks as sentence endings. Keep
    // these together so changing a subject cannot leave a stale verb hint.
    const abbreviation = before && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)|(?:^|\s)\p{Lu})\.$/iu.test(before);
    if (previous && (abbreviation || !/[.!?…。！？]["'”’\])}]*$/u.test(before))) previous.to = part.index + part.segment.length;
    else ranges.push({ from: part.index, to: part.index + part.segment.length });
  }
  return ranges;
}
function paragraphData(node) {
  let data = paragraphCache.get(node);
  if (!data) {
    const text = node.textBetween(0, node.content.size, '', '\n');
    let supported = !node.type.spec.code;
    node.forEach(child => { if ((!child.isText && child.type.name !== 'hardBreak') || child.marks.some(mark => mark.type.name === 'trackedChange')) supported = false; });
    data = { text, supported, sentences: null }; paragraphCache.set(node, data);
  }
  return data;
}
function sentencesFor(data) {
  // A short paragraph is already a complete request passage. Only segment
  // its sentences when a returned hint needs grammatical context.
  return data.sentences ??= sentenceRanges(data.text);
}
function contextInText(text, ranges, from, to, offset) {
  let low = 0, high = ranges.length;
  while (low < high) { const middle = (low + high) >>> 1; if (ranges[middle].to <= from) low = middle + 1; else high = middle; }
  const first = ranges[low];
  high = ranges.length;
  while (low < high) { const middle = (low + high) >>> 1; if (ranges[middle].from < to) low = middle + 1; else high = middle; }
  const last = ranges[low - 1];
  if (!first || !last) return null;
  const raw = text.slice(first.from, last.to), leading = raw.length - raw.trimStart().length, trailing = raw.length - raw.trimEnd().length;
  const start = Math.min(first.from + leading, from), end = Math.max(last.to - trailing, to);
  return { from: offset + start, to: offset + end, text: text.slice(start, end) };
}

export function grammarContext(doc, from, to, blocks) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > doc.content.size) return null;
  let node, start;
  if (blocks) {
    const block = paragraphCovering(blocks, from, to);
    if (!block) return null;
    ({ node, start } = block);
  } else {
    const $from = doc.resolve(from), $to = doc.resolve(to);
    if (!$from.depth || !$from.sameParent($to) || !$from.parent.isTextblock) return null;
    node = $from.parent; start = $from.start();
  }
  const data = paragraphData(node);
  if (!data.supported) return null;
  return contextInText(data.text, sentencesFor(data), from - start, to - start, start);
}

// A result is attached to its original occurrence, never found again by text
// search. Both the marked words and their grammatical sentence must survive.
export function mapGrammarHint(hint, tr, blocks) {
  if (!hint || !tr.docChanged) return hint;
  const context = hint.context || grammarContext(tr.before, hint.from, hint.to);
  if (!context) return null;
  const from = tr.mapping.mapResult(hint.from, 1), to = tr.mapping.mapResult(hint.to, -1);
  const start = tr.mapping.mapResult(context.from, 1), end = tr.mapping.mapResult(context.to, -1);
  if ([from, to, start, end].some(result => result.deletedAcross) || from.pos >= to.pos) return null;
  const next = grammarContext(tr.doc, from.pos, to.pos, blocks);
  if (!next || next.from !== start.pos || next.to !== end.pos || next.text !== context.text || next.text.slice(from.pos - next.from, to.pos - next.from) !== hint.original) return null;
  return from.pos === hint.from && to.pos === hint.to && next.from === context.from && next.to === context.to ? hint : { ...hint, from: from.pos, to: to.pos, context: next };
}

// Collect without moving the caret. Long paragraphs are split only at sentence
// boundaries; an individual sentence over the request limit is left for review.
export function inlineGrammarPassages({ doc }) {
  const cached = passageCache.get(doc);
  if (cached) return cached;
  const passages = []; let paragraph = 0;
  doc.descendants((node, pos) => {
    if (node.type.spec.code || node.type.name === 'note') return false;
    if (!node.isTextblock) return;
    paragraph++;
    const data = paragraphData(node);
    if (!data.supported) return false;
    const add = (start, end) => {
      const text = data.text.slice(start, end);
      if (text.trim().length < 3) return;
      passages.push({ id: `paragraph-${pos + 1}-${start}`, chapterTitle: '', paragraph, text, from: pos + 1 + start, to: pos + 1 + end });
    };
    if (data.text.length <= 4000) add(0, data.text.length);
    else {
      let start = null, end = 0;
      for (const sentence of sentencesFor(data)) {
        if (start !== null && sentence.to - start > 4000) { add(start, end); start = null; }
        if (sentence.to - sentence.from > 4000) continue;
        if (start === null) start = sentence.from;
        end = sentence.to;
      }
      if (start !== null) add(start, end);
    }
    return false;
  });
  passageCache.set(doc, passages); return passages;
}

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
let findingSequence = 0;
export function inlineGrammarFindings(result, passage) {
  if (!result?.findings?.length) return [];
  const hints = [], sentences = sentenceRanges(passage.text);
  for (const item of result?.findings || []) {
    if (hints.length >= 32) break;
    if (item.passageId !== passage.id || !['definite', 'likely'].includes(item.severity) || !categories.has(item.category)) continue;
    if (!Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > passage.text.length) continue;
    if (typeof item.original !== 'string' || passage.text.slice(item.start, item.end) !== item.original || typeof item.replacement !== 'string' || item.replacement.length > 4000 || /[\r\n\0]/.test(item.replacement) || item.original === item.replacement) continue;
    if (hints.some(hint => passage.from + item.start < hint.to && passage.from + item.end > hint.from)) continue;
    // A moved finding must not collide with a new finding at its old position.
    hints.push({ id: `ai-${++findingSequence}`, from: passage.from + item.start, to: passage.from + item.end,
      original: item.original, replacement: item.replacement, reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 800) : '', category: item.category, severity: item.severity,
      context: contextInText(passage.text, sentences, item.start, item.end, passage.from) });
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
  return grammarCorrectionTransaction(state, hint, 'Apply AI grammar hint');
}

// Both local and AI suggestions must preserve marks, comments, tracked edits
// and exact source positions. Neither checker may replace stale text.
export function grammarCorrectionTransaction(state, hint, label = 'Apply local grammar hint') {
  if (!hint || typeof hint.original !== 'string' || typeof hint.replacement !== 'string' || hint.from < 0 || hint.to <= hint.from || hint.to > state.doc.content.size || state.doc.textBetween(hint.from, hint.to, '', '\n') !== hint.original) throw new Error('This passage changed. Wait for a fresh grammar check.');
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
    return closeHistory(transaction).setMeta('historyLabel', label);
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
  return closeHistory(tr).setMeta('historyLabel', label);
}
