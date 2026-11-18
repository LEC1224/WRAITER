import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { wordCount } from './document.js';

export const wordCountKey = new PluginKey('wraiterWordCount');

function nodeWords(node) {
  return wordCount(node.textBetween(0, node.content.size, ' ', ' '));
}

export function documentWordCount(doc) {
  let count = 0;
  doc.forEach(node => { count += nodeWords(node); });
  return count;
}

function affectedChildren(doc, ranges) {
  const indices = new Set();
  if (!doc.childCount) return indices;
  for (const [start, end] of ranges) {
    const from = Math.max(0, Math.min(doc.content.size, start));
    const to = Math.max(from, Math.min(doc.content.size, end));
    const first = doc.resolve(from).index(0), last = doc.resolve(to).index(0);
    // Include one neighbour on either side. Joining/splitting at a block edge
    // can change which block owns the boundary even when a StepMap side is 0.
    for (let index = Math.max(0, first - 1); index <= Math.min(doc.childCount - 1, last + 1); index++) indices.add(index);
  }
  return indices;
}

function wordsAt(doc, indices) {
  let count = 0;
  for (const index of indices) count += nodeWords(doc.child(index));
  return count;
}

function wordWindow(node, start, end) {
  let from = Math.max(0, start - 4), to = Math.min(node.content.size, end + 4);
  // Keep full Unicode code points at the edges of the bounded window.
  const at = position => node.textBetween(position, position + 1, ' ', ' ').charCodeAt(0);
  if (from > 0 && at(from) >= 0xdc00 && at(from) <= 0xdfff && at(from - 1) >= 0xd800 && at(from - 1) <= 0xdbff) from--;
  if (to < node.content.size && at(to - 1) >= 0xd800 && at(to - 1) <= 0xdbff && at(to) >= 0xdc00 && at(to) <= 0xdfff) to++;
  return wordCount(node.textBetween(from, to, ' ', ' '));
}

function localWordDelta(before, after, step, oldRanges, newRanges) {
  if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd || oldRanges.length !== 1 || newRanges.length !== 1) return null;
  let inline = true; step.slice.content.forEach(node => { if (!node.isInline) inline = false; });
  if (!inline) return null;
  const [oldStart, oldEnd] = oldRanges[0], [newStart, newEnd] = newRanges[0];
  const oldFrom = before.resolve(oldStart), oldTo = before.resolve(oldEnd), newFrom = after.resolve(newStart), newTo = after.resolve(newEnd);
  if (!oldFrom.sameParent(oldTo) || !newFrom.sameParent(newTo) || !oldFrom.parent.isTextblock || !newFrom.parent.isTextblock || oldFrom.parent.type !== newFrom.parent.type || oldFrom.start() !== newFrom.start() || oldFrom.parentOffset !== newFrom.parentOffset) return null;
  // Word starts depend on the preceding two code points. Two code points on
  // each side cover joins/splits involving apostrophes and hyphens as well.
  return wordWindow(newFrom.parent, newFrom.parentOffset, newTo.parentOffset) - wordWindow(oldFrom.parent, oldFrom.parentOffset, oldTo.parentOffset);
}

export function updateWordCount(previous, transaction) {
  if (!transaction.docChanged) return previous;
  let count = previous;
  transaction.steps.forEach((step, index) => {
    const before = transaction.docs[index];
    const after = transaction.docs[index + 1] || transaction.doc;
    const oldRanges = [], newRanges = [];
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      oldRanges.push([oldStart, oldEnd]); newRanges.push([newStart, newEnd]);
    });
    if (!oldRanges.length) return;
    const delta = localWordDelta(before, after, step, oldRanges, newRanges);
    count += delta ?? wordsAt(after, affectedChildren(after, newRanges)) - wordsAt(before, affectedChildren(before, oldRanges));
  });
  return count;
}

export const WordCount = Extension.create({
  name: 'wraiterWordCount',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: wordCountKey,
      state: {
        init: (_config, state) => documentWordCount(state.doc),
        apply: (transaction, previous) => updateWordCount(previous, transaction)
      }
    })];
  }
});
