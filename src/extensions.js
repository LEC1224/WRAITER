import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findTextMatches, matchesTextRange } from './search.js';
export const ghostKey = new PluginKey('wraiterGhost');
export const searchKey = new PluginKey('wraiterSearch');
export const formattingMarksKey = new PluginKey('wraiterFormattingMarks');

function paragraphMark() {
  const mark = document.createElement('span');
  mark.className = 'format-mark-paragraph';
  mark.textContent = '¶';
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function formattingMarks(doc, from, to) {
  const decorations = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const start = Math.max(0, from - pos);
      const text = node.text.slice(start, to - pos);
      for (const match of text.matchAll(/[ \t]/g)) {
        const at = pos + start + match.index;
        decorations.push(Decoration.inline(at, at + 1, { class: match[0] === '\t' ? 'format-mark-tab' : 'format-mark-space' }));
      }
    } else if (node.isTextblock) {
      const end = pos + node.nodeSize - 1;
      if (end >= from && end <= to) decorations.push(Decoration.widget(end, paragraphMark, { side: 1 }));
    }
  });
  return decorations;
}

export const FormattingMarks = Extension.create({
  name: 'formattingMarks',
  addProseMirrorPlugins() {
    return [new Plugin({ key: formattingMarksKey,
      state: {
        init: () => null,
        apply(tr, previous) {
          const enabled = tr.getMeta(formattingMarksKey);
          if (enabled === false || (!previous && !enabled)) return null;
          const doc = tr.doc;
          if (!previous) return DecorationSet.create(doc, formattingMarks(doc, 0, doc.content.size));
          const changed = tr.changedRange();
          if (!changed) return previous;
          // An insertion, deletion or split can also move a paragraph marker
          // onto its boundary. Recheck both edges along with the changed text.
          const from = Math.max(0, changed.from - 1), to = Math.min(doc.content.size, changed.to + 1);
          // For a bulk replacement, mapping every old marker through every
          // step and then removing most of them costs more than a fresh set.
          if (tr.steps.length > 8 || to - from > doc.content.size / 2) {
            return DecorationSet.create(doc, formattingMarks(doc, 0, doc.content.size));
          }
          const mapped = previous.map(tr.mapping, doc);
          const replaced = mapped.find(from, to).filter(mark => mark.from >= from && mark.to <= to);
          return mapped.remove(replaced).add(doc, formattingMarks(doc, from, to));
        }
      },
      props: { decorations: state => formattingMarksKey.getState(state) }
    })];
  }
});
export const GhostText = Extension.create({
  name: 'ghostText',
  addProseMirrorPlugins() {
    return [new Plugin({ key: ghostKey,
      state: { init: () => null, apply(tr, value) { const meta = tr.getMeta(ghostKey); if (meta !== undefined) return meta; if (value?.kind === 'loading' && tr.docChanged) return { ...value, pos: tr.mapping.map(value.pos) }; return tr.docChanged || tr.selectionSet ? null : value; } },
      props: { decorations(state) {
        const ghost = ghostKey.getState(state);
        if (!ghost || ghost.kind === 'assessment') return null;
        const decorations = [Decoration.widget(ghost.pos, () => {
          const span = document.createElement('span'); span.className = ghost.kind === 'loading' ? 'ai-loading' : `ghost-text ${ghost.kind === 'revision' ? 'revision-preview' : ''}`;
          span.textContent = ghost.kind === 'loading' ? '···' : `${ghost.kind === 'revision' ? ' → ' : ''}${ghost.text}`;
          span.setAttribute('aria-label', ghost.kind === 'loading' ? 'Generating suggestion' : 'AI suggestion'); span.setAttribute('contenteditable', 'false'); return span;
        }, { side: 1, key: `${ghost.kind}:${ghost.text || ''}` })];
        if (ghost.kind === 'revision') decorations.push(Decoration.inline(ghost.from, ghost.to, { class: 'revision-source' }));
        return DecorationSet.create(state.doc, decorations);
      } }
    })];
  }
});
export { ParagraphFormat } from '../electron/editor-schema.mjs';
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',
  addProseMirrorPlugins() {
    // Cursor moves, toolbar actions and pagination metadata keep the same
    // immutable document. Reuse highlights until that document or query changes.
    let cached = null;
    return [new Plugin({ key: searchKey,
      state: { init: () => '', apply: (tr, value) => tr.getMeta(searchKey) ?? value },
      props: { decorations(state) {
        const value = searchKey.getState(state), options = typeof value === 'string' ? { query: value } : value || {};
        const query = options.query, caseSensitive = !!options.caseSensitive, wholeWord = !!options.wholeWord;
        if (!query) { cached = null; return null; }
        if (cached?.doc !== state.doc || cached.query !== query || cached.caseSensitive !== caseSensitive || cached.wholeWord !== wholeWord || cached.wildcard !== options.wildcard || cached.regex !== options.regex || cached.format !== options.format) {
          const decorations = findTextMatches(state.doc, query, 2000, options).map(match => Decoration.inline(match.from, match.to, { class: 'search-match' }));
          cached = { doc: state.doc, query, caseSensitive, wholeWord, wildcard: options.wildcard, regex: options.regex, format: options.format, decorations: DecorationSet.create(state.doc, decorations) };
        }
        const { from, to } = state.selection;
        if (cached.from === from && cached.to === to) return cached.current;
        cached.from = from; cached.to = to; cached.current = cached.decorations;
        if (from !== to) {
          const existing = cached.decorations.find(from, to).find(item => item.from === from && item.to === to);
          if (existing || matchesTextRange(state.doc, from, to, query, options)) {
            const active = Decoration.inline(from, to, { class: 'search-match search-match-active' });
            cached.current = cached.decorations.remove(existing ? [existing] : []).add(state.doc, [active]);
          }
        }
        return cached.current;
      } }
    })];
  }
});
