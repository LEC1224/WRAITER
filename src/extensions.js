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
      state: { init: () => null, apply(tr, value) { const meta = tr.getMeta(ghostKey); if (meta !== undefined) return meta; if (value?.kind === 'loading' && tr.docChanged) return { ...value, pos: tr.mapping.map(value.pos) }; return tr.docChanged || tr.selectionSet ? null : value; } },
      props: { decorations(state) {
        const ghost = ghostKey.getState(state);
        if (!ghost) return null;
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
function cssPoints(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(-?[\d.]+)(px|pt|in|cm|mm|pc)?$/i);
  if (!match) return null;
  return Number(match[1]) * ({ px: 0.75, pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12 }[match[2]?.toLowerCase() || 'pt'] || 1);
}
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading'], attributes: {
    pageBreakBefore: { default: null, keepOnSplit: false, parseHTML: element => ['page', 'always'].includes(element.style.breakBefore || element.style.pageBreakBefore) ? true : null, renderHTML: attrs => attrs.pageBreakBefore ? { style: 'break-before: page', 'data-page-break': 'true' } : {} },
    lineHeight: { default: null, parseHTML: element => element.style.lineHeight || null, renderHTML: attrs => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {} },
    spaceAfter: { default: null, parseHTML: element => cssPoints(element.style.marginBottom), renderHTML: attrs => attrs.spaceAfter != null ? { style: `margin-bottom: ${attrs.spaceAfter}pt` } : {} },
    firstLineIndent: { default: null, parseHTML: element => cssPoints(element.style.textIndent), renderHTML: attrs => attrs.firstLineIndent != null ? { style: `text-indent: ${attrs.firstLineIndent}pt` } : {} }
  } }]; },
  addCommands() { return { setParagraphFormat: attributes => ({ commands }) => commands.updateAttributes('paragraph', attributes) }; }
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
