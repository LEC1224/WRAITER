import { diffArrays } from 'diff';

const signatures = new WeakMap();
function signature(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (!signatures.has(value)) signatures.set(value, JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));
  return signatures.get(value);
}
export const sameValue = (a, b) => a === b || signature(a) === signature(b);

// Changed ranges use coordinates in the common ancestor. Insertions at a
// boundary can coexist with an edit on either side of that boundary.
export function changedRanges(base, variant) {
  const diff = diffArrays(base, variant, { comparator: sameValue, timeout: 250, maxEditLength: 8000 });
  if (!diff) return [{ start: 0, end: base.length, insert: variant }];
  const result = [];
  let position = 0, range = null;
  for (const part of diff) {
    if (!part.added && !part.removed) { position += part.count; range = null; continue; }
    if (!range) { range = { start: position, end: position, insert: [] }; result.push(range); }
    if (part.added) range.insert = part.value;
    else { position += part.count; range.end = position; }
  }
  return result;
}
