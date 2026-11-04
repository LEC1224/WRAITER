import { Transform } from '@tiptap/pm/transform';
import { editorialSchema } from '../electron/editor-schema.mjs';
import { RE2JS } from 're2js';

const literal = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = (query, options) => options.wildcard ? [...String(query)].map(char => char === '?' ? '[^\\n\\uFFFC]' : literal(char)).join('') : literal(String(query));
const regexCache = new Map();
function compiledRegex(query, caseSensitive) {
  const key = `${caseSensitive}:${query}`;
  if (regexCache.has(key)) return regexCache.get(key);
  let value = null;
  try { if (query.length > 500) throw new Error(); value = RE2JS.compile(query, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE); if (value.programSize() > 10000) value = null; } catch { /* Incomplete patterns are normal while typing. */ }
  if (regexCache.size > 30) regexCache.clear(); regexCache.set(key, value); return value;
}
export const searchPatternError = (query, options = {}) => options.regex && query && !compiledRegex(query, !!options.caseSensitive) ? 'Invalid or unsupported regular expression. Patterns use RE2 syntax; lookaround and backreferences are not supported.' : '';
function* matchesIn(text, query, options) {
  if (options.regex) {
    const compiled = compiledRegex(query, !!options.caseSensitive); if (!compiled) return;
    const matcher = compiled.matcher(text);
    while (matcher.find()) {
      const value = matcher.group(); if (!value.length) continue;
      yield { 0: value, index: matcher.start(), captures: Array.from({ length: matcher.groupCount() + 1 }, (_, i) => matcher.group(i) || '') };
    }
  } else {
    const expression = new RegExp(pattern(query, options), options.caseSensitive ? 'gu' : 'giu');
    let match; while ((match = expression.exec(text))) yield match;
  }
}
export function replacementForMatch(match, replacement) {
  return match.captures ? replacement.replace(/\$([$&]|\d{1,2})/g, (all, group) => group === '$' ? '$' : group === '&' ? match.text : Number(group) < match.captures.length ? match.captures[Number(group)] : all) : replacement;
}
function hasFormatting(doc, from, to, format) {
  if (!format) return true;
  let found = false, all = true;
  doc.nodesBetween(from, to, node => {
    if (!node.isText) return;
    found = true;
    if (!node.marks.some(mark => mark.type.name === format || format === 'highlight' && mark.type.name === 'textStyle' && !!mark.attrs.backgroundColor)) all = false;
  });
  return found && all;
}
const wordCharacter = /[\p{L}\p{N}\p{M}\p{Pc}'\u2019\u200c\u200d]/u;
const leafText = node => node.type.name === 'hardBreak' ? '\n' : '\uFFFC';
const documentCache = new WeakMap(), searchCache = new WeakMap(), textBlockCache = new WeakMap();
function textForBlock(node) {
  let text = textBlockCache.get(node);
  if (text === undefined) { text = node.textBetween(0, node.content.size, '', leafText); textBlockCache.set(node, text); }
  return text;
}
function documentFor(schema, content) {
  let documents = documentCache.get(schema);
  if (!documents) { documents = new WeakMap(); documentCache.set(schema, documents); }
  let parsed = documents.get(content);
  if (!parsed) { parsed = schema.nodeFromJSON(content); documents.set(content, parsed); }
  return parsed;
}
function characterBefore(text, position) {
  if (!position) return '';
  const last = text.charCodeAt(position - 1);
  const start = last >= 0xdc00 && last <= 0xdfff && position > 1 ? position - 2 : position - 1;
  return text.slice(start, position);
}
function characterAfter(text, position) {
  return position < text.length ? String.fromCodePoint(text.codePointAt(position)) : '';
}

// Matches stay in ProseMirror's original UTF-16 positions even when a phrase
// spans differently formatted runs. The optional single-character wildcard is
// deliberately limited, so user patterns cannot trigger regex backtracking.
export function findTextMatches(doc, query, maximum = 2000, options = {}) {
  if (maximum && typeof maximum === 'object') { options = maximum; maximum = 2000; }
  if (!query || !doc || maximum <= 0) return [];
  const matches = [];
  doc.descendants((node, pos) => {
    if (matches.length >= maximum) return false;
    if (!node.isTextblock) return;
    const text = textForBlock(node);
    for (const match of matchesIn(text, query, options)) {
      if (matches.length >= maximum) break;
      const end = match.index + match[0].length;
      if (options.wholeWord && (wordCharacter.test(characterBefore(text, match.index)) || wordCharacter.test(characterAfter(text, end)))) continue;
      // Inline objects use one placeholder position. A search must not replace
      // a picture just because its placeholder happens to occur in a query.
      if (match[0].includes('\uFFFC')) continue;
      if (!hasFormatting(doc, pos + 1 + match.index, pos + 1 + end, options.format)) continue;
      matches.push({ from: pos + 1 + match.index, to: pos + 1 + end, ...(match.captures ? { captures: match.captures } : {}) });
    }
    return false;
  });
  return matches;
}

// Validate only the selected passage, using the same literal, Unicode and
// whole-word rules as Find. This also covers results beyond the display limit.
export function matchesTextRange(doc, from, to, query, options = {}) {
  if (!doc || !query || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > doc.content.size) return false;
  const start = doc.resolve(from), end = doc.resolve(to);
  if (!start.sameParent(end) || !start.parent.isTextblock) return false;
  const text = textForBlock(start.parent);
  let match;
  for (const candidate of matchesIn(text, query, options)) { if (candidate.index >= start.parentOffset) { match = candidate; break; } }
  if (!match || match.index !== start.parentOffset || match.index + match[0].length !== end.parentOffset || match[0].includes('\uFFFC')) return false;
  return hasFormatting(doc, from, to, options.format) && (!options.wholeWord || !(wordCharacter.test(characterBefore(text, match.index)) || wordCharacter.test(characterAfter(text, end.parentOffset))));
}

function searchSnippet(doc, from, to) {
  const start = doc.resolve(from), end = doc.resolve(to), paragraph = start.parent;
  const text = textForBlock(paragraph);
  const before = text.slice(Math.max(0, start.parentOffset - 44), start.parentOffset);
  const after = text.slice(end.parentOffset, end.parentOffset + 44);
  return { before: (start.parentOffset > 44 ? '…' : '') + before, match: text.slice(start.parentOffset, end.parentOffset), after: after + (end.parentOffset + 44 < text.length ? '…' : '') };
}

// activeDoc is optional and lets callers search the current editor tree before
// its JSON snapshot has reached project state. Result ordering follows chapters.
export function findManuscriptMatches(project, query, { scope = 'manuscript', chapterId, caseSensitive = false, wholeWord = false, wildcard = false, regex = false, format = '', maximum = Infinity, schema = editorialSchema, activeDoc } = {}) {
  if (!project || !query || maximum <= 0) return [];
  const results = [];
  project.chapters.forEach((chapter, chapterIndex) => {
    if (results.length >= maximum || scope === 'chapter' && chapter.id !== chapterId) return;
    const doc = activeDoc && chapter.id === chapterId ? activeDoc : documentFor(schema, chapter.content);
    const signature = JSON.stringify([query, caseSensitive, wholeWord, wildcard, regex, format]);
    let cached = searchCache.get(doc);
    if (cached?.signature !== signature) {
      cached = { signature, matches: findTextMatches(doc, query, Infinity, { caseSensitive, wholeWord, wildcard, regex, format }).map(match => ({ ...match, snippet: searchSnippet(doc, match.from, match.to) })) };
      searchCache.set(doc, cached);
    }
    for (const match of cached.matches) {
      if (results.length >= maximum) break;
      results.push({ ...match, id: `${chapter.id}:${match.from}:${match.to}`, chapterId: chapter.id, chapterTitle: chapter.title || `Chapter ${chapterIndex + 1}`, chapterIndex, text: match.snippet.match });
    }
  });
  return results;
}

export function groupSearchResults(results) {
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.chapterId)) groups.set(result.chapterId, { chapterId: result.chapterId, chapterTitle: result.chapterTitle, results: [] });
    groups.get(result.chapterId).results.push(result);
  }
  return [...groups.values()];
}

export class SearchReplaceError extends Error {
  constructor(message = 'The manuscript changed after this preview. Search again before replacing.') { super(message); this.name = 'SearchReplaceError'; }
}

function replacementMarks(doc, match) {
  const marks = [...(doc.nodeAt(match.from)?.marks || doc.resolve(match.from).marks())];
  // Notes survive a replacement that crosses a comment's start or end. Their
  // metadata stays in the project; deleting the passage can leave a detached note.
  doc.nodesBetween(match.from, match.to, node => {
    for (const mark of node.marks) if (mark.type.name === 'commentAnchor' && !marks.some(existing => existing.eq(mark))) marks.push(mark);
  });
  return marks;
}

// Validate the entire preview before changing any chapter. Applying replacements
// from the end keeps saved positions valid and produces one immutable project for
// the caller's single history event. Unselected formatting and chapter fields stay.
export function replaceManuscriptMatches(project, results, replacement, { schema = editorialSchema } = {}) {
  if (typeof replacement !== 'string') throw new SearchReplaceError('Replacement text must be a string.');
  if (!results.length) return { project, count: 0, changedChapterIds: [], changes: [] };
  const groups = groupSearchResults(results), staged = [];
  for (const group of groups) {
    const chapter = project.chapters.find(item => item.id === group.chapterId);
    if (!chapter) throw new SearchReplaceError();
    const doc = schema.nodeFromJSON(chapter.content), ordered = [...group.results].sort((a, b) => a.from - b.from);
    let previousEnd = -1;
    for (const match of ordered) {
      if (!Number.isInteger(match.from) || !Number.isInteger(match.to) || match.from < 0 || match.to <= match.from || match.to > doc.content.size || match.from < previousEnd || typeof match.text !== 'string') throw new SearchReplaceError('The search preview contains an invalid or overlapping match. Search again before replacing.');
      const start = doc.resolve(match.from), end = doc.resolve(match.to);
      if (!start.sameParent(end) || !start.parent.isTextblock || doc.textBetween(match.from, match.to, '', leafText) !== match.text || match.text.includes('\uFFFC')) throw new SearchReplaceError();
      previousEnd = match.to;
    }
    const transform = new Transform(doc);
    for (const match of ordered.reverse()) {
      const value = replacementForMatch(match, replacement);
      if (value === match.text) continue;
      const content = value ? schema.text(value, replacementMarks(doc, match)) : null;
      transform.replaceWith(match.from, match.to, content || []);
    }
    transform.doc.check();
    if (transform.docChanged) staged.push({ chapterId: chapter.id, doc: transform.doc, transform });
  }
  const changed = new Map(staged.map(change => [change.chapterId, change.doc.toJSON()]));
  return {
    project: changed.size ? { ...project, chapters: project.chapters.map(chapter => changed.has(chapter.id) ? { ...chapter, content: changed.get(chapter.id) } : chapter) } : project,
    count: results.length, changedChapterIds: [...changed.keys()], changes: staged
  };
}
