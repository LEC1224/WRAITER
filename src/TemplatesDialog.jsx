import React, { useState } from 'react';
import { templateFromProject, projectFromTemplate, readTemplates, writeTemplates } from './templates.js';

export default function TemplatesDialog({ Modal, project, onCreate, onClose }) {
  const [templates, setTemplates] = useState(() => { try { return readTemplates(); } catch { return null; } });
  const [name, setName] = useState(''), [error, setError] = useState(templates ? '' : 'Saved templates could not be read. Their data has not been changed.');
  function save(event) {
    event.preventDefault();
    try { const next = [...templates, templateFromProject(project, name)]; writeTemplates(next); setTemplates(next); setName(''); setError(''); }
    catch (reason) { setError(reason.message); }
  }
  function remove(id) {
    try { const next = templates.filter(item => item.id !== id); writeTemplates(next); setTemplates(next); setError(''); }
    catch (reason) { setError(reason.message); }
  }
  async function use(template) {
    try { await onCreate(projectFromTemplate(template)); }
    catch (reason) { setError(reason.message); }
  }
  return <Modal title="Document templates" onClose={onClose} wide>
    <p className="small-muted">Save a reusable local copy of this manuscript’s chapter text and formatting. Private notes, comments, bookmarks, references, chats and history are excluded. Images and manuscript text are included.</p>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={save}><label className="field-label">TEMPLATE NAME<input className="field-input" aria-label="Template name" maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><button className="secondary-button" disabled={!templates || !name.trim()} title="Save a reusable local copy of the manuscript’s text, images and formatting.">Save current manuscript as template</button></form>
    <h3>Saved templates</h3>{templates?.length ? templates.map(item => <div key={item.id} className="bookmark-row"><button onClick={() => use(item)} title="Create a new manuscript from this template.">{item.name}<small>{item.chapters.length} chapter{item.chapters.length === 1 ? '' : 's'}</small></button><button onClick={() => remove(item.id)} aria-label={`Delete template ${item.name}`} title="Delete this saved template; manuscripts already created from it stay intact.">×</button></div>) : <p className="small-muted">No saved templates.</p>}
    <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Close</button></div>
  </Modal>;
}
