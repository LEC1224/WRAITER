import { EditorState } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';

export const PROOFREAD_SEVERITIES = {
  definite: { label: 'Definite error', description: 'Objectively incorrect or an unmistakable typo.' },
  likely: { label: 'Likely problem', description: 'Probably unintended, though context could justify it.' },
  optional: { label: 'Editorial choice', description: 'Worth considering, but the original may be intentional.' }
};

export const PROOFREAD_CATEGORIES = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  'wrong-word-typo': 'Wrong word · typo',
  'wrong-word-meaning': 'Wrong word · meaning',
  'agreement-tense': 'Agreement & tense',
  phrasing: 'Odd phrasing',
  consistency: 'Consistency',
  capitalization: 'Capitalization'
};

function compactLine(value) {
  return String(value || '').replace(/[\r\n\t ]+/g, ' ');
}

function clipContext(value, limit, fromStart) {
  const characters = Array.from(compactLine(value));
  if (characters.length <= limit) return characters.join('');
  return fromStart ? `${characters.slice(0, limit).join('')}…` : `…${characters.slice(-limit).join('')}`;
}

export function proofreadingExcerpt(text, start, end, contextLength = 56) {
  return {
    before: clipContext(text.slice(0, start), contextLength, false),
    original: compactLine(text.slice(start, end)),
    after: clipContext(text.slice(end), contextLength, true)
  };
}

function splitPassage(text, from, limit = 12000) {
  const parts = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + limit);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      if (boundary > start + Math.floor(limit / 2)) end = boundary + 1;
      if (/^[\uDC00-\uDFFF]$/.test(text[end] || '')) end--;
    }
    parts.push({ text: text.slice(start, end), from: from + start, to: from + end });
    start = end;
  }
  return parts;
}

export function collectProofreadingPassages(project, schema, { scope = 'chapter', activeChapterId, selection } = {}) {
  if (!project?.chapters?.length) return [];
  const chapters = scope === 'manuscript' ? project.chapters : project.chapters.filter(chapter => chapter.id === activeChapterId);
  const passages = [];
  for (const chapter of chapters) {
    const doc = schema.nodeFromJSON(chapter.content); let paragraph = 0, segment = 0;
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return;
      paragraph++;
      let supported = true;
      node.forEach(child => { if (!child.isText && child.type.name !== 'hardBreak') supported = false; });
      if (!supported) return false;
      const blockFrom = pos + 1, blockTo = pos + node.nodeSize - 1;
      const from = scope === 'selection' ? Math.max(blockFrom, selection?.from ?? blockFrom) : blockFrom;
      const to = scope === 'selection' ? Math.min(blockTo, selection?.to ?? blockTo) : blockTo;
      if (to <= from) return false;
      const text = doc.textBetween(from, to, '', '\n');
      if (!text.trim()) return false;
      for (const part of splitPassage(text, from)) {
        if (!part.text.trim()) continue;
        passages.push({
          id: `${chapter.id}:${paragraph}:${segment++}:${part.from}`,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          paragraph,
          from: part.from,
          to: part.to,
          text: part.text
        });
      }
      return false;
    });
  }
  return passages;
}

export function chunkProofreadingPassages(passages, characterLimit = 14000, passageLimit = 60) {
  const chunks = []; let current = [], characters = 0;
  for (const passage of passages) {
    if (current.length && (current.length >= passageLimit || characters + passage.text.length > characterLimit)) {
      chunks.push(current); current = []; characters = 0;
    }
    current.push(passage); characters += passage.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function attachProofreadingFindings(result, passages, idFactory = () => crypto.randomUUID()) {
  const byId = new Map(passages.map(passage => [passage.id, passage]));
  const findings = [];
  for (const item of result?.findings || []) {
    const passage = byId.get(item.passageId);
    if (!passage || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > passage.text.length) continue;
    if (passage.text.slice(item.start, item.end) !== item.original) continue;
    const excerpt = proofreadingExcerpt(passage.text, item.start, item.end);
    findings.push({
      ...item,
      id: idFactory(),
      chapterId: passage.chapterId,
      chapterTitle: passage.chapterTitle,
      paragraph: passage.paragraph,
      from: passage.from + item.start,
      to: passage.from + item.end,
      contextBefore: excerpt.before,
      contextOriginal: excerpt.original,
      contextAfter: excerpt.after,
      suggestion: item.replacement,
      replacement: item.replacement,
      selected: false,
      status: 'pending'
    });
  }
  return findings;
}

function replaceText(transaction, schema, edit) {
  if (!edit.replacement.includes('\n')) return transaction.insertText(edit.replacement, edit.from, edit.to);
  if (!schema.nodes.hardBreak) throw new Error('This document cannot represent the requested line break.');
  const $from = transaction.doc.resolve(edit.from), $to = transaction.doc.resolve(edit.to);
  const marks = $from.marksAcross($to) || $from.marks();
  const nodes = [];
  edit.replacement.split('\n').forEach((line, index) => {
    if (index) nodes.push(schema.nodes.hardBreak.create());
    if (line) nodes.push(schema.text(line, marks));
  });
  return transaction.replaceWith(edit.from, edit.to, Fragment.fromArray(nodes));
}

export function applyProofreadingFixes(project, findings, ids, schema) {
  const chosen = findings.filter(item => ids.has(item.id) && item.status === 'pending');
  if (!chosen.length) return { project, findings, changeCount: 0, changedChapters: [] };
  const chapterMap = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  const grouped = new Map();
  for (const finding of chosen) {
    if (!chapterMap.has(finding.chapterId) || typeof finding.original !== 'string' || typeof finding.replacement !== 'string' || finding.replacement.length > 4000 || !Number.isInteger(finding.from) || !Number.isInteger(finding.to)) throw new Error('A proofreading suggestion is no longer valid. No changes were applied.');
    if (!grouped.has(finding.chapterId)) grouped.set(finding.chapterId, []);
    grouped.get(finding.chapterId).push(finding);
  }
  const content = new Map(), mappings = new Map();
  for (const [chapterId, edits] of grouped) {
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(chapterMap.get(chapterId).content) });
    const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to); let previousEnd = -1;
    for (const edit of sorted) {
      const $from = state.doc.resolve(edit.from), $to = state.doc.resolve(edit.to);
      if (edit.from < previousEnd || edit.to > state.doc.content.size || !$from.sameParent($to) || !$from.parent.isTextblock || state.doc.textBetween(edit.from, edit.to, '', '\n') !== edit.original) throw new Error('The source text changed or selected suggestions overlap. No changes were applied.');
      previousEnd = edit.to;
    }
    let transaction = state.tr;
    for (const edit of [...sorted].reverse()) transaction = replaceText(transaction, schema, edit);
    transaction.doc.check(); content.set(chapterId, transaction.doc.toJSON()); mappings.set(chapterId, transaction.mapping);
  }
  const applied = new Set(chosen.map(item => item.id));
  const nextFindings = findings.map(finding => {
    if (applied.has(finding.id)) return { ...finding, selected: false, status: 'applied' };
    const mapping = mappings.get(finding.chapterId);
    if (!mapping || finding.status !== 'pending') return finding;
    const from = mapping.map(finding.from, 1), to = mapping.map(finding.to, -1);
    const chapter = content.get(finding.chapterId), doc = schema.nodeFromJSON(chapter);
    const valid = to > from && to <= doc.content.size && doc.textBetween(from, to, '', '\n') === finding.original;
    return valid ? { ...finding, from, to } : { ...finding, selected: false, status: 'stale' };
  });
  const changedChapters = [...content.keys()];
  return {
    project: { ...project, updatedAt: new Date().toISOString(), chapters: project.chapters.map(chapter => content.has(chapter.id) ? { ...chapter, content: content.get(chapter.id) } : chapter) },
    findings: nextFindings,
    changeCount: chosen.length,
    changedChapters
  };
}
