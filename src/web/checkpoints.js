import { nodeText, snapshot } from '../document.js';
import passages from '../../electron/story-passages.cjs';

const limit = 20;
const cache = new WeakMap();
const manuscriptText = draft => [draft.title, ...draft.chapters.flatMap(chapter => ['\n# ' + chapter.title, nodeText(chapter.content)])].join('\n') + '\n';

export function browserHistory(project) {
  const snapshots = project.snapshots || [];
  const cached = cache.get(snapshots);
  if (cached) return cached;
  const prior = new Map();
  const entries = snapshots.map((saved, index) => {
    const candidates = Array.isArray(saved.webParents) ? saved.webParents : [snapshots[index - 1]?.id];
    const parentRevisions = [...new Set(candidates.slice(0, 2))].filter(id => prior.has(id));
    const parentRevision = parentRevisions[0] || null;
    const text = manuscriptText(saved);
    const passage = passages.passageDelta(prior.get(parentRevision) || '', text);
    prior.set(saved.id, text);
    return { revision: saved.id, parentRevision, parentRevisions, message: saved.name, title: saved.name, date: saved.createdAt, passage, location: passage.excerpts?.[0]?.chapter || '' };
  }).reverse();
  const headRevision = snapshots.findLast(saved => saved.webHead === true)?.id || snapshots.at(-1)?.id || null;
  const result = { available: true, headRevision, entries, passages: passages.makePassages(entries, headRevision) };
  cache.set(snapshots, result);
  return result;
}

export function readCheckpoint(project, revision) {
  const saved = project.snapshots?.find(item => item.id === revision);
  if (!saved) throw new Error('This checkpoint is no longer available.');
  const { id, name, createdAt, webParents, webHead, ...contents } = structuredClone(saved);
  return {
    ...project, subtitle: '', printLayout: undefined, namedStyles: undefined,
    comments: undefined, bookmarks: undefined, ...contents, historySequence: saved.historySequence
  };
}

export function checkoutCheckpoint(project, revision) {
  if (!project.snapshots?.some(item => item.id === revision)) throw new Error('This checkpoint is no longer available.');
  return { ...project, snapshots: project.snapshots.map(item => ({ ...item, webHead: item.id === revision })) };
}

export function saveCheckpoint(project, label, incoming, preserve) {
  const head = browserHistory(project).headRevision;
  const saved = { ...snapshot(project, label), subtitle: project.subtitle, historySequence: project.historySequence, webParents: [...new Set([head, incoming].filter(Boolean))], webHead: true };
  const earlier = (project.snapshots || []).map(item => item.webHead ? { ...item, webHead: false } : item);
  if (earlier.length >= limit) {
    const index = earlier.findIndex(item => item.id !== head && item.id !== preserve && item.id !== incoming);
    earlier.splice(index, 1);
  }
  return { ...project, snapshots: [...earlier, saved] };
}

export function browserMerge(project, sourceRevision) {
  const { headRevision, entries } = browserHistory(project), byId = new Map(entries.map(item => [item.revision, item]));
  const ancestors = root => {
    const seen = new Set(), pending = [root];
    for (const id of pending) {
      if (!byId.has(id) || seen.has(id)) continue;
      seen.add(id);
      pending.push(...byId.get(id).parentRevisions);
    }
    return seen;
  };
  const current = ancestors(headRevision), source = ancestors(sourceRevision);
  if (current.has(sourceRevision)) throw new Error('That version is already part of this draft’s history.');
  const baseRevision = entries.find(item => current.has(item.revision) && source.has(item.revision))?.revision;
  if (!baseRevision) throw new Error('Both drafts need a saved checkpoint in common before they can be merged.');
  return { base: readCheckpoint(project, baseRevision), source: readCheckpoint(project, sourceRevision), headRevision, sourceRevision, targetSequence: project.historySequence };
}
