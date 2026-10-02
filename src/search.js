import { Transform } from '@tiptap/pm/transform';
import { editorialSchema } from '../electron/editor-schema.mjs';

const literal = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordCharacter = /[\p{L}\p{N}\p{M}\p{Pc}'\u2019\u200c\u200d]/u;
const leafText = node => node.type.name === 'hardBreak' ? '\n' : '\uFFFC';
const documentCache = new WeakMap(), searchCache = new WeakMap(), snippetTextCache = new WeakMap();
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
// spans differently formatted runs. Searches are literal, never user regexes.
export function findTextMatches(doc, query, maximum = 2000, options = {}) {
  if (maximum && typeof maximum === 'object') { options = maximum; maximum = 2000; }
  if (!query || !doc || maximum <= 0) return [];
  const expression = new RegExp(literal(String(query)), options.caseSensitive ? 'gu' : 'giu');
  const matches = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock || matches.length >= maximum) return;
    const text = node.textBetween(0, node.content.size, '', leafText);
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(text)) && matches.length < maximum) {
      const end = match.index + match[0].length;
      if (options.wholeWord && (wordCharacter.test(characterBefore(text, match.index)) || wordCharacter.test(characterAfter(text, end)))) continue;
      // Inline objects use one placeholder position. A search must not replace
      // a picture just because its placeholder happens to occur in a query.
      if (match[0].includes('\uFFFC')) continue;
      matches.push({ from: pos + 1 + match.index, to: pos + 1 + end });
    }
    return false;
  });
  return matches;
}

function searchSnippet(doc, from, to) {
  const start = doc.resolve(from), end = doc.resolve(to), paragraph = start.parent;
  let text = snippetTextCache.get(paragraph);
  if (text === undefined) { text = paragraph.textBetween(0, paragraph.content.size, '', leafText); snippetTextCache.set(paragraph, text); }
  const before = text.slice(Math.max(0, start.parentOffset - 44), start.parentOffset);
  const after = text.slice(end.parentOffset, end.parentOffset + 44);
  return { before: (start.parentOffset > 44 ? '…' : '') + before, match: text.slice(start.parentOffset, end.parentOffset), after: after + (end.parentOffset + 44 < text.length ? '…' : '') };
}

// activeDoc is optional and lets callers search the current editor tree before
// its JSON snapshot has reached project state. Result ordering follows chapters.
export function findManuscriptMatches(project, query, { scope = 'manuscript', chapterId, caseSensitive = false, wholeWord = false, maximum = Infinity, schema = editorialSchema, activeDoc } = {}) {
  if (!project || !query || maximum <= 0) return [];
  const results = [];
  project.chapters.forEach((chapter, chapterIndex) => {
    if (results.length >= maximum || scope === 'chapter' && chapter.id !== chapterId) return;
    const doc = activeDoc && chapter.id === chapterId ? activeDoc : documentFor(schema, chapter.content);
    const signature = JSON.stringify([query, caseSensitive, wholeWord]);
    let cached = searchCache.get(doc);
    if (cached?.signature !== signature) {
      cached = { signature, matches: findTextMatches(doc, query, Infinity, { caseSensitive, wholeWord }).map(match => ({ ...match, snippet: searchSnippet(doc, match.from, match.to) })) };
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
      if (replacement === match.text) continue;
      const content = replacement ? schema.text(replacement, replacementMarks(doc, match)) : null;
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
