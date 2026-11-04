import React from 'react';
import { changeCaseTransaction } from './change-case.js';

export default function CaseMenu({ editor, disabled, onError }) {
  function apply(event) {
    const mode = event.target.value;
    event.target.value = '';
    if (!mode || !editor || editor.isDestroyed) return;
    try {
      const transaction = changeCaseTransaction(editor.state, mode);
      if (transaction) editor.view.dispatch(transaction);
      editor.commands.focus();
    } catch (error) { onError(error.message); }
  }
  return <select className="paragraph-style-select" aria-label="Change selected text case" value="" disabled={disabled || !editor || editor.state.selection.empty} onChange={apply} title="Select text, then change its capitalisation without retyping it.">
    <option value="">Change case</option><option value="upper">UPPERCASE</option><option value="lower">lowercase</option><option value="title">Title Case</option><option value="sentence">Sentence case</option>
  </select>;
}
