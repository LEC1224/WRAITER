export function checkpointTree(entries, headRevision) {
  const byRevision = new Map((entries || []).map(item => [item.revision, item]));
  const children = new Map(), roots = [];
  for (const item of entries || []) {
    if (item.parentRevision && byRevision.has(item.parentRevision)) {
      const siblings = children.get(item.parentRevision) || [];
      siblings.push(item); children.set(item.parentRevision, siblings);
    } else roots.push(item);
  }
  const chronological = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.revision.localeCompare(b.revision);
  roots.sort(chronological);
  for (const siblings of children.values()) siblings.sort(chronological);
  const currentPath = new Set();
  for (let revision = headRevision; revision && byRevision.has(revision) && !currentPath.has(revision); revision = byRevision.get(revision).parentRevision) currentPath.add(revision);
  const rows = [], seen = new Set();
  const walk = (item, depth, forked) => {
    if (seen.has(item.revision)) return;
    seen.add(item.revision);
    rows.push({ item, depth, forked, onCurrentPath: currentPath.has(item.revision), current: item.revision === headRevision });
    (children.get(item.revision) || []).forEach((child, index) => walk(child, depth + (index > 0 ? 1 : 0), index > 0));
  };
  roots.forEach(item => walk(item, 0, false));
  return rows;
}

// The inspector follows the version being edited. Its first row is always the
// current checkpoint, followed by its ancestors, so unrelated forks never
// appear to be part of the same writing path.
export function currentCheckpointPath(entries, headRevision) {
  const byRevision = new Map((entries || []).map(item => [item.revision, item]));
  const path = [], seen = new Set();
  for (let revision = headRevision; revision && byRevision.has(revision) && !seen.has(revision); revision = byRevision.get(revision).parentRevision) {
    seen.add(revision);
    path.push({ item: byRevision.get(revision), current: revision === headRevision });
  }
  return path;
}

// Layout data for the full tree dialog. The active path keeps a single lane;
// each fork gets its own lane and every edge retains its actual parent.
export function checkpointGraph(entries, headRevision) {
  const items = entries || [];
  const byRevision = new Map(items.map(item => [item.revision, item]));
  const children = new Map(), roots = [];
  const chronological = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.revision.localeCompare(b.revision);
  for (const item of items) {
    if (item.parentRevision && byRevision.has(item.parentRevision) && item.parentRevision !== item.revision) {
      const siblings = children.get(item.parentRevision) || [];
      siblings.push(item); children.set(item.parentRevision, siblings);
    } else roots.push(item);
  }
  roots.sort(chronological);
  for (const siblings of children.values()) siblings.sort(chronological);
  const currentPath = new Set(currentCheckpointPath(items, headRevision).map(row => row.item.revision));
  const lanes = new Map(), seen = new Set();
  let nextLane = 0;
  const allocateLane = () => nextLane++;
  function visit(item, lane) {
    if (seen.has(item.revision)) return;
    seen.add(item.revision); lanes.set(item.revision, lane);
    const siblings = children.get(item.revision) || [];
    const main = siblings.find(child => currentPath.has(child.revision)) || siblings[0];
    if (main) visit(main, lane);
    for (const child of siblings) if (child !== main) visit(child, allocateLane());
  }
  for (const root of roots) visit(root, allocateLane());
  // A corrupt cycle has no root. Still show every saved version exactly once.
  for (const item of items) if (!seen.has(item.revision)) visit(item, allocateLane());
  const rows = [...seen].map(revision => byRevision.get(revision)).sort(chronological).map((item, row) => ({
    item, row, lane: lanes.get(item.revision), parentRevision: item.parentRevision !== item.revision && byRevision.has(item.parentRevision) ? item.parentRevision : null,
    onCurrentPath: currentPath.has(item.revision), current: item.revision === headRevision
  }));
  return { rows, laneCount: Math.max(1, nextLane) };
}
