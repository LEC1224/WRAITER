import { applyDocumentChanges } from '../electron/document-changes.mjs';

const nodeText = node => node?.type === 'text' ? node.text : (node?.content || []).map(nodeText).join(node?.type === 'doc' ? '\n' : '');
const titleFor = (entry, id, project) => project?.chapters.find(chapter => chapter.id === id)?.title || entry.patches?.find(p => p.chapterId === id && p.scope === 'chapter')?.before?.title || entry.patches?.find(p => p.chapterId === id && p.key === 'title')?.before || 'Chapter';
export function assistantChangeSummary(entry, project) {
  if (!entry) return [];
  return (entry.patches || []).map(patch => {
    const title = titleFor(entry, patch.chapterId, project);
    if (patch.scope === 'chapter-order') return 'Changed chapter order';
    if (patch.scope === 'chapter') return `${patch.hasAfter ? 'Added' : 'Removed'} chapter: ${(patch.after || patch.before).title || 'Untitled'}`;
    if (patch.key === 'content') return `${nodeText(patch.before) === nodeText(patch.after) ? 'Changed formatting or structure' : 'Revised text'} in ${title}`;
    if (patch.scope === 'chapter-property' && patch.key === 'title') return `Renamed ${patch.before || 'Untitled'} to ${patch.after || 'Untitled'}`;
    return `Changed ${patch.key === 'documentStyle' ? 'document formatting' : patch.key}${patch.chapterId ? ` in ${title}` : ''}`;
  });
}

// Revert only the fields this batch changed. Later edits in other chapters or
// metadata stay in place; a changed target blocks the entire revert.
export function revertAssistantEntry(project, entry, schema) {
  if (entry?.kind !== 'project' || !Array.isArray(entry.patches)) throw new Error('This edit must be undone through Revision history.');
  const changes = entry.patches.map(patch => {
    if (patch.scope === 'chapter-order') return { kind: 'order', before: patch.after, after: patch.before };
    if (patch.scope === 'chapter') return { kind: 'chapter', chapterId: patch.chapterId, before: patch.hasAfter ? patch.after : null, after: patch.hadBefore ? patch.before : null };
    return { kind: patch.scope === 'project' ? 'document' : 'chapter-field', chapterId: patch.chapterId, key: patch.key, before: patch.after, after: patch.before };
  });
  try { return applyDocumentChanges(project, changes, schema); }
  catch { throw new Error('Later changes overlap this assistant edit. Nothing was reverted. Review its before-and-after report, or undo the later changes in Revision history first.'); }
}

export function assistantEditState(journal, entryId) {
  const active = new Set(journal?.activeIds.slice(0, journal.cursor) || []);
  if (!active.has(entryId)) return 'undone';
  if (journal.entries.some(entry => active.has(entry.id) && entry.revertsEntryId === entryId)) return 'reverted';
  return 'applied';
}
