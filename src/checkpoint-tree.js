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
  const parents = item => [...new Set(item.parentRevisions || [item.parentRevision])].filter(id => id !== item.revision && byRevision.has(id));
  const lanes = new Map();
  let nextLane = 0;
  for (const root of [...roots, ...items]) {
    if (lanes.has(root.revision)) continue;
    const stack = [[root, nextLane++]];
    while (stack.length) {
      const [item, lane] = stack.pop();
      if (lanes.has(item.revision)) continue;
      lanes.set(item.revision, lane);
      const siblings = children.get(item.revision) || [];
      const main = siblings.find(child => currentPath.has(child.revision)) || siblings[0];
      for (const child of siblings) if (child !== main) stack.push([child, nextLane++]);
      if (main) stack.push([main, lane]);
    }
  }
  // Git timestamps have one-second precision. Visit parents first even when
  // several commits share a timestamp or the writer's clock moved backwards.
  const ordered = [], seen = new Set(), ancestors = new Set();
  for (const item of [...items].sort(chronological)) {
    const stack = [[item, false]];
    while (stack.length) {
      const [node, exiting] = stack.pop();
      if (exiting) { ordered.push(node); continue; }
      if (seen.has(node.revision)) continue;
      seen.add(node.revision);
      stack.push([node, true]);
      for (const revision of parents(node).reverse()) stack.push([byRevision.get(revision), false]);
    }
  }
  const stack = [headRevision];
  while (stack.length) {
    const revision = stack.pop(), item = byRevision.get(revision);
    if (!item || ancestors.has(revision)) continue;
    ancestors.add(revision);
    for (const parent of parents(item)) stack.push(parent);
  }
  const rows = ordered.map((item, row) => ({
    item, row, lane: lanes.get(item.revision), parentRevision: parents(item)[0] || null, parentRevisions: parents(item),
    onCurrentPath: currentPath.has(item.revision), integrated: ancestors.has(item.revision), current: item.revision === headRevision
  }));
  return { rows, laneCount: Math.max(1, nextLane) };
}
