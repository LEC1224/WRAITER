import { changedRanges, sameValue } from '../electron/merge-ranges.mjs';
export { sameValue } from '../electron/merge-ranges.mjs';
import { nodeText } from './document.js';
import { editorialSchema } from '../electron/editor-schema.mjs';

const privateFields = new Set(['id', 'format', 'version', 'createdAt', 'updatedAt', 'historySequence', 'snapshots', 'chats', 'activeChatId', 'binding', 'fileBinding', 'nativeBinding']);
const collections = new Set(['chapters', 'bookmarks', 'comments', 'references', 'namedStyles']);
const keys = (...values) => [...new Set(values.flatMap(value => Object.keys(value || {})))].filter(key => !['__proto__', 'constructor', 'prototype'].includes(key));
const wordsAndSpacing = text => text.match(/[\p{L}\p{M}\p{N}]+|[^\S\r\n]+|./gsu) || [];

function applyRanges(base, start, end, ranges) {
  const result = [];
  let position = start;
  for (const range of ranges) {
    result.push(base.slice(position, range.start), range.insert);
    position = range.end;
  }
  result.push(base.slice(position, end));
  return result.flat();
}
function weave(primary, other, kept) {
  const first = primary.filter(id => kept.has(id)), present = new Set(first), before = new Map();
  let anchor = null;
  for (let index = other.length - 1; index >= 0; index--) {
    const id = other[index];
    if (present.has(id)) anchor = id;
    else if (kept.has(id)) {
      if (!before.has(anchor)) before.set(anchor, []);
      before.get(anchor).push(id);
    }
  }
  return [...first, null].flatMap(id => [...(before.get(id) || []).reverse(), ...(id === null ? [] : [id])]);
}

export function mergeDisplay(value) {
  if (value === undefined) return '(removed)';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.every(item => typeof item === 'string') ? value.join('') : value.map(mergeDisplay).join('\n');
  if (value?.type) return nodeText(value, '\n', true) || '[' + value.type + ']';
  if (value?.content?.type === 'doc') return value.title + '\n' + mergeDisplay(value.content);
  return JSON.stringify(value, null, 2);
}

export function mergeDrafts(base, current, incoming, choices = {}) {
  if (base.id !== current.id || incoming.id !== current.id) throw new Error('Choose checkpoints from the same manuscript.');
  const conflicts = [];
  function choose(path, label, ours, theirs) {
    const id = JSON.stringify(path), selected = choices[id];
    conflicts.push({ id, label, current: ours, incoming: theirs, selected });
    return selected === 'incoming' ? theirs : ours;
  }
  function sequence(path, label, original, ours, theirs, text = false) {
    const edits = [ours, theirs].flatMap((list, side) => changedRanges(original, list).map(edit => ({ ...edit, side }))).sort((a, b) => a.start - b.start || a.end - b.end);
    let pos = 0;
    const sections = [];
    for (let i = 0; i < edits.length;) {
      const start = edits[i].start;
      let end = edits[i].end, last = i + 1;
      while (last < edits.length && (edits[last].start < end || end === start && edits[last].start === start && edits[last].end === start)) end = Math.max(end, edits[last++].end);
      const group = edits.slice(i, last);
      const [left, right] = [0, 1].map(side => applyRanges(original, start, end, group.filter(edit => edit.side === side)));
      let replacement;
      if (group.every(edit => edit.side === 0) || sameValue(left, right)) replacement = left;
      else if (group.every(edit => edit.side === 1)) replacement = right;
      else if (!text && left.length === right.length && left.length === end - start) replacement = left.map((node, n) => value([...path, start + n], label, original[start + n], node, right[n]));
      else replacement = choose([...path, start, end], label, left, right);
      sections.push(original.slice(pos, start), replacement);
      pos = end; i = last;
    }
    sections.push(original.slice(pos));
    return sections.flat();
  }
  function value(path, label, original, ours, theirs) {
    if (sameValue(ours, theirs) || sameValue(theirs, original)) return ours;
    if (sameValue(ours, original)) return theirs;
    const field = path.at(-1);
    if (field === 'text' && [original, ours, theirs].every(item => typeof item === 'string' && item.length < 100000)) return sequence(path, label, wordsAndSpacing(original), wordsAndSpacing(ours), wordsAndSpacing(theirs), true).join('');
    if (field === 'content' && [original, ours, theirs].every(Array.isArray)) return sequence(path, label, original, ours, theirs);
    if ([original, ours, theirs].every(item => item && typeof item === 'object' && !Array.isArray(item)) && original.type === ours.type && original.type === theirs.type) {
      const start = conflicts.length;
      const merged = Object.fromEntries(keys(original, ours, theirs).map(key => [key, value([...path, key], label, original[key], ours[key], theirs[key])]).filter(([, item]) => item !== undefined));
      if (original.type === 'doc') {
        try { editorialSchema.nodeFromJSON(merged).check(); }
        catch { conflicts.length = start; return choose(path, label + ' · chapter structure', ours, theirs); }
      }
      return merged;
    }
    return choose(path, label, ours, theirs);
  }
  function collection(key) {
    const [ancestor, ours, theirs] = [base, current, incoming].map(project => new Map((project[key] || []).map(item => [item.id, item])));
    const kept = new Map();
    for (const id of new Set([...ancestor.keys(), ...ours.keys(), ...theirs.keys()])) {
      const item = ours.get(id) || theirs.get(id) || ancestor.get(id);
      const merged = value([key, id], item.title || item.name || key, ancestor.get(id), ours.get(id), theirs.get(id));
      if (merged !== undefined) kept.set(id, merged);
    }
    if (key === 'chapters' && !kept.size) return choose([key], 'Keep at least one chapter', current.chapters, incoming.chapters);
    const [baseOrder, currentOrder, incomingOrder] = [ancestor, ours, theirs].map(map => [...map.keys()]);
    const common = id => kept.has(id) && ancestor.has(id) && ours.has(id) && theirs.has(id);
    const [a, b, c] = [baseOrder, currentOrder, incomingOrder].map(list => list.filter(common));
    let primary = currentOrder;
    if (!sameValue(c, a) && !sameValue(c, b)) primary = sameValue(b, a) ? incomingOrder : choose([key, 'order'], 'Order of ' + key, currentOrder, incomingOrder);
    return weave(primary, primary === currentOrder ? incomingOrder : currentOrder, kept).map(id => kept.get(id));
  }
  const project = { ...current }, fields = [];
  for (const key of keys(base, current, incoming)) {
    if (privateFields.has(key)) continue;
    const result = collections.has(key) && [base, current, incoming].every(p => p[key] == null || Array.isArray(p[key])) ? collection(key) : value([key], key, base[key], current[key], incoming[key]);
    if (sameValue(result, current[key]) || result?.length === 0 && current[key] === undefined && incoming[key] === undefined) continue;
    if (result === undefined) delete project[key]; else project[key] = result;
    fields.push(key);
  }
  return { project, conflicts, fields };
}
