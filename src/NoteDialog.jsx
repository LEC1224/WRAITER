import React, { useState } from 'react';

export default function NoteDialog({ Modal, target, onApply, onDelete, onClose }) {
  const [error, setError] = useState(''), [kind, setKind] = useState(target.kind);
  const editing = !!target.node;
  return <Modal title={editing ? `Edit ${target.kind}${target.number ? ' ' + target.number : ''}` : `Insert ${kind}`} subtitle={editing ? 'The numbered marker stays linked to this note.' : 'A numbered reference will be added at your cursor, after any selected words.'} onClose={onClose} className="note-dialog"><form onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (onApply({ kind, text: String(data.get('text') || '') }) === false) setError('The manuscript changed. Reopen this note to edit its current version.');
  }}>
    <label className="field-label">Note placement<select aria-label="Note type" className="field-input" value={kind} onChange={event => setKind(event.target.value)}><option value="footnote">Footnote — bottom of the page</option><option value="endnote">Endnote — end of the document</option></select></label>
    <p className="small-muted">Word and LibreOffice place these automatically. PDF and EPUB currently collect both types in a notes section.</p>
    <label className="field-label">Note text<textarea aria-label="Note text" className="field-input" name="text" defaultValue={target.text} placeholder="Write the explanation or source the reader will see…" rows={6} data-initial-focus required maxLength="100000" /></label>
    <p className="small-muted">Notes are part of the published document. Click a numbered marker to read or edit it.</p>
    {error && <p role="alert">{error}</p>}
    <div className="modal-footer">{editing && <button type="button" className="text-button note-delete" onClick={() => { if (onDelete() === false) setError('The manuscript changed. Reopen this note before deleting it.'); }} title="Remove this note and its numbered marker from the document.">Delete note</button>}<button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">{editing ? 'Save note' : 'Insert note'}</button></div>
  </form></Modal>;
}
