import { checkpointGraph } from './checkpoint-tree.js';

export const versionLabel = item => item.displayTitle || item.title || item.message || 'Saved version';
const spacing = 24, separation = 224, laneHeight = 212;
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function layoutHistory(history, names = {}) {
  const { rows } = checkpointGraph(history.entries, history.headRevision);
  const groupAt = new Map();
  for (const group of history.passages || []) for (const id of group.revisions) groupAt.set(id, group);
  const points = new Map(), scenes = [], sceneOf = new Map(), edges = [];
  for (const row of rows) {
    const item = row.item, id = item.revision;
    const parents = row.parentRevisions.map(rev => points.get(rev)).filter(Boolean);
    const chained = parents.length === 1 && groupAt.has(id) && groupAt.get(id) === groupAt.get(parents[0].item.revision);
    const x = parents.length ? Math.max(...parents.map(p => p.x)) + (chained ? spacing : separation) : 0;
    const date = new Date(item.date);
    const localDate = Number.isFinite(date.getTime()) ? date.toLocaleDateString() + ' ' + shortDate.format(date) : '';
    const point = { ...row, localDate, x, y: row.lane * laneHeight };
    points.set(id, point);
    for (const [i, parent] of parents.entries()) edges.push({ from: parent, to: point, merge: i > 0, active: !i && point.onCurrentPath && parent.onCurrentPath });
  }
  for (const row of rows) {
    const id = row.item.revision, group = groupAt.get(id);
    if (group && group.revisions[0] !== id) continue;
    const revisions = group?.revisions || [id];
    const sections = names[group?.key] || group?.sections || [{ end: revisions.length, title: group?.title || versionLabel(row.item) }];
    let start = 0;
    for (const section of sections) {
      const members = revisions.slice(start, section.end).map(rev => points.get(rev)).filter(Boolean);
      start = section.end;
      if (!members.length) continue;
      const first = members[0], last = members.at(-1);
      const scene = { id: first.item.revision, group, title: section.title, summary: section.summary, members, first, last,
        x: (first.x + last.x) / 2, y: first.y, chapter: group?.chapter || first.item.passage?.excerpts?.[0]?.chapter || first.item.location,
        onCurrentPath: first.onCurrentPath, current: members.some(m => m.current) };
      scenes.push(scene);
      for (const member of members) sceneOf.set(member.item.revision, scene);
    }
  }
  let right = 0, bottom = 0;
  for (const p of points.values()) { right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  return { points, scenes, sceneOf, edges, bounds: { left: 0, top: 0, right, bottom } };
}

export function fitCamera(bounds, width, height) {
  const k = Math.max(0.0001, Math.min(1, (Math.max(100, width) - Math.min(160, width * 0.25)) / Math.max(1, bounds.right - bounds.left),
    (Math.max(100, height) - Math.min(176, height * 0.4)) / Math.max(1, bounds.bottom - bounds.top)));
  return centerCamera({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }, k, width, height);
}
export function centerCamera(point, k, width, height) {
  return { x: width / 2 - point.x * k, y: height / 2 - point.y * k, k };
}
export function zoomCamera(camera, factor, anchor, minimum) {
  const k = Math.max(minimum, Math.min(6, camera.k * factor)), ratio = k / camera.k;
  return { k, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio };
}
export function connector(from, to) {
  const mid = (from.x + to.x) / 2;
  return 'M' + from.x + ',' + from.y + ' C' + mid + ',' + from.y + ' ' + mid + ',' + to.y + ' ' + to.x + ',' + to.y;
}
export function searchHistory(map, query) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const results = [];
  const match = value => { const text = (value || '').toLocaleLowerCase(); return tokens.every(part => text.includes(part)); };
  for (const scene of map.scenes) {
    const context = [scene.title, scene.summary, scene.chapter].join(' ');
    if (match(context)) results.push({ scene, title: scene.title, score: match(scene.title) ? 0 : 1 });
    for (const point of scene.members) {
      const item = point.item, title = versionLabel(item);
      if (scene.members.length === 1 && results.at(-1)?.scene === scene) continue;
      const metadata = [title, item.title, item.message, item.summary, item.location, item.date, point.localDate, ...(item.branchNames || [])].join(' ');
      const passage = item.passage?.excerpts?.map(f => [f.chapter, f.previous, f.quote, f.following, f.original].join(' ')).join(' ');
      if (match(metadata) || match(passage)) results.push({ scene, point, title, score: match(title) ? 0 : match(metadata) ? 2 : 3 });
    }
  }
  return results.sort((a, b) => a.score - b.score);
}
