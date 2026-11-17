import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { updateHintDecorations } from './grammar-decorations.js';

export function grammarHints(text, language = 'en-US') {
  if (!/^en(?:-|$)/i.test(language)) return [];
  const hints = [];
  const add = (from, original, replacement, reason) => hints.push({ from, to: from + original.length, original, replacement, reason });
  for (const match of text.matchAll(/\b([\p{L}]+)([ \t]+)\1\b/giu)) add(match.index, match[0], match[1], 'Repeated word; keep it if the repetition is intentional.');
  for (const match of text.matchAll(/\b(could|would|should|might|must)([ \t]+)of\b/gi)) add(match.index, match[0], match[1] + match[2] + 'have', 'This expression usually takes “have”.');
  for (const match of text.matchAll(/\b(a|an)([ \t]+)([a-z][a-z'-]*)\b/gi)) {
    const word = match[3].toLowerCase();
    // Conservative pronunciation exceptions. Acronyms, numbers and quoted
    // dialogue contractions are deliberately left for a fuller proofread.
    const vowel = /^(honest|honou?r|hour|heir)/.test(word) || /^[aeiou]/.test(word) && !/^(uni(?:corn|form|que|t|vers)|use|user|usual|util|euro|one\b|once\b)/.test(word);
    const expected = vowel ? 'an' : 'a';
    if (match[1].toLowerCase() !== expected) {
      const replacement = /^[A-Z]/.test(match[1]) ? expected[0].toUpperCase() + expected.slice(1) : expected;
      add(match.index, match[1], replacement, 'Check the indefinite article before this word.');
    }
  }
  return hints.sort((a, b) => a.from - b.from).filter((hint, index, all) => index === 0 || hint.from >= all[index - 1].to);
}

const blockCache = new WeakMap();
function prepareLocalRules(node, language) {
  let cached = blockCache.get(node);
  if (!cached || cached.language !== language) {
    cached = { language, hints: grammarHints(node.textBetween(0, node.content.size, '', '\ufffc'), language) };
    blockCache.set(node, cached);
  }
  return cached;
}

export function documentGrammar(doc, language, deferred) {
  const hints = [];
  let checkedNewBlock = false;
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return;
    let cached = blockCache.get(node);
    if (!cached || cached.language !== language) {
      if (deferred && checkedNewBlock) { deferred.push(node); return false; }
      checkedNewBlock = true; cached = prepareLocalRules(node, language);
    }
    if (cached.pos !== pos) {
      cached.pos = pos;
      cached.positioned = cached.hints.map(hint => {
        const from = hint.from + pos + 1, to = hint.to + pos + 1;
        return { ...hint, from, to, id: `${from}:${to}:local` };
      });
    }
    for (const hint of cached.positioned) hints.push(hint);
    return false;
  });
  return hints;
}
export const grammarKey = new PluginKey('localGrammar');
export const LocalGrammar = Extension.create({
  name: 'localGrammar',
  addOptions() { return { enabled: false, language: 'en-US' }; },
  addProseMirrorPlugins() {
    const initial = this.options;
    return [new Plugin({ key: grammarKey, state: {
      init: () => ({ ...initial, deferred: [], hints: [], visible: [], decorations: DecorationSet.empty }),
      apply(tr, state) {
        const update = tr.getMeta(grammarKey);
        const options = update ? { ...state, ...update } : state;
        if (!tr.docChanged && !update) return state;
        const deferred = [];
        const hints = options.enabled ? documentGrammar(tr.doc, options.language, deferred) : [];
        const visible = hints.slice(0, 1000);
        const decorations = updateHintDecorations(tr, state.decorations, state.visible, visible,
          hint => Decoration.inline(hint.from, hint.to, { class: 'local-grammar-hint', title: hint.reason + ' Suggested: ' + hint.replacement }, { hint }));
        return { ...options, hints, visible, deferred, decorations };
      }
    }, props: { decorations: state => grammarKey.getState(state).decorations }, view(view) {
      let timer;
      function checkDeferredRules() {
        timer = null;
        const { deferred, language } = grammarKey.getState(view.state);
        if (!deferred.length) return;
        const until = performance.now() + 5;
        for (const node of deferred) {
          prepareLocalRules(node, language);
          if (performance.now() >= until) break;
        }
        view.dispatch(view.state.tr.setMeta(grammarKey, { refresh: true }).setMeta('addToHistory', false));
      }
      return {
        update(next) { if (!timer && grammarKey.getState(next.state).deferred.length) timer = setTimeout(checkDeferredRules, 16); },
        destroy() { clearTimeout(timer); }
      };
    } })];
  }
});
