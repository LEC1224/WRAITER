import React, { useState } from 'react';
import { documentGrammar } from './local-grammar.js';
import { suggestText, trackModeKey } from './tracked-editor.js';
export default function LocalGrammarDialog({ Modal, editor, language, onClose }) {
  const [version, refresh] = useState(0), [error, setError] = useState('');
  const doc = editor && !editor.isDestroyed ? editor.state.doc : null;
  const hints = doc ? documentGrammar(doc, language) : [];
  function apply(hint) {
    if (!editor || editor.isDestroyed || editor.state.doc !== doc) { setError('The passage changed. Reopen the grammar review.'); return; }
    if (trackModeKey.getState(editor.state)) {
      const suggestion = suggestText(editor.state, hint.from, hint.to, hint.replacement);
      if (!suggestion) { setError('This passage already contains a tracked change. Review it before making another correction.'); return; }
      editor.view.dispatch(suggestion); onClose(); return;
    }
    const tr = editor.state.tr, marks = [...(doc.nodeAt(hint.from)?.marks || [])];
    doc.nodesBetween(hint.from, hint.to, node => { for (const mark of node.marks) if (mark.type.name === 'commentAnchor' && !marks.some(existing => existing.eq(mark))) marks.push(mark); });
    tr.replaceWith(hint.from, hint.to, editor.schema.text(hint.replacement, marks));
    editor.view.dispatch(tr); refresh(version + 1);
  }
  return <Modal title="Local grammar review" onClose={onClose}><p className="small-muted">English checks for repeated words, indefinite articles and common auxiliary expressions. These are suggestions; intentional phrasing can stay.</p>{!hints.length && <p>{/^en(?:-|$)/i.test(language) ? 'No local grammar hints in this chapter.' : 'Local grammar hints currently support English.'}</p>}{hints.slice(0, 100).map(hint => <div className="reference-card" key={`${hint.from}:${hint.to}`}><p><del>{hint.original}</del> → <ins>{hint.replacement}</ins></p><p>{hint.reason}</p><button type="button" className="secondary-button" onClick={() => apply(hint)} title="Apply this local grammar correction to the marked text. You can undo it.">Apply suggestion</button></div>)}{error && <p role="alert">{error}</p>}</Modal>;
}
