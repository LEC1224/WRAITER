import { applyTextChanges } from '../electron/text-edits.mjs';
import { applyDocumentChanges } from '../electron/document-changes.mjs';
import { reconcileCommentChapters } from './comments.js';

const reconcileResult = (result, schema) => ({ ...result, project: reconcileCommentChapters(result.project, schema) });

const fingerprintInput = project => JSON.stringify([project.id, project.title, project.chapters.map(chapter => [chapter.id, chapter.title, chapter.content])]);
export async function agentProjectFingerprint(project) {
  const bytes = new TextEncoder().encode(fingerprintInput(project));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function applyAgentResult(project, result, schema) {
  if (!result || result.projectId !== project.id || await agentProjectFingerprint(project) !== result.baseFingerprint) throw new Error('The document changed while the assistant was working. No AI edits were applied; send the request again against the current text.');
  return reconcileResult(result.version === 2 ? applyDocumentChanges(project, result.documentChanges, schema) : applyTextChanges(project, result, schema), schema);
}

// An agent result is still safe when the author edited a different chapter
// while it was running. Reuse only the fields the agent actually changed and
// require those source fields to remain byte-for-byte equal to its baseline.
export function rebaseAgentResult(baseline, current, applied, result) {
  if (!baseline || !current || !applied?.project || baseline.id !== current.id || result?.projectId !== baseline.id) throw new Error('The document changed while the assistant was working. No AI edits were applied; send the request again against the current text.');
  if (result.version === 2) return reconcileResult(applyDocumentChanges(current, result.documentChanges, null));
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
  return reconcileResult({ ...applied, project: { ...current, chapters, updatedAt: new Date().toISOString() } });
}
