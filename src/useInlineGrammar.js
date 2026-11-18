import { useEffect, useRef, useState } from 'react';
import { Mapping } from '@tiptap/pm/transform';
import { aiGrammarKey, inlineGrammarPassages, inlineGrammarFindings, mapGrammarHint, aiGrammarTransaction, outsideCheckedPassages } from './ai-grammar.js';
import { readParsedDocument } from './document-cache.js';

const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const hintKey = h => JSON.stringify([h.from, h.to, h.original, h.replacement]);

export default function useInlineGrammar({ editor, api, prefs, projectId, chapterId, chapters, language, paused, onNotice }) {
  const [status, setStatus] = useState({ kind: 'idle', count: 0 }), [selected, setSelected] = useState(null);
  const runtime = useRef(null), cache = useRef(new Map()), ignored = useRef(new Map()), checkedScope = useRef(null);
  const latest = useRef({ chapters, paused }); latest.current = { chapters, paused };
  const signature = JSON.stringify([prefs.provider, prefs.baseUrl, prefs.model, prefs.codexPath, prefs.claudePath, prefs.taskProfiles?.proofread]);
  const enabled = !!prefs.aiGrammar && !!prefs.enabled;
  useEffect(() => {
    setSelected(null);
    if (!enabled) { setStatus(previous => previous.kind === 'idle' ? previous : { kind: 'idle', count: 0 }); return; }
    if (!editor || editor.isDestroyed || !api) return;
    const binding = editor.storage.wraiterContext;
    if (binding && (binding.projectId !== projectId || binding.chapterId !== chapterId)) return;
    let timer, timerAt = 0, active, disposed = false, failures = 0, nextAttempt = 0, currentBatches = 0, progress = { checked: 0, total: 0 };
    const scope = JSON.stringify([projectId, language, signature]);
    if (checkedScope.current?.scope !== scope) checkedScope.current = { scope, completed: new Set() };
    const completed = checkedScope.current.completed, shown = new Set(), contextKeys = new Map(), passageKeys = new WeakMap();
    const decoded = new WeakMap();
    let sourceCache, refreshedSources, paintedDoc, resultsChanged = false, activeResultsChanged = false, preparing = false;
    const live = () => aiGrammarKey.getState(editor.state)?.hints || [];
    const contextKey = id => {
      if (!contextKeys.has(id)) contextKeys.set(id, JSON.stringify([projectId, id, language, signature]));
      return contextKeys.get(id);
    };
    const keyFor = (id, passage) => {
      const cached = passageKeys.get(passage);
      if (cached?.id === id) return cached.key;
      const key = JSON.stringify([contextKey(id), passage.text]); passageKeys.set(passage, { id, key }); return key;
    };
    const wasChecked = (id, passage) => {
      const key = keyFor(id, passage);
      if (cache.current.has(key)) { completed.add(key); if (id === chapterId) shown.add(key); }
      return id === chapterId ? shown.has(key) : completed.has(key);
    };
    const ignoredKey = contextKey(chapterId);
    const notice = (kind, message) => {
      if (disposed) return;
      const count = live().length, { checked, total } = progress;
      setStatus(previous => previous.kind === kind && previous.message === message && previous.count === count && previous.checked === checked && previous.total === total ?
        previous : { kind, message, count, checked, total });
    };
    function dismissed() {
      const saved = ignored.current.get(ignoredKey);
      return saved && saved.doc.eq(editor.state.doc) ? saved.hints : [];
    }
    function publish(hints) {
      if (disposed || editor.isDestroyed) return;
      const previous = live(), existing = new Map(previous.map(h => [hintKey(h), h])), hidden = new Set(dismissed().map(hintKey)), result = [];
      for (const hint of hints.sort((a, b) => a.from - b.from)) {
        const key = hintKey(hint);
        if (hidden.has(key) || (result.length && hint.from < result.at(-1).to)) continue;
        const retained = existing.get(key);
        result.push(retained?.reason === hint.reason ? retained : hint);
      }
      if (previous.length !== result.length || result.some((hint, i) => hint !== previous[i]))
        editor.view.dispatch(editor.state.tr.setMeta(aiGrammarKey, result).setMeta('addToHistory', false));
      setSelected(previous => previous ? result.find(item => item.id === previous.id) || null : null);
    }
    async function sources() {
      const doc = editor.state.doc, chapters = latest.current.chapters;
      if (sourceCache?.doc === doc && sourceCache.chapters === chapters) return sourceCache.all;
      const all = [{ id: chapterId, doc, passages: inlineGrammarPassages({ doc }) }];
      let yieldAt = performance.now() + 6;
      for (const chapter of chapters || []) {
        if (chapter.id === chapterId) continue;
        if (performance.now() >= yieldAt) {
          await new Promise(resolve => setTimeout(resolve, 0));
          if (disposed || editor.isDestroyed || latest.current.paused) return null;
          if (editor.state.doc !== doc || latest.current.chapters !== chapters) { schedule(0); return null; }
          yieldAt = performance.now() + 6;
        }
        const other = readParsedDocument(chapter.content, editor.schema);
        all.push({ id: chapter.id, doc: other, passages: inlineGrammarPassages({ doc: other }) });
      }
      sourceCache = { doc, chapters, all };
      return all;
    }
    function hintsFor(passage, findings) {
      if (!findings.length) return [];
      const saved = decoded.get(passage);
      if (saved?.findings === findings) return saved.hints;
      const hints = inlineGrammarFindings({ findings: findings.map(item => ({ ...item, passageId: passage.id })) }, passage);
      decoded.set(passage, { findings, hints });
      return hints;
    }
    function refresh(all) {
      if (all === refreshedSources && !resultsChanged) return;
      if (all !== refreshedSources) {
        const keys = new Set();
        for (const source of all) for (const passage of source.passages) keys.add(keyFor(source.id, passage));
        for (const key of completed) if (!keys.has(key)) completed.delete(key);
        for (const key of shown) if (!keys.has(key)) shown.delete(key);
      }
      if (paintedDoc !== all[0].doc || activeResultsChanged) {
        const checked = all[0].passages.filter(p => cache.current.has(keyFor(chapterId, p)));
        const hints = outsideCheckedPassages(live(), checked);
        for (const passage of checked) hints.push(...hintsFor(passage, cache.current.get(keyFor(chapterId, passage))));
        publish(hints);
        paintedDoc = all[0].doc; activeResultsChanged = false;
      }
      progress = { total: all.reduce((n, s) => n + s.passages.length, 0),
        checked: all.reduce((n, s) => n + s.passages.filter(p => wasChecked(s.id, p)).length, 0) };
      refreshedSources = all; resultsChanged = false;
    }
    function cancel() {
      clearTimeout(timer); timer = null; timerAt = 0;
      if (active) { const id = active.id; active = null; api.cancelInlineGrammar(id).catch(() => {}); }
    }
    function schedule(delay = 500) {
      if (disposed || !enabled || latest.current.paused) return;
      const when = Date.now() + delay;
      if (timer && timerAt <= when) return;
      clearTimeout(timer); timerAt = when; timer = setTimeout(pump, delay);
    }
    async function pump() {
      timer = null; timerAt = 0;
      if (disposed || editor.isDestroyed || preparing) return;
      if (latest.current.paused) { notice('paused'); return; }
      preparing = true;
      let all;
      try { all = await sources(); }
      catch (error) { notice('error', errorText(error)); return; }
      finally { preparing = false; }
      if (!all || disposed || editor.isDestroyed || latest.current.paused) return;
      refresh(all);
      if (active) { notice('checking'); return; }
      if (failures >= 3) { notice('error', 'AI grammar paused after repeated connection errors. Retry when your proofreading connection is ready.'); return; }
      if (Date.now() < nextAttempt) { schedule(nextAttempt - Date.now()); return; }
      const pending = all.filter(s => s.passages.some(p => !wasChecked(s.id, p)));
      const source = currentBatches >= 2 && pending.some(s => s.id !== chapterId) ? pending.find(s => s.id !== chapterId) : pending[0];
      if (!source) { notice(progress.total ? 'ready' : 'unsupported'); return; }
      // Prioritize the visible passage without postponing the rest of a pasted chapter.
      const candidates = source.passages.filter(p => !wasChecked(source.id, p));
      if (source.id === chapterId) {
        const caret = editor.state.selection.from;
        candidates.sort((a, b) => Number(b.from <= caret && b.to >= caret) - Number(a.from <= caret && a.to >= caret));
      }
      const passages = []; let size = 0;
      for (const p of candidates) {
        if (passages.length === 6 || size + p.text.length > 12000) break;
        passages.push(p); size += p.text.length;
      }
      if (editor.view.composing) { schedule(400); return; }
      const request = { id: crypto.randomUUID(), source, passages, mapping: new Mapping() }; active = request;
      currentBatches = source.id === chapterId ? currentBatches + 1 : 0;
      notice('checking');
      try {
        const result = await api.inlineGrammar({ id: request.id, projectId, scope: 'selection', language,
          passages: passages.map(p => ({ id: p.id, text: p.text })) });
        if (disposed || active !== request || editor.isDestroyed) return;
        if (result.skipped) { active = null; notice('waiting'); schedule(1200); return; }
        failures = 0; nextAttempt = 0;
        const accepted = [];
        for (const passage of passages) {
          const findings = (result.findings || []).filter(item => item.passageId === passage.id);
          cache.current.set(keyFor(source.id, passage), findings);
          completed.add(keyFor(source.id, passage));
          if (source.id === chapterId) shown.add(keyFor(source.id, passage));
          if (source.id === chapterId) {
            let hints = hintsFor(passage, findings);
            const mapped = { before: source.doc, doc: editor.state.doc, docChanged: source.doc !== editor.state.doc, mapping: request.mapping };
            hints = hints.map(h => mapGrammarHint(h, mapped)).filter(Boolean);
            accepted.push(...hints);
          }
        }
        // Enough space for large manuscripts, bounded across projects/sessions.
        while (cache.current.size > 10000) cache.current.delete(cache.current.keys().next().value);
        resultsChanged = true;
        if (source.id === chapterId) activeResultsChanged = true;
        if (accepted.length) publish([...accepted, ...live()]);
        if (sourceCache?.doc === editor.state.doc && sourceCache.chapters === latest.current.chapters) refresh(sourceCache.all);
        active = null; notice('waiting'); schedule(150);
      } catch (error) {
        if (disposed || active !== request) return;
        active = null; failures++; nextAttempt = Date.now() + 5000 * failures;
        notice('error', errorText(error)); if (failures < 3) schedule(nextAttempt - Date.now());
      }
    }
    function transaction({ transaction: tr }) {
      if (!tr.docChanged || disposed) return;
      const saved = ignored.current.get(ignoredKey);
      if (saved?.doc === tr.before) ignored.current.set(ignoredKey, { doc: tr.doc, hints: saved.hints.map(h => mapGrammarHint(h, tr)).filter(Boolean) });
      if (active?.source.id === chapterId) {
        // Keep only position maps, rather than every intermediate document.
        active.mapping.appendMapping(tr.mapping);
      }
      setSelected(previous => previous ? live().find(h => h.id === previous.id) || null : null);
      notice(active ? 'checking' : 'waiting'); schedule();
    }
    editor.on('transaction', transaction);
    runtime.current = {
      open(id) { const hint = live().find(item => item.id === id); if (hint) setSelected(hint); },
      review() { const hint = live()[0]; if (hint) { editor.commands.setTextSelection(hint.from); editor.commands.scrollIntoView(); setSelected(hint); } },
      retry() { failures = 0; nextAttempt = 0; schedule(0); },
      schedule,
      pause() { if (latest.current.paused) { cancel(); notice('paused'); } else schedule(100); },
      ignore(hint) {
        if (!live().includes(hint)) return;
        ignored.current.set(ignoredKey, { doc: editor.state.doc, hints: [...dismissed(), hint] });
        while (ignored.current.size > 200) ignored.current.delete(ignored.current.keys().next().value);
        publish(live().filter(item => item !== hint)); notice(active ? 'checking' : 'ready'); setSelected(null); editor.commands.focus();
      }
    };
    if (latest.current.paused) notice('paused'); else schedule(100);
    return () => {
      cancel(); disposed = true; runtime.current = null; editor.off('transaction', transaction);
      if (!editor.isDestroyed && live().length) editor.view.dispatch(editor.state.tr.setMeta(aiGrammarKey, []).setMeta('addToHistory', false));
    };
  }, [editor, api, enabled, projectId, chapterId, language, signature]);
  useEffect(() => { runtime.current?.pause(); }, [paused]);
  useEffect(() => { runtime.current?.schedule(); }, [chapters]);
  function actOnHint(hint, action) {
    if (!enabled || paused || !editor || editor.isDestroyed || !aiGrammarKey.getState(editor.state)?.hints.includes(hint)) {
      onNotice('This grammar hint is no longer available.'); return;
    }
    if (action === 'review') { setSelected(hint); return; }
    if (action !== 'apply') return;
    try {
      editor.view.dispatch(aiGrammarTransaction(editor.state, hint)); setSelected(null); editor.commands.focus();
    } catch (error) { onNotice(errorText(error)); setSelected(null); if (!editor.isDestroyed) editor.commands.focus(); }
  }
  return { enabled, available: enabled && !paused, status, selected, open: id => runtime.current?.open(id), review: () => runtime.current?.review(), retry: () => runtime.current?.retry(), ignore: () => runtime.current?.ignore(selected), close: () => { setSelected(null); if (editor && !editor.isDestroyed && !paused) editor.commands.focus(); }, apply: () => actOnHint(selected, 'apply'), actOnHint };
}
