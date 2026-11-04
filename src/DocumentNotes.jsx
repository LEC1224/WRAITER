import React from 'react';
import { noteLocations } from './notes.js';
export default function DocumentNotes({ Modal, editor, chapterTitle, onInsert, onEdit, onClose }) {
  const notes = editor && !editor.isDestroyed ? noteLocations(editor.state.doc) : [];
  return <Modal title="Footnotes and endnotes" subtitle={`Notes in ${chapterTitle}`} onClose={onClose} className="document-notes-dialog">
    <p className="small-muted">Numbered references for explanations and sources. These are included in your published document.</p>
    <div className="note-add-actions"><button className="secondary-button" onClick={() => onInsert('footnote')} title="Add a numbered note at the cursor. Office files place footnotes at the bottom of the page.">Insert footnote…</button><button className="secondary-button" onClick={() => onInsert('endnote')} title="Add a numbered note at the cursor. Endnotes are collected at the end of the document.">Insert endnote…</button></div>
    {!notes.length && <p className="review-empty">No document notes in this chapter yet.</p>}
    <div className="document-note-list">{notes.map(note => <button className="document-note-item" key={note.pos} onClick={() => onEdit(note.pos)}><strong>{note.kind === 'endnote' ? 'Endnote' : 'Footnote'} {note.number}</strong><span>{note.text}</span><small>Read or edit →</small></button>)}</div>
  </Modal>;
}
