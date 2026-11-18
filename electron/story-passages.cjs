const { diffArrays } = require('diff');

const compact = text => String(text || '').replace(/\s+/g, ' ').trim();
const words = text => compact(text).toLocaleLowerCase().match(/[\p{L}\p{N}’'-]+/gu) || [];
const genericSave = /^(?:automatic checkpoint|version checkpoint|manual checkpoint|(?:saved|opened|recovered|new) (?:a copy|cloud copy|document|manuscript)(?: version)?)$/i;

function chapterLines(text) {
  const [title, ...blocks] = text.replace(/\r\n/g, '\n').split(/\n\n# /);
  const instances = new Map();
  return { title: title.trim(), chapters: blocks.map(block => {
    const [name, ...lines] = block.trimEnd().split('\n');
    const occurrence = instances.get(name) || 0;
    instances.set(name, occurrence + 1);
    return { key: name + '\0' + occurrence, name, lines };
  }) };
}

// Anchor the excerpt on the actual edit, including a single corrected character
// near the end of a long paragraph. Keep the original wording for offline use.
function focusLine(before = '', after = '') {
  const line = after || before;
  let at = 0;
  while (at < before.length && at < after.length && before[at] === after[at]) at++;
  const boundaries = /[.!?…][”"’']?\s+(?=[\p{Lu}“"‘'])/gu;
  let start = 0, end = line.length;
  for (const mark of line.matchAll(boundaries)) {
    const next = mark.index + mark[0].length;
    if (next <= at) start = next;
    else { end = next; break; }
  }
  start = Math.max(start, at - 160);
  return compact(line.slice(start, Math.min(end, Math.max(start + 260, at + 110))));
}

function passageDelta(oldText, newText) {
  if (oldText === newText) return {};
  const before = chapterLines(oldText), after = chapterLines(newText);
  const prior = new Map(before.chapters.map(ch => [ch.key, ch]));
  const current = new Map(after.chapters.map(ch => [ch.key, ch]));
  const renamed = [];
  for (const ch of after.chapters) {
    if (prior.has(ch.key)) continue;
    const matches = before.chapters.filter(old => prior.has(old.key) && !current.has(old.key) && old.lines.length === ch.lines.length && old.lines.every((s, i) => s === ch.lines[i]));
    if (matches.length !== 1) continue;
    prior.delete(matches[0].key); prior.set(ch.key, matches[0]);
    renamed.push(matches[0].name + ' to ' + ch.name);
  }
  const excerpts = [];
  for (const key of new Set([...current.keys(), ...prior.keys()])) {
    const left = prior.get(key), right = current.get(key);
    const a = left?.lines || [], b = right?.lines || [];
    let start = 0, endA = a.length, endB = b.length;
    while (start < endA && start < endB && a[start] === b[start]) start++;
    while (start < endA && start < endB && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    if (start === endA && start === endB) continue;
    const old = a.slice(start, endA), next = b.slice(start, endB);
    const parts = diffArrays(old, next, { timeout: 25 }) || [{ removed: true, value: old }, { added: true, value: next }];
    let oldIndex = start, newIndex = start;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part.removed && !part.added) { oldIndex += part.value.length; newIndex += part.value.length; continue; }
      const removed = part.removed ? part.value : [];
      const added = part.added ? part.value : parts[i + 1]?.added ? parts[++i].value : [];
      const lines = added.length ? b : a, offset = added.length ? newIndex : oldIndex;
      const changed = added.length ? added : removed;
      // Sample across a large paste/import without mistaking every paragraph
      // of an existing chapter for separate writing sessions.
      const indices = new Set([0, Math.floor((changed.length - 1) / 2), changed.length - 1]);
      for (const j of indices) {
        const at = offset + j, line = compact(changed[j]);
        if (!line) continue;
        const quote = focusLine(added.length ? removed[j] : '', changed[j]) || line;
        const previous = compact(lines.slice(Math.max(0, at - 2), at).join(' ')).slice(-320);
        const following = compact(lines.slice(at + 1, at + 3).join(' ')).slice(0, 300);
        const cut = removed.length && added.length ? focusLine(added[j], removed[j]) : '';
        excerpts.push({ chapter: (right || left).name, paragraph: at, quote, previous, following,
          original: cut && cut !== quote ? cut : '', removed: !added.length,
          weight: Math.min(220, line.length) + Math.min(500, changed.length * 12) });
      }
      oldIndex += removed.length; newIndex += added.length;
    }
  }
  if (excerpts.length) {
    const picks = excerpts.sort((a, b) => b.weight - a.weight).slice(0, 4);
    return { excerpts: picks.map(({ weight, ...fact }) => fact) };
  }
  if (before.title !== after.title && before.title) return { purpose: 'Renamed manuscript to ' + after.title };
  if (renamed.length) return { purpose: 'Renamed ' + renamed.join(', ') };
  const names = after.chapters.filter(ch => !prior.has(ch.key)).map(ch => ch.name);
  if (names.length) return { purpose: 'Added ' + names.join(', ') };
  if (before.chapters.some(ch => !current.has(ch.key))) return { purpose: 'Removed ' + before.chapters.filter(ch => !current.has(ch.key)).map(ch => ch.name).join(', ') };
  return { purpose: 'Changed chapter order or spacing' };
}

function quoteTitle(fact) {
  const line = compact(fact?.quote);
  if (!line) return '';
  if (line.length <= 96) return line;
  const part = line.slice(0, 94).replace(/\s+\S*$/, '').trim();
  return part + '…';
}
function named(item) { return Boolean(item.message && !genericSave.test(item.message)); }
function versionTitle(item) {
  if (named(item)) return item.message;
  const title = item.title || '';
  const narrativeTitle = title && !/^(?:revis(?:ed|ions?)|edit(?:ed|s)?|add(?:ed|ing)?|remov(?:ed|ing)|saved?|updated?|writing|creat(?:ed|ing)|changes?|expand(?:ed|ing)|new|automatic|checkpoint|chapter\b)/i.test(title);
  return (narrativeTitle && title) || quoteTitle(item.passage?.excerpts?.[0]) || item.passage?.purpose || title || item.message || 'Saved version';
}
function samePassage(first, last, next) {
  if (!next || !last) return true; // a save of formatting or metadata within the same passage
  if (last.chapter !== next.chapter || Math.abs(last.paragraph - next.paragraph) > 7) return false;
  if (first && Math.abs(first.paragraph - next.paragraph) > 15) return false;
  return !/^(?:\*\s*\*\s*\*|[—–-]{3,}|⁂)$/u.test(next.quote);
}

function makePassages(entries, headRevision) {
  const children = new Map(), remaining = new Set(entries.map(e => e.revision));
  const byId = new Map(entries.map(e => [e.revision, e]));
  for (const item of entries) for (const parent of item.parentRevisions || [item.parentRevision]) {
    if (!parent) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(item);
  }
  const recent = new Set();
  let latest = byId.get(headRevision);
  for (let n = 0; latest && n < 3; n++, latest = byId.get(latest.parentRevision)) recent.add(latest.revision);
  const fixed = item => named(item) || recent.has(item.revision) || item.branchNames?.length || !item.parentRevision ||
    (item.parentRevisions?.length || 1) > 1 || children.get(item.revision)?.length !== 1 || (children.get(item.revision)[0].parentRevisions?.length || 1) > 1;
  const starts = entries.filter(item => {
    const parent = byId.get(item.parentRevision);
    return !parent || fixed(parent) || fixed(item);
  });
  const groups = [];
  function walk(item) {
    let group, first, last;
    while (item && remaining.delete(item.revision)) {
      const focus = item.passage?.excerpts?.[0], single = fixed(item);
      if (!group || single || !samePassage(first, last, focus)) {
        group = { revisions: [], samples: [] }; groups.push(group); first = null; last = null;
      }
      group.revisions.push(item.revision);
      if (focus) {
        first ||= focus; last = focus;
        group.samples.push({ focus, index: group.revisions.length - 1 });
      }
      if (single) break;
      const child = children.get(item.revision)?.[0];
      item = child && !fixed(child) ? child : null;
    }
  }
  // Start at the oldest end of each ordinary chain, irrespective of Git's
  // display order or commit timestamps.
  for (const item of starts) walk(item);
  for (const item of entries) if (remaining.has(item.revision)) walk(item);
  return groups.map(({ revisions, samples }) => {
    const item = byId.get(revisions[0]);
    const representative = samples.reduce((best, sample) => {
      const score = Math.min(22, words(sample.focus.quote).length) - Math.abs((sample.index + 0.5) / revisions.length - 0.5) * 5;
      return !best || score > best.score ? { focus: sample.focus, score } : best;
    }, null)?.focus;
    return { key: revisions[0] + '.' + revisions.at(-1), revisions, chapter: representative?.chapter,
      title: named(item) ? item.message : quoteTitle(representative) || versionTitle(item), hasProse: Boolean(samples.length) && !named(item) };
  });
}

module.exports = { passageDelta, makePassages, quoteTitle, versionTitle };
