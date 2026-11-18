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

export const matchesCheckpoint = (item, term) => [item.title, item.message, item.summary, item.location, item.date].some(value => String(value || '').toLocaleLowerCase().includes(term));

// Condense only unbroken chains. Roots, forks, branch tips and merge junctions
// keep their own cards at every level of detail.
export function checkpointWindows(rows, detail = 0, now = Date.now()) {
  const children = new Map(), sizes = new Map(), taken = new Set(), windows = [];
  for (const row of rows) for (const parent of row.parentRevisions) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(row);
  }
  for (const row of rows) {
    const following = children.get(row.item.revision) || [];
    if (detail >= 2 || row.current || row.item.branchNames?.length || row.parentRevisions.length !== 1 || following.length !== 1 || following[0].parentRevisions.length !== 1) continue;
    const age = (now - Date.parse(row.item.date)) / 86400000, later = rows.length - row.row - 1;
    const size = age >= 90 || later >= 100 ? 24 : age >= 14 || later >= 32 ? 12 : age >= 3 || later >= 8 ? 6 : 1;
    sizes.set(row.item.revision, detail === 1 ? Math.max(1, Math.floor(size / 3)) : size);
  }
  for (const row of rows) {
    const size = sizes.get(row.item.revision);
    if (!size || size < 2 || taken.has(row.item.revision)) continue;
    const members = [];
    let next = row;
    while (next && !taken.has(next.item.revision) && sizes.get(next.item.revision) === size && members.length < size) {
      members.push(next); taken.add(next.item.revision);
      next = children.get(next.item.revision)?.[0];
    }
    if (members.length >= 2) windows.push({ key: members[0].item.revision + ':' + members.at(-1).item.revision, members });
  }
  return windows;
}

export function projectCheckpointWindows(rows, windows, plans, expanded, needle) {
  const representatives = new Map(), groups = new Map();
  for (const window of windows) {
    const sections = plans[window.key] || [{ end: window.members.length }];
    let start = 0;
    for (const section of sections) {
      const members = window.members.slice(start, section.end);
      start = section.end;
      if (members.length < 2 || expanded.has(members[0].item.revision) || (needle && members.some(row => matchesCheckpoint(row.item, needle)))) continue;
      const first = members[0], last = members.at(-1), revision = last.item.revision;
      const places = [...new Set(members.map(row => row.item.location).filter(Boolean))];
      const title = section.title || (places.length === 1 ? 'Revisions to ' + places[0] : 'Writing checkpoints');
      const group = { members, title, summary: section.summary || places.slice(0, 3).join(' · '), key: window.key };
      groups.set(revision, { ...last, group, parentRevisions: first.parentRevisions });
      for (const member of members) representatives.set(member.item.revision, revision);
    }
  }
  return rows.filter(row => !representatives.has(row.item.revision) || groups.has(row.item.revision)).map((original, index) => {
    const row = groups.get(original.item.revision) || original;
    const parentRevisions = row.parentRevisions.map(id => representatives.get(id) || id);
    return { ...row, row: index, parentRevisions, parentRevision: parentRevisions[0] || null };
  });
}
