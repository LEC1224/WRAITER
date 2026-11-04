import { useEffect, useRef, useState } from 'react';
import { aiGrammarKey, inlineGrammarPassage, inlineGrammarFindings, aiGrammarTransaction } from './ai-grammar.js';

const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export default function useInlineGrammar({ editor, api, prefs, projectId, chapterId, language, paused, onNotice }) {
  const [status, setStatus] = useState({ kind: 'idle', count: 0 }), [selected, setSelected] = useState(null);
  const runtime = useRef(null), cache = useRef(new Map());
  const signature = JSON.stringify([prefs.provider, prefs.baseUrl, prefs.model, prefs.codexPath, prefs.claudePath, prefs.taskProfiles?.proofread]);
  const enabled = !!prefs.aiGrammar && !!prefs.enabled;
  useEffect(() => {
    if (!editor || editor.isDestroyed || !api) return;
    let timer, active, generation = 0, disposed = false, failures = 0, currentKey = '', displayedKey = '';
    const publish = (hints, key = '') => {
      if (disposed || editor.isDestroyed) return;
      displayedKey = key; editor.view.dispatch(editor.state.tr.setMeta(aiGrammarKey, hints).setMeta('addToHistory', false));
    };
    const cancel = () => { clearTimeout(timer); timer = null; generation++; if (active) { api.cancelInlineGrammar(active).catch(() => {}); active = null; } };
    const set = next => { if (!disposed) setStatus(next); };
    async function check(passage, key, version) {
      if (disposed || version !== generation || editor.isDestroyed || editor.view.composing || !editor.isFocused) return;
      const source = editor.state.doc, id = crypto.randomUUID(); active = id;
      set({ kind: 'checking', count: 0 });
      try {
        const result = await api.inlineGrammar({ id, projectId, scope: 'selection', language, passages: [{ id: passage.id, chapterTitle: '', paragraph: 1, text: passage.text }] });
        if (disposed || version !== generation || editor.isDestroyed || source !== editor.state.doc) return;
        active = null;
        if (result.skipped) { set({ kind: 'waiting', count: 0 }); timer = setTimeout(() => { timer = null; currentKey = ''; schedule(); }, 10000); return; }
        failures = 0; cache.current.set(key, result);
        while (cache.current.size > 40) cache.current.delete(cache.current.keys().next().value);
        const hints = inlineGrammarFindings(result, passage); publish(hints, key); set({ kind: 'ready', count: hints.length });
      } catch (error) {
        if (disposed || version !== generation) return;
        active = null; failures++;
        set({ kind: 'error', count: 0, message: errorText(error) });
        // Retry once after a pause, then wait for a new edit/focus or Retry.
        if (failures < 2) timer = setTimeout(() => { timer = null; currentKey = ''; schedule(); }, 30000);
      }
    }
    function schedule(event) {
      if (event?.transaction && !event.transaction.docChanged && !event.transaction.selectionSet) return;
      if (disposed || editor.isDestroyed) return;
      // Native spelling may select a word; Undo can restore that selection
      // in a fresh editor. A selection may reuse a cached paragraph only.
      const { empty } = editor.state.selection, passage = inlineGrammarPassage(editor.state, { forCache: true });
      const key = passage ? JSON.stringify([projectId, chapterId, language, signature, passage.from, passage.text]) : '';
      if (key && key === currentKey && !event?.transaction?.docChanged && (displayedKey === key || (empty && (active || timer)))) return;
      cancel(); currentKey = key; setSelected(null); publish([]);
      if (!enabled || paused || !editor.isFocused) { set({ kind: paused ? 'paused' : 'idle', count: 0 }); return; }
      const cached = cache.current.get(key);
      if (!passage || (!empty && !cached)) { set({ kind: 'unsupported', count: 0 }); return; }
      if (cached) { const hints = inlineGrammarFindings(cached, passage); publish(hints, key); set({ kind: 'ready', count: hints.length }); return; }
      const version = generation; set({ kind: 'waiting', count: 0 });
      timer = setTimeout(() => { timer = null; check(passage, key, version); }, 3000);
    }
    function blur() { const pending = !!active || !!timer; cancel(); if (pending) set({ kind: 'idle', count: 0 }); }
    editor.on('transaction', schedule); editor.on('focus', schedule); editor.on('blur', blur);
    runtime.current = {
      open(id) { const hint = aiGrammarKey.getState(editor.state)?.hints.find(item => item.id === id); if (hint) setSelected(hint); },
      review() { const hint = aiGrammarKey.getState(editor.state)?.hints[0]; if (hint) setSelected(hint); },
      retry() { failures = 0; currentKey = ''; editor.commands.focus(); timer = setTimeout(schedule, 100); },
      ignore(hint) {
        const live = aiGrammarKey.getState(editor.state)?.hints;
        if (!live?.includes(hint)) return;
        const hints = live.filter(item => item !== hint);
        // Remember dismissal for this unchanged paragraph during this session.
        const cached = cache.current.get(currentKey), start = editor.state.doc.resolve(hint.from).start();
        if (cached) cache.current.set(currentKey, { findings: cached.findings.filter(item => start + item.start !== hint.from || start + item.end !== hint.to) });
        publish(hints, currentKey); set({ kind: 'ready', count: hints.length }); setSelected(null); if (!editor.isDestroyed) editor.commands.focus();
      }
    };
    schedule();
    return () => { cancel(); disposed = true; runtime.current = null; editor.off('transaction', schedule); editor.off('focus', schedule); editor.off('blur', blur); if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(aiGrammarKey, []).setMeta('addToHistory', false)); };
  }, [editor, api, enabled, paused, projectId, chapterId, language, signature]);
  function actOnHint(hint, action) {
    if (!enabled || paused || !editor || editor.isDestroyed || !aiGrammarKey.getState(editor.state)?.hints.includes(hint)) {
      onNotice('This grammar hint is no longer available.'); return;
    }
    if (action === 'review') { setSelected(hint); return; }
    if (action !== 'apply') return;
    try {
      editor.view.dispatch(aiGrammarTransaction(editor.state, hint)); setSelected(null); editor.commands.focus();
    } catch (error) { onNotice(errorText(error)); setSelected(null); if (editor && !editor.isDestroyed && !paused) editor.commands.focus(); }
  }
  return { enabled, available: enabled && !paused, status, selected, open: id => runtime.current?.open(id), review: () => runtime.current?.review(), retry: () => runtime.current?.retry(), ignore: () => runtime.current?.ignore(selected), close: () => { setSelected(null); if (editor && !editor.isDestroyed && !paused) editor.commands.focus(); }, apply: () => actOnHint(selected, 'apply'), actOnHint };
}
