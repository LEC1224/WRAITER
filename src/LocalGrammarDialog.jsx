import React, { useEffect, useState } from 'react';
import { grammarKey } from './local-grammar.js';
import { grammarCorrectionTransaction } from './ai-grammar.js';
import { addPersonalWord } from './offline-grammar-client.js';
import { addGrammarException } from './personal-grammar-exceptions.js';

export default function LocalGrammarDialog({ Modal, editor, language, onClose }) {
  const [, refresh] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const changed = () => refresh(version => version + 1);
    editor.on('transaction', changed);
    editor.view.dispatch(editor.state.tr.setMeta(grammarKey, { review: true, language }).setMeta('addToHistory', false));
    return () => {
      editor.off('transaction', changed);
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(grammarKey, { review: false }).setMeta('addToHistory', false));
    };
  }, [editor, language]);
  const doc = editor && !editor.isDestroyed ? editor.state.doc : null;
  const checker = doc ? grammarKey.getState(editor.state) : null;
  const hints = checker?.allHints || [];
  const english = /^en(?:-|$)/i.test(language), swedish = /^sv(?:-|$)/i.test(language);
  function apply(hint, replacement) {
    if (!editor || editor.isDestroyed || editor.state.doc !== doc || !grammarKey.getState(editor.state)?.allHints.some(item => item.id === hint.id && item.original === hint.original)) { setError('The passage changed. Wait for a fresh check.'); return; }
    try { editor.view.dispatch(grammarCorrectionTransaction(editor.state, { ...hint, replacement })); setError(''); }
    catch (problem) { setError(problem.message); }
  }
  async function addWord(hint) {
    try { await addPersonalWord(hint.original); setError(''); }
    catch (problem) { setError(problem.message); }
  }
  async function saveException(hint) {
    const state = editor && !editor.isDestroyed ? editor.state : null;
    const current = state && grammarKey.getState(state);
    if (state?.doc !== doc || current?.language !== language || !current.allHints.includes(hint)) {
      setError('The suggestion changed. Wait for a fresh check.');
      return;
    }
    try { await addGrammarException(language, hint); setError(''); }
    catch (problem) { setError(problem.message); }
  }
  function ignore(hint, all) {
    if (!editor || editor.isDestroyed || editor.state.doc !== doc) { setError('The passage changed. Wait for a fresh check.'); return; }
    editor.view.dispatch(editor.state.tr.setMeta(grammarKey, { ignore: { ...hint, all } }).setMeta('addToHistory', false));
  }
  return <Modal title="Local grammar review" onClose={onClose}>
    <p className="small-muted">{english ? 'English spelling and grammar are checked on this computer.' : swedish ? 'Swedish grammar is checked on this computer. Swedish spelling appears in the editor’s native spelling menu.' : 'Local grammar review supports English and Swedish.'} Suggestions can be mistaken, and intentional wording can stay.</p>
    {checker?.status === 'checking' && <p role="status">Checking this chapter locally…</p>}
    {checker?.status === 'error' && <p role="alert">The expanded offline checker could not start: {checker.error}. Basic local grammar checks remain available.</p>}
    {checker?.status === 'degraded' && <p role="alert">Some additional offline grammar rules are unavailable: {checker.error}. The other local checks remain available.</p>}
    {!hints.length && checker?.status !== 'checking' && <p>{english || swedish ? 'No local spelling or grammar hints in this chapter.' : 'Local grammar review currently supports English and Swedish.'}</p>}
    {hints.slice(0, 100).map(hint => {
      const alternatives = hint.alternatives || (typeof hint.replacement === 'string' ? [hint.replacement] : []);
      return <div className="reference-card" key={hint.id}>
        <p><strong>{hint.category === 'spelling' ? 'Spelling' : 'Grammar'}:</strong> <del>{hint.original}</del>{alternatives.length > 0 && <> → <ins>{alternatives[0] || 'Remove'}</ins></>}</p>
        <p>{hint.reason}</p>
        {alternatives.map((replacement, index) => <button key={`${index}:${replacement}`} type="button" className="secondary-button" onClick={() => apply(hint, replacement)} title="Apply this local correction to the marked text. You can undo it.">{index ? `Apply alternative: ${replacement || 'Remove'}` : 'Apply suggestion'}</button>)}
        {hint.category === 'spelling' && /^\p{L}+(?:[’'-]\p{L}+)*$/u.test(hint.original) && hint.original.length <= 100 && <button type="button" className="secondary-button" onClick={() => addWord(hint)}>Add to personal dictionary</button>}
        <button type="button" className="secondary-button" onClick={() => ignore(hint, false)}>Ignore this suggestion</button>
        <button type="button" className="secondary-button" onClick={() => ignore(hint, true)}>Ignore matching suggestions in this chapter</button>
        {hint.category === 'grammar' && <button type="button" className="secondary-button" onClick={() => saveException(hint)}>Add grammar exception to personal dictionary</button>}
      </div>;
    })}
    {hints.length > 100 && <p className="small-muted">Showing the first 100 suggestions in this chapter.</p>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
