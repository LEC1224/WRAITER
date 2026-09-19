import { diffChars } from 'diff';
import { EditorState } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';

const fingerprintInput = project => JSON.stringify([project.id, project.title, project.chapters.map(chapter => [chapter.id, chapter.title, chapter.content])]);
export async function agentProjectFingerprint(project) {
  const bytes = new TextEncoder().encode(fingerprintInput(project));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function textEdits(before, after, start) {
  const edits = []; let offset = 0, pending = null;
  const flush = () => { if (pending) edits.push(pending); pending = null; };
  const differences = diffChars(before, after, { timeout: 1800, maxEditLength: 20000 });
  if (!differences) throw new Error('This revision is too large to apply while preserving formatting. No changes were applied; split the request into smaller passages.');
  for (const part of differences) {
    if (part.added || part.removed) {
      if (!pending) pending = { from: start + offset, to: start + offset, text: '' };
      if (part.added) pending.text += part.value;
      else { offset += part.value.length; pending.to = start + offset; }
    } else { flush(); offset += part.value.length; }
  }
  flush(); return edits;
}

// A result contains text-block changes at the positions of the request's
// document. Validate the entire baseline before touching any chapter. Unchanged
// nodes, paragraph attributes, links, images, and inline marks remain intact.
export async function applyAgentResult(project, result, schema) {
  if (!result || result.projectId !== project.id || await agentProjectFingerprint(project) !== result.baseFingerprint) throw new Error('The document changed while the assistant was working. No AI edits were applied; send the request again against the current text.');
  if (!Array.isArray(result.edits) || !Array.isArray(result.chapterTitles) || result.edits.length > 300000 || result.chapterTitles.length > 2000) throw new Error('The assistant returned invalid document edits. No changes were applied.');
  const chapterMap = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  const content = new Map(); const titles = new Map(); const editsByChapter = new Map();
  for (const edit of result.edits) {
    if (!chapterMap.has(edit.chapterId) || !Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < (edit.kind === 'delete_paragraph' ? 0 : 1) || edit.to < edit.from || typeof edit.before !== 'string' || typeof edit.after !== 'string' || edit.after.length > 2000000 || (edit.kind && edit.kind !== 'delete_paragraph')) throw new Error('The assistant returned an invalid text range. No changes were applied.');
    if (!editsByChapter.has(edit.chapterId)) editsByChapter.set(edit.chapterId, []);
    editsByChapter.get(edit.chapterId).push(edit);
  }
  for (const edit of result.chapterTitles) {
    const chapter = chapterMap.get(edit.chapterId);
    if (!chapter || chapter.title !== edit.before || typeof edit.after !== 'string' || edit.after.length > 2000 || titles.has(edit.chapterId)) throw new Error('A chapter title changed while the assistant was working. No changes were applied.');
    titles.set(edit.chapterId, edit.after);
  }
  for (const [chapterId, edits] of editsByChapter) {
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(chapterMap.get(chapterId).content) });
    const sorted = [...edits].sort((a, b) => a.from - b.from); let previousEnd = -1;
    for (const edit of sorted) {
      if (edit.from < previousEnd || edit.to > state.doc.content.size) throw new Error('The assistant returned overlapping document edits. No changes were applied.');
      if (edit.kind === 'delete_paragraph') {
        const node = state.doc.nodeAt(edit.from);
        if (node?.type.name !== 'paragraph' || node.nodeSize !== edit.to - edit.from || !edit.beforeNode || !node.eq(schema.nodeFromJSON(edit.beforeNode)) || edit.after !== '') throw new Error('The paragraph to remove no longer matches. No changes were applied.');
        previousEnd = edit.to; continue;
      }
      const $from = state.doc.resolve(edit.from), $to = state.doc.resolve(edit.to);
      if (!$from.sameParent($to) || !$from.parent.isTextblock || $from.parentOffset !== 0 || $to.parentOffset !== $to.parent.content.size || state.doc.textBetween(edit.from, edit.to, '', '\n') !== edit.before) throw new Error('The source passage changed or is not a complete text block. No changes were applied.');
      previousEnd = edit.to;
    }
    let transaction = state.tr;
    for (const block of sorted.reverse()) {
      if (block.kind === 'delete_paragraph') {
        const $from = transaction.doc.resolve(block.from), index = $from.index();
        if (!$from.parent.canReplace(index, index + 1)) throw new Error('This paragraph is required by its container. No changes were applied.');
        transaction.delete(block.from, block.to); continue;
      }
      for (const edit of textEdits(block.before, block.after, block.from).reverse()) {
        if (!edit.text.includes('\n')) transaction.insertText(edit.text, edit.from, edit.to);
        else {
          if (!schema.nodes.hardBreak) throw new Error('This document does not support the requested line break. No changes were applied.');
          const $from = transaction.doc.resolve(edit.from), $to = transaction.doc.resolve(edit.to);
          const marks = $from.marksAcross($to) || $from.marks();
          const nodes = [];
          edit.text.split('\n').forEach((line, index) => { if (index) nodes.push(schema.nodes.hardBreak.create()); if (line) nodes.push(schema.text(line, marks)); });
          transaction.replaceWith(edit.from, edit.to, Fragment.fromArray(nodes));
        }
      }
    }
    transaction.doc.check(); content.set(chapterId, transaction.doc.toJSON());
  }
  const changedChapters = [...new Set([...content.keys(), ...titles.keys()])];
  if (!changedChapters.length) return { project, changedChapters: [], changeCount: 0 };
  return {
    project: { ...project, updatedAt: new Date().toISOString(), chapters: project.chapters.map(chapter => ({ ...chapter, ...(content.has(chapter.id) ? { content: content.get(chapter.id) } : {}), ...(titles.has(chapter.id) ? { title: titles.get(chapter.id) } : {}) })) },
    changedChapters,
    changeCount: result.edits.length + result.chapterTitles.length
  };
}

// An agent result is still safe when the author edited a different chapter
// while it was running. Reuse only the fields the agent actually changed and
// require those source fields to remain byte-for-byte equal to its baseline.
export function rebaseAgentResult(baseline, current, applied, result) {
  if (!baseline || !current || !applied?.project || baseline.id !== current.id || result?.projectId !== baseline.id) throw new Error('The document changed while the assistant was working. No AI edits were applied; send the request again against the current text.');
  const contentIds = new Set((result.edits || []).map(edit => edit.chapterId));
  const titleIds = new Set((result.chapterTitles || []).map(edit => edit.chapterId));
  const baselineChapters = new Map(baseline.chapters.map(chapter => [chapter.id, chapter]));
  const appliedChapters = new Map(applied.project.chapters.map(chapter => [chapter.id, chapter]));
  for (const chapterId of new Set([...contentIds, ...titleIds])) {
    const before = baselineChapters.get(chapterId), now = current.chapters.find(chapter => chapter.id === chapterId), after = appliedChapters.get(chapterId);
    if (!before || !now || !after || (contentIds.has(chapterId) && JSON.stringify(now.content) !== JSON.stringify(before.content)) || (titleIds.has(chapterId) && now.title !== before.title)) throw new Error('The document changed while the assistant was working. No AI edits were applied; send the request again against the current text.');
  }
  const chapters = current.chapters.map(chapter => {
    const after = appliedChapters.get(chapter.id);
    if (!after) return chapter;
    return { ...chapter, ...(contentIds.has(chapter.id) ? { content: after.content } : {}), ...(titleIds.has(chapter.id) ? { title: after.title } : {}) };
  });
  return { ...applied, project: { ...current, chapters, updatedAt: new Date().toISOString() } };
}
