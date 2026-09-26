import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
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
    count += wordsAt(after, affectedChildren(after, newRanges)) - wordsAt(before, affectedChildren(before, oldRanges));
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
