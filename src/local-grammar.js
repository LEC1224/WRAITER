import { createGrammarBatchPicker } from './grammar-batch-picker.js';
import { grammarVoiceFilter } from './grammar-voice.js';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { updateHintDecorations } from './grammar-decorations.js';
import { checkAdvancedOffline, checkOffline, currentDictionaryVersion, subscribeDictionary } from './offline-grammar-client.js';

import { grammarHints } from './local-grammar-rules.js';
export { grammarHints } from './local-grammar-rules.js';

const blockCache = new WeakMap();
const english = language => /^en(?:-|$)/i.test(language || '');
const supported = language => /^(?:en|sv)(?:-|$)/i.test(language || '');
const activeChecker = options => supported(options.language) && (options.enabled || options.review || english(options.language) && options.spelling);
function blockData(node) {
  let data = blockCache.get(node);
  if (data) return data;
  let text = '', pendingRevision = false;
  node.forEach(child => {
    if (child.marks.some(mark => mark.type.name === 'trackedChange')) pendingRevision = true;
    // Keep document offsets, but do not join words across atoms/code.
    text += child.isText && !child.marks.some(mark => mark.type.spec.code) ? child.text : '\ufffc'.repeat(child.nodeSize);
  });
  data = { text, pendingRevision, keepHint: grammarVoiceFilter(text), local: new Map(), advanced: new Map(), merged: new Map() };
  blockCache.set(node, data); return data;
}

// Prefer sentence boundaries and keep even very long paragraphs bounded. The
// object-replacement character marks inline code and atoms; never infer grammar
// across one. The chunks retain their original UTF-16 offsets for ProseMirror.
export function splitOfflinePassage(text) {
  const chunks = [];
  const addRange = (from, to) => {
    while (from < to) {
      let cut = Math.min(from + 3500, to);
      if (cut < to) {
        const piece = text.slice(from, cut); let sentenceEnd = 0;
        for (const match of piece.matchAll(/[.!?…]["'”’\])}]*\s+/gu)) if (match.index + match[0].length >= 1000) sentenceEnd = match.index + match[0].length;
        if (sentenceEnd) cut = from + sentenceEnd;
        else {
          const space = Math.max(piece.lastIndexOf(' '), piece.lastIndexOf('\n'), piece.lastIndexOf('\t'));
          if (space > 1000) cut = from + space + 1;
        }
        if (/[\uD800-\uDBFF]/u.test(text[cut - 1]) && /[\uDC00-\uDFFF]/u.test(text[cut])) cut--;
      }
      const passage = text.slice(from, cut), status = passage.trim() ? 'waiting' : 'done';
      chunks.push({ from, text: passage, status, hints: [], deepStatus: status, deepHints: [] }); from = cut;
    }
  };
  let from = 0, boundary;
  while ((boundary = text.indexOf('\ufffc', from)) !== -1) { addRange(from, boundary); from = boundary + 1; }
  addRange(from, text.length);
  return chunks;
}
function entryFor(node, language, dictionaryVersion) {
  const data = blockData(node), key = `${language}:${dictionaryVersion}`;
  if (!data.advanced.has(key)) {
    // A node can outlive several dictionary changes. Old entries are not useful.
    data.advanced.clear(); data.merged.clear();
    const entry = { chunks: splitOfflinePassage(data.text), revision: 0 };
    for (const chunk of entry.chunks) chunk.entry = entry;
    data.advanced.set(key, entry);
  }
  return data.advanced.get(key);
}
function textblocks(doc, callback) {
  doc.descendants((node, pos) => {
    if (node.type.spec.code || node.type.name === 'note') return false;
    if (!node.isTextblock) return;
    callback(node, pos); return false;
  });
}

function prepareLocalRules(node, language) {
  const data = blockData(node);
  if (!data.pendingRevision && !data.local.has(language)) {
    // Long textblocks are checked in bounded worker chunks.
    data.local.set(language, data.text.length <= 3500 ? grammarHints(data.text, language) : []);
  }
  return data;
}

export function documentGrammar(doc, language = 'en-US', { spelling = false, grammar = true, dictionaryVersion = currentDictionaryVersion(), deferred } = {}) {
  if (!supported(language)) return [];
  const hints = [];
  const entryKey = `${language}:${dictionaryVersion}`, cacheKey = `${entryKey}:${grammar}:${spelling}`;
  let checkedNewBlock = false;
  textblocks(doc, (node, pos) => {
    let data = blockCache.get(node);
    if (data?.pendingRevision) return;
    if (!data?.local.has(language)) {
      // A normal keystroke changes one paragraph. Opening a chapter or
      // pasting many blocks should not run every rule in that transaction.
      if (deferred && checkedNewBlock) { deferred.push(node); return; }
      checkedNewBlock = true;
      data = prepareLocalRules(node, language);
      if (data.pendingRevision) return;
    }
    const entry = data.advanced.get(entryKey);
    let merged = data.merged.get(cacheKey);
    if (!merged || merged.revision !== (entry?.revision ?? -1)) {
      const local = grammar ? data.local.get(language).map(hint => ({ ...hint, category: 'grammar', rule: 'wraiter' })) : [];
      const advanced = entry ? entry.chunks.flatMap(chunk => [...chunk.hints, ...chunk.deepHints].map(hint => ({ ...hint, from: hint.from + chunk.from, to: hint.to + chunk.from }))) : [];
      const candidates = [...local.map(hint => ({ ...hint, priority: 0 })), ...advanced.filter(hint => hint.category === 'spelling' ? spelling : grammar).map(hint => ({ ...hint, priority: hint.rule === 'wraiter' ? 0 : hint.category === 'spelling' ? 4 : hint.rule?.startsWith('neural:') ? 3 : hint.rule?.startsWith('learned:') ? 2 : 1 }))];
      // Established grammar checks win on overlap; spelling comes last.
      const chosen = [], occupied = candidates.length > 32 ? new Uint8Array(data.text.length) : null;
      for (const hint of candidates.sort((a, b) => a.priority - b.priority || a.from - b.from || a.to - b.to)) {
        if (!data.keepHint(hint)) continue;
        if (hint.from < 0 || hint.to > data.text.length || hint.to <= hint.from || data.text.slice(hint.from, hint.to) !== hint.original) continue;
        let overlaps = false;
        if (occupied) { for (let position = hint.from; position < hint.to && !overlaps; position++) overlaps = !!occupied[position]; }
        else overlaps = chosen.some(other => hint.from < other.to && hint.to > other.from);
        if (overlaps) continue;
        if (occupied) occupied.fill(1, hint.from, hint.to);
        chosen.push(hint);
      }
      merged = { revision: entry?.revision ?? -1, hints: chosen.sort((a, b) => a.from - b.from) };
      data.merged.set(cacheKey, merged);
    }
    if (merged.hints.length) {
      if (merged.pos !== pos) {
        merged.pos = pos;
        merged.positioned = merged.hints.map(hint => {
          const from = hint.from + pos + 1, to = hint.to + pos + 1;
          return { ...hint, from, to, id: `${from}:${to}:${hint.rule || 'local'}` };
        });
      }
      for (const hint of merged.positioned) hints.push(hint);
    }
  });
  return hints;
}

// An immutable chapter keeps a cursor for each engine. Completed batches at
// its beginning need not be re-enumerated to find the next two passages.
function batchPlan(doc, language, version) {
  const blocks = [];
  textblocks(doc, (node, pos) => blocks.push({ node, pos }));
  const key = language + ':' + version;
  const next = createGrammarBatchPicker(blocks, (node, deep) => {
    const data = deep ? blockCache.get(node) : blockData(node);
    if (data?.pendingRevision) return [];
    // Deep checks wait for a basic result. A cold paragraph needs no entry yet.
    const entry = deep ? data?.advanced.get(key) : entryFor(node, language, version);
    return entry?.chunks;
  });
  return { doc, language, version, next };
}

function reserveChunks(tasks, status, signal) {
  for (const task of tasks) task[status] = 'pending';
  const release = () => { for (const task of tasks) task[status] = 'waiting'; };
  signal.addEventListener('abort', release, { once: true });
  return release;
}

export const grammarKey = new PluginKey('localGrammar');
const ignoreKey = hint => `${hint.category}\0${hint.rule}\0${hint.original.toLocaleLowerCase('en')}`;
function mapIgnoredHint(hint, transaction) {
  if (!transaction.docChanged) return hint;
  try {
    const from = transaction.mapping.mapResult(hint.from, 1), to = transaction.mapping.mapResult(hint.to, -1);
    if (from.deletedAcross || to.deletedAcross || from.pos >= to.pos ||
        transaction.before.resolve(hint.from).parent !== transaction.doc.resolve(from.pos).parent ||
        transaction.doc.textBetween(from.pos, to.pos, '', '\n') !== hint.original) return null;
    return { ...hint, from: from.pos, to: to.pos };
  } catch { return null; }
}
export function localDecorationWindow(hints, position, maximum = 1000) {
  if (hints.length <= maximum) return hints;
  let low = 0, high = hints.length;
  while (low < high) { const middle = (low + high) >>> 1; if (hints[middle].from < position) low = middle + 1; else high = middle; }
  const start = Math.max(0, Math.min(hints.length - maximum, low - Math.floor(maximum / 2)));
  return hints.slice(start, start + maximum);
}

function hintDecoration(hint) {
  const description = hint.reason + (hint.replacement === null ? '' : ' Suggested: ' + hint.replacement);
  return Decoration.inline(hint.from, hint.to, {
    class: hint.category === 'spelling' ? 'local-spelling-hint' : 'local-grammar-hint',
    'data-local-grammar-id': hint.id, title: description, 'aria-description': description
  }, { hint });
}

export function localGrammarHintForMenu(state, targetId, keyboard) {
  const hints = grammarKey.getState(state)?.hints || [];
  if (!keyboard) return hints.find(hint => hint.id === targetId);
  const { from, to, empty } = state.selection;
  return hints.find(hint => hint.from <= from && from < hint.to && to <= hint.to)
    || (empty ? hints.find(hint => hint.to === from) : undefined);
}
export const LocalGrammar = Extension.create({
  name: 'localGrammar',
  addOptions() { return { enabled: false, spelling: false, review: false, language: 'en-US' }; },
  addProseMirrorPlugins() {
    const initial = this.options;
    return [new Plugin({ key: grammarKey, state: {
      init: () => ({ ...initial, status: 'idle', viewport: null, deferred: [], ignoredOnce: [], ignoredAll: new Set(), rawHints: [], hints: [], allHints: [], visible: [], decorations: DecorationSet.empty }),
      apply(tr, state) {
        const update = tr.getMeta(grammarKey);
        if (!tr.docChanged && !update && !(tr.selectionSet && state.hints.length > 1000)) return state;
        const options = { ...state, ...(update || {}) };
        if (tr.selectionSet && !Object.hasOwn(update || {}, 'viewport')) options.viewport = null;
        const active = activeChecker(options);
        const changedOptions = ['enabled', 'spelling', 'review', 'language'].some(key => options[key] !== state[key]);
        let ignoredOnce = tr.docChanged && state.ignoredOnce.length ? state.ignoredOnce.map(hint => mapIgnoredHint(hint, tr)).filter(Boolean) : state.ignoredOnce;
        let ignoredAll = state.ignoredAll;
        const requested = update?.ignore;
        if (requested && state.allHints.some(hint => hint.id === requested.id && hint.original === requested.original)) {
          if (requested.all) ignoredAll = new Set(ignoredAll).add(ignoreKey(requested));
          else ignoredOnce = [...ignoredOnce, requested];
        }
        const collect = tr.docChanged || update?.refresh || changedOptions;
        const deferred = collect ? [] : state.deferred;
        const rawHints = collect ? (active ? documentGrammar(tr.doc, options.language, { spelling: true, deferred }) : []) : state.rawHints;
        const needsFiltering = rawHints !== state.rawHints || tr.docChanged || !!requested;
        const allHints = !needsFiltering ? state.allHints : !ignoredAll.size && !ignoredOnce.length ? rawHints :
          rawHints.filter(hint => !ignoredAll.has(ignoreKey(hint)) && !ignoredOnce.some(ignored => ignored.from === hint.from && ignored.to === hint.to && ignoreKey(ignored) === ignoreKey(hint)));
        const hints = allHints === state.allHints && !changedOptions ? state.hints : options.spelling && options.enabled ? allHints :
          allHints.filter(hint => hint.category === 'spelling' ? options.spelling : options.enabled);
        const visible = localDecorationWindow(hints, options.viewport ?? tr.selection.head);
        const decorations = updateHintDecorations(tr, state.decorations, state.visible, visible, hintDecoration);
        return { ...options, deferred, ignoredOnce, ignoredAll, rawHints, hints, allHints, visible, decorations };
      }
    }, props: { decorations: state => grammarKey.getState(state).decorations },
    view(view) {
      let timer, localTimer, scrollFrame, scrollParent, basicRetry, deepRetry, destroyed = false, basicInFlight = false, deepInFlight = false, basicFailed = false, deepFailed = false, lastDoc, lastKey, lastEngineKey;
      let basicDelay = 5000, deepDelay = 5000, plan, controller = new AbortController();
      const schedule = delay => { clearTimeout(timer); timer = setTimeout(run, delay); };
      const refresh = update => { if (!destroyed) view.dispatch(view.state.tr.setMeta(grammarKey, update).setMeta('addToHistory', false)); };
      function checkDeferredRules() {
        localTimer = null;
        if (destroyed) return;
        const { deferred, language, viewport } = grammarKey.getState(view.state);
        if (!deferred.length) return;
        const until = performance.now() + 5;
        const at = viewport ?? view.state.selection.head;
        const priority = view.state.doc.resolve(Math.min(at, view.state.doc.content.size)).parent;
        if (deferred.includes(priority)) prepareLocalRules(priority, language);
        for (const node of deferred) {
          prepareLocalRules(node, language);
          if (performance.now() >= until) break;
        }
        refresh({ refresh: true });
      }
      // A child process or worker can be interrupted independently of the
      // editor. Retry transient failures without retrying on every keystroke.
      const retry = deep => {
        if (deep) {
          clearTimeout(deepRetry);
          deepRetry = setTimeout(() => { deepRetry = null; deepFailed = false; schedule(0); }, deepDelay);
          deepDelay = Math.min(deepDelay * 2, 60000);
        } else {
          clearTimeout(basicRetry);
          basicRetry = setTimeout(() => { basicRetry = null; basicFailed = false; schedule(0); }, basicDelay);
          basicDelay = Math.min(basicDelay * 2, 60000);
        }
      };
      const unsubscribe = subscribeDictionary(() => { basicFailed = false; deepFailed = false; refresh({ status: 'checking', refresh: true }); schedule(0); });
      const scrolled = () => {
        const options = grammarKey.getState(view.state);
        if (scrollFrame || (options.hints.length <= 1000 && options.deferred.length <= 1000)) return;
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0;
          if (destroyed || !scrollParent) return;
          const bounds = scrollParent.getBoundingClientRect(), editorBounds = view.dom.getBoundingClientRect();
          const x = Math.max(bounds.left + 1, Math.min(bounds.right - 1, (editorBounds.left + editorBounds.right) / 2));
          const position = view.posAtCoords({ left: x, top: (bounds.top + bounds.bottom) / 2 })?.pos;
          const current = grammarKey.getState(view.state);
          if (position != null && Math.abs(position - (current.viewport ?? view.state.selection.head)) > 500) refresh({ viewport: position });
        });
      };
      const attachScroll = () => {
        if (!destroyed && !scrollParent) { scrollParent = view.dom.closest('.writing-scroll'); scrollParent?.addEventListener('scroll', scrolled, { passive: true }); }
      };
      requestAnimationFrame(attachScroll);
      function run() {
        if (destroyed) return;
        const options = grammarKey.getState(view.state), version = currentDictionaryVersion();
        if (!activeChecker(options)) return;
        const { signal } = controller;
        plan ??= batchPlan(view.state.doc, options.language, version);
        const position = options.viewport ?? view.state.selection.head;
        let started = false;
        if (!basicInFlight && !basicFailed) {
          const tasks = plan.next(position);
          if (tasks.length) {
            started = basicInFlight = true;
            const release = reserveChunks(tasks, 'status', signal);
            checkOffline(tasks.map(task => task.text), options.language, version, signal).then(results => {
              if (signal.aborted) return;
              for (let index = 0; index < tasks.length; index++) { tasks[index].hints = results[index] || []; tasks[index].status = 'done'; tasks[index].entry.revision++; }
              clearTimeout(basicRetry); basicRetry = null; basicDelay = 5000; refresh({ status: 'checking', refresh: true });
            }).catch(error => {
              if (signal.aborted) return;
              release(); basicFailed = true;
              if (!destroyed) { refresh({ status: 'error', error: String(error?.message || error) }); retry(false); }
            }).finally(() => { signal.removeEventListener('abort', release); basicInFlight = false; if (!destroyed) schedule(0); });
          }
        }
        if ((options.enabled || options.review) && !deepInFlight && !deepFailed) {
          const tasks = plan.next(position, true);
          if (tasks.length) {
            started = deepInFlight = true;
            const release = reserveChunks(tasks, 'deepStatus', signal);
            checkAdvancedOffline(tasks.map(task => task.text), options.language, signal).then(results => {
              if (signal.aborted) return;
              for (let index = 0; index < tasks.length; index++) { tasks[index].deepHints = results[index] || []; tasks[index].deepStatus = 'done'; tasks[index].entry.revision++; }
              clearTimeout(deepRetry); deepRetry = null; deepDelay = 5000; refresh({ status: 'checking', refresh: true });
            }).catch(error => {
              if (signal.aborted) return;
              release(); deepFailed = true;
              if (!destroyed) { refresh({ status: 'degraded', error: String(error?.message || error) }); retry(true); }
            }).finally(() => { signal.removeEventListener('abort', release); deepInFlight = false; if (!destroyed) schedule(0); });
          }
        }
        if (started && options.status !== 'checking') refresh({ status: 'checking' });
        if (!started && !basicInFlight && !deepInFlight) {
          const status = basicFailed ? 'error' : deepFailed && (options.enabled || options.review) ? 'degraded' : 'ready';
          if (options.status !== status) refresh({ status });
        }
      }
      return {
        update(next, previous) {
          const options = grammarKey.getState(next.state);
          if (plan && (plan.doc !== next.state.doc || plan.language !== options.language || plan.version !== currentDictionaryVersion())) plan = null;
          if (options.deferred.length && !localTimer) localTimer = setTimeout(checkDeferredRules, 16);
          attachScroll();
          if (options.hints.length > 1000 && grammarKey.getState(previous).hints.length <= 1000) scrolled();
          const engineKey = `${options.enabled}:${options.spelling}:${options.review}:${options.language}:${currentDictionaryVersion()}`;
          const key = `${engineKey}:${options.viewport}`;
          if (engineKey !== lastEngineKey) {
            controller.abort(); controller = new AbortController();
            clearTimeout(basicRetry); clearTimeout(deepRetry); basicRetry = deepRetry = null;
            basicDelay = deepDelay = 5000; basicFailed = false; deepFailed = false; lastEngineKey = engineKey;
          }
          if (next.state.doc !== lastDoc || key !== lastKey) {
            lastDoc = next.state.doc; lastKey = key;
            if (activeChecker(options)) schedule(250);
          }
        },
        destroy() { destroyed = true; controller.abort(); clearTimeout(timer); clearTimeout(localTimer); clearTimeout(basicRetry); clearTimeout(deepRetry); if (scrollFrame) cancelAnimationFrame(scrollFrame); scrollParent?.removeEventListener('scroll', scrolled); unsubscribe(); }
      };
    } })];
  }
});


