import React, { useEffect, useState } from 'react';
import { languageName } from './languages.js';
import { personalDictionary, subscribeDictionary, addPersonalWord, updatePersonalWord, removePersonalWord } from './offline-grammar-client.js';
import { loadGrammarExceptions, subscribeGrammarExceptions, addGrammarException, updateGrammarException, removeGrammarException } from './personal-grammar-exceptions.js';
import './personal-dictionary.css';

function visibleText(text) {
  return text.trim() ? text : JSON.stringify(text);
}

function describeException(entry) {
  const original = visibleText(entry.original);
  if (entry.replacement === null) return original + ' — ' + entry.reason;
  if (entry.replacement === '') return 'Delete “' + original + '”';
  return original + ' → ' + visibleText(entry.replacement);
}

function kindOf(entry) {
  if (!entry) return 'replace';
  if (entry.replacement === null) return 'review';
  return entry.replacement === '' ? 'delete' : 'replace';
}

function EntryForm({ words, entry, defaultLanguage, pending, onSave, onCancel }) {
  const [original, setOriginal] = useState(words ? entry || '' : entry?.original || '');
  const [language, setLanguage] = useState(entry?.language || defaultLanguage);
  const [kind, setKind] = useState(kindOf(words ? null : entry));
  const [replacement, setReplacement] = useState(entry?.replacement || '');
  const [rule, setRule] = useState(entry?.rule || '');
  const [reason, setReason] = useState(entry?.reason || '');
  const valid = words ? !!original.trim() : !!original && (kind === 'delete' ||
    (kind === 'replace' ? !!replacement && replacement !== original : !!rule.trim() && !!reason.trim()));
  function submit(event) {
    event.preventDefault();
    if (words) return onSave(original.trim());
    const value = kind === 'replace' ? replacement : kind === 'delete' ? '' : null;
    return onSave({
      category: 'grammar', original, language, replacement: value,
      rule: rule || 'personal', reason: reason || 'Personal grammar exception.'
    });
  }
  return <form className="dictionary-form" onSubmit={submit}>
    <label>{words ? 'Word' : 'Flagged text'}
      <input autoFocus required maxLength={words ? 100 : 3500} className="field-input"
        value={original} onChange={e => setOriginal(e.target.value)} />
    </label>
    {!words && <>
      <div className="dictionary-fields">
        <label>Language<select aria-label="Language" className="field-input" value={language} onChange={e => setLanguage(e.target.value)}>
          <option value="en">English</option><option value="sv">Swedish</option>
        </select></label>
        <label>Suggestion type<select aria-label="Suggestion type" className="field-input" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="replace">Replace text</option><option value="delete">Delete text</option>
          <option value="review">Review wording</option>
        </select></label>
      </div>
      {kind === 'replace' && <label>Suggested replacement
        <input className="field-input" required maxLength={3500} value={replacement} onChange={e => setReplacement(e.target.value)} />
      </label>}
      {kind === 'review' && <>
        <label>Checker rule<input className="field-input" required maxLength={256} value={rule} onChange={e => setRule(e.target.value)} /></label>
        <label>Suggestion message<input className="field-input" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <p className="small-muted">Saving an exception directly from a suggestion fills in its rule and message.</p>
      </>}
    </>}
    <div className="dictionary-actions">
      <button type="submit" className="primary-button" disabled={pending || !valid}>Save entry</button>
      <button type="button" className="secondary-button" disabled={pending} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

export default function PersonalDictionary({ Modal, onClose, language = 'en' }) {
  const [section, setSection] = useState('Words');
  const words = section === 'Words';
  const [entries, setEntries] = useState(null);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let revision = 0;
    function refresh() {
      const current = ++revision;
      const read = words ? personalDictionary() : loadGrammarExceptions();
      read.then(result => {
        if (current !== revision) return;
        setEntries([...result].sort((a, b) => words ? a.localeCompare(b) :
          a.original.localeCompare(b.original) || a.language.localeCompare(b.language)));
      }).catch(() => {
        if (current === revision) setError('Could not load the personal dictionary.');
      });
    }
    const unsubscribe = (words ? subscribeDictionary : subscribeGrammarExceptions)(refresh);
    refresh();
    return () => { revision++; unsubscribe(); };
  }, [words]);

  function selectSection(name) {
    if (section === name) return;
    setEntries(null); setQuery(''); setForm(null); setError(''); setSection(name);
  }
  async function change(operation) {
    setPending(true); setError('');
    try { await operation(); setForm(null); }
    catch (err) { setError(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setPending(false); }
  }
  function save(value) {
    return change(() => {
      if (words) return form.entry ? updatePersonalWord(form.entry, value) : addPersonalWord(value);
      return form.entry ? updateGrammarException(form.entry, value) : addGrammarException(value.language, value);
    });
  }
  const filter = query.trim().toLowerCase();
  const filtered = entries?.filter(entry => !filter || (words ? entry : describeException(entry) + ' ' + languageName(entry.language)).toLowerCase().includes(filter));
  return <Modal title="Personal dictionary" onClose={onClose} wide>
    <div className="settings-tabs" role="tablist" aria-label="Dictionary entries">
      {['Words', 'Grammar exceptions'].map(name => <button key={name} type="button" role="tab"
        aria-selected={name === section} className={name === section ? 'selected' : ''} disabled={pending}
        onClick={() => selectSection(name)}>{name}</button>)}
    </div>
    <div className="settings-content" role="tabpanel" aria-label={section}>
      <p className="small-muted">{words ? 'These words are accepted by the spelling checker in all documents.' :
        'The local grammar checker skips these suggestions in all documents in the selected language.'}</p>
      {error && <p role="alert">{error}</p>}
      {form ? <EntryForm words={words} entry={form.entry} defaultLanguage={/^sv\b/i.test(language) ? 'sv' : 'en'} pending={pending} onSave={save} onCancel={() => { setForm(null); setError(''); }} /> : <>
        <div className="dictionary-actions">
          <input type="search" className="field-input" aria-label={'Search ' + section.toLowerCase()}
            placeholder={'Search ' + section.toLowerCase()} value={query} onChange={e => setQuery(e.target.value)} />
          <button type="button" className="primary-button" disabled={pending} onClick={() => { setForm({}); setError(''); }}>
            {words ? 'Add word' : 'Add exception'}
          </button>
        </div>
        {entries === null && !error && <p role="status">Loading…</p>}
        {filtered?.length === 0 && <p className="small-muted">{filter ? 'No matching entries.' : words ? 'No saved words.' : 'No saved grammar exceptions.'}</p>}
        {!!filtered?.length && <ul className="dictionary-list">{filtered.map(entry => {
          const label = words ? entry : describeException(entry);
          const target = words ? 'word ' + entry : 'exception for ' + label + ' (' + languageName(entry.language) + ')';
          return <li key={words ? entry : entry.language + entry.key}>
            <span>{label}{!words && <small>{languageName(entry.language)}</small>}</span>
            <button type="button" className="secondary-button" disabled={pending} aria-label={'Edit ' + target}
              onClick={() => { setForm({ entry }); setError(''); }}>Edit</button>
            <button type="button" className="danger-button subtle" disabled={pending} aria-label={'Delete ' + target}
              onClick={() => change(() => words ? removePersonalWord(entry) : removeGrammarException(entry))}>Delete</button>
          </li>;
        })}</ul>}
      </>}
    </div>
  </Modal>;
}
