import React, { useState } from 'react';

export default function Thesaurus({ Modal, api, initial, language, onClose }) {
  const [query, setQuery] = useState(initial || ''), [result, setResult] = useState(null), [busy, setBusy] = useState(false);
  async function search(event) { event.preventDefault(); setBusy(true); try { setResult(await api.thesaurus(query, language)); } catch { setResult({ available: false, senses: [] }); } finally { setBusy(false); } }
  return <Modal title="Local thesaurus" onClose={onClose}><form onSubmit={search}><label>Word or phrase<input className="field-input" autoFocus maxLength="120" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="secondary-button" disabled={busy || !query.trim()} title="Find synonyms in the local dictionary for this document’s language.">Look up</button></form>{result && (!result.available ? <p>No local thesaurus was found for this document language. English is included; German and Swedish can use installed LibreOffice dictionaries.</p> : !result.senses.length ? <p>No entries found.</p> : result.senses.map((sense, index) => <div key={index}><strong>{sense.meaning}</strong><p>{sense.words.join(', ')}</p></div>))}<p className="small-muted">English WordNet dictionary included. No text is sent online.</p></Modal>;
}
