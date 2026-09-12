import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findTextMatches } from './search.js';
export const ghostKey = new PluginKey('wraiterGhost');
export const searchKey = new PluginKey('wraiterSearch');
export const GhostText = Extension.create({
  name: 'ghostText',
  addProseMirrorPlugins() {
    return [new Plugin({ key: ghostKey,
      state: { init: () => null, apply(tr, value) { const meta = tr.getMeta(ghostKey); if (meta !== undefined) return meta; return tr.docChanged || tr.selectionSet ? null : value; } },
      props: { decorations(state) {
        const ghost = ghostKey.getState(state);
        if (!ghost?.text) return null;
        return DecorationSet.create(state.doc, [Decoration.widget(ghost.pos, () => {
          const span = document.createElement('span'); span.className = 'ghost-text'; span.textContent = ghost.text; span.setAttribute('aria-label', 'AI suggestion'); span.setAttribute('contenteditable', 'false'); return span;
        }, { side: 1, key: ghost.text })]);
      } }
    })];
  }
});
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',
  addProseMirrorPlugins() {
    return [new Plugin({ key: searchKey,
      state: { init: () => '', apply: (tr, value) => tr.getMeta(searchKey) ?? value },
      props: { decorations(state) {
        const query = searchKey.getState(state);
        if (!query) return null;
        const decorations = findTextMatches(state.doc, query).map(match => Decoration.inline(match.from, match.to, { class: 'search-match' }));
        return DecorationSet.create(state.doc, decorations);
      } }
    })];
  }
});
