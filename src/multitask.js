export const TAB_TRANSFER = 'application/x-wraiter-tab';
export const MIN_PANE_WIDTH = 240;

// Flex factors below a total of one leave part of the strip unused. Keep the
// remaining proportions while assigning the whole strip after every removal.
export function normalizePanes(panes) {
  const sizes = panes.map(pane => Number.isFinite(pane.size) && pane.size > 0 ? pane.size : 1);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!total || total === 1 && sizes.every((size, index) => size === panes[index].size)) return panes;
  return panes.map((pane, index) => ({ ...pane, size: sizes[index] / total }));
}

// Each tab has at most one live editor. Moving a visible tab moves that editor.
export function placePane(panes, id, target, side) {
  if (id === target || !panes.some(pane => pane.id === target)) return panes;
  const existing = panes.find(pane => pane.id === id);
  const next = panes.filter(pane => pane.id !== id);
  const index = next.findIndex(pane => pane.id === target);
  const size = existing?.size || next[index].size / 2;
  if (!existing) next[index] = { ...next[index], size };
  next.splice(index + (side === 'right' ? 1 : 0), 0, existing || { id, size });
  return normalizePanes(next);
}

export function reconcilePanes(panes, tabIds, activeId, previousId) {
  const open = new Set(tabIds), next = panes.filter(pane => open.has(pane.id));
  if (!open.has(activeId) || next.some(pane => pane.id === activeId)) return normalizePanes(next);
  const index = next.findIndex(pane => pane.id === previousId);
  if (index >= 0) next[index] = { ...next[index], id: activeId };
  else next.push({ id: activeId, size: 1 });
  return normalizePanes(next);
}

export function resizePair(left, right, delta, minimum = MIN_PANE_WIDTH) {
  const total = left + right, limit = Math.min(minimum, total / 2);
  const next = Math.max(limit, Math.min(total - limit, left + delta));
  return [next, total - next];
}

export function startTabDrag(event, id, onDrag) {
  event.dataTransfer.setData(TAB_TRANSFER, id);
  event.dataTransfer.effectAllowed = 'move';
  onDrag(id);
}
