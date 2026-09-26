// The renderer and the editing agent use the same field-level preconditions.
// Only editorial fields cross this boundary; private notes, chats and settings
// can never be replaced by a model-supplied project object.
export const documentFields = new Set(['title', 'subtitle', 'language', 'documentStyle']);
const chapterFields = new Set(['title', 'content', 'status']);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = value => value === undefined ? undefined : structuredClone(value);

export function documentChanges(before, after) {
  const changes = [];
  for (const key of documentFields) if (!equal(before[key], after[key])) changes.push({ kind: 'document', key, before: copy(before[key]), after: copy(after[key]) });
  const old = new Map(before.chapters.map(chapter => [chapter.id, chapter]));
  const next = new Map(after.chapters.map(chapter => [chapter.id, chapter]));
  for (const [chapterId, chapter] of old) {
    if (!next.has(chapterId)) changes.push({ kind: 'chapter', chapterId, before: copy(chapter), after: null });
    else for (const key of chapterFields) if (!equal(chapter[key], next.get(chapterId)[key])) changes.push({ kind: 'chapter-field', chapterId, key, before: copy(chapter[key]), after: copy(next.get(chapterId)[key]) });
  }
  for (const [chapterId, chapter] of next) if (!old.has(chapterId)) changes.push({ kind: 'chapter', chapterId, before: null, after: copy(chapter) });
  const beforeOrder = [...old.keys()], afterOrder = [...next.keys()];
  if (!equal(beforeOrder, afterOrder)) changes.push({ kind: 'order', before: beforeOrder, after: afterOrder });
  return changes;
}

export function applyDocumentChanges(project, changes, schema) {
  if (!Array.isArray(changes) || changes.length > 10000) throw new Error('Invalid assistant changes. No changes were applied.');
  const chapters = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  const seen = new Set();
  const fields = {}, changedChapters = new Set();
  let order = project.chapters.map(chapter => chapter.id);
  for (const change of changes) {
    const identity = JSON.stringify([change.kind, change.chapterId, change.key]);
    if (seen.has(identity)) throw new Error('Duplicate assistant change. No changes were applied.');
    seen.add(identity);
    let actual;
    if (change.kind === 'document' && documentFields.has(change.key)) actual = project[change.key];
    else if (change.kind === 'chapter-field' && chapterFields.has(change.key) && chapters.has(change.chapterId)) actual = chapters.get(change.chapterId)[change.key];
    else if (change.kind === 'chapter') actual = chapters.get(change.chapterId) || null;
    else if (change.kind === 'order') actual = order;
    else throw new Error('Unsupported assistant change. No changes were applied.');
    if (!equal(actual, change.before)) throw new Error('The document changed in an area the assistant edited. No AI edits were applied; request a fresh edit.');
    if (change.kind === 'document') fields[change.key] = copy(change.after);
    if (change.kind === 'chapter-field') { chapters.set(change.chapterId, { ...chapters.get(change.chapterId), [change.key]: copy(change.after) }); changedChapters.add(change.chapterId); }
    if (change.kind === 'chapter') {
      if (change.after === null) chapters.delete(change.chapterId);
      else {
        if (change.after?.id !== change.chapterId || typeof change.after.title !== 'string' || !change.after.content) throw new Error('Invalid assistant chapter.');
        chapters.set(change.chapterId, copy(change.after));
      }
      changedChapters.add(change.chapterId);
    }
    if (change.kind === 'order') order = copy(change.after);
  }
  if (!Array.isArray(order) || !order.length || order.length !== chapters.size || new Set(order).size !== order.length || order.some(id => !chapters.has(id))) throw new Error('Invalid assistant chapter order. No changes were applied.');
  if (schema) for (const chapterId of changedChapters) {
    const chapter = chapters.get(chapterId);
    if (chapter) schema.nodeFromJSON(chapter.content).check();
  }
  return { project: changes.length ? { ...project, ...fields, chapters: order.map(id => chapters.get(id)), updatedAt: new Date().toISOString() } : project, changedChapters: [...changedChapters], changeCount: changes.length };
}
