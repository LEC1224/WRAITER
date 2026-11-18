import React, { useEffect, useMemo, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { mergeDisplay, mergeDrafts, sameValue } from './branch-merge.js';
import './branch-merge.css';

function MergePreview({ target, project, fields }) {
  const old = new Map(target.chapters.map(item => [item.id, item]));
  const present = new Set(project.chapters.map(item => item.id));
  return <section className="merge-result"><h3>Merged manuscript</h3>
    <ol>{project.chapters.map(item => {
      const earlier = old.get(item.id), changed = !sameValue(earlier, item);
      return <li key={item.id}>{changed ? <details><summary>{item.title} <small>{earlier ? 'Revised' : 'Added'}</small></summary><pre>{mergeDisplay(item.content)}</pre></details> : item.title}</li>;
    })}</ol>
    {target.chapters.filter(item => !present.has(item.id)).map(item => <p key={item.id}>Removed chapter · {item.title}</p>)}
    {fields.filter(key => key !== 'chapters').map(key => <details key={key}><summary>Changed {key}</summary><pre>{mergeDisplay(project[key])}</pre></details>)}
  </section>;
}
export default function BranchMergeDialog({ Modal, target, item, destination, prepare, onApply, onClose }) {
  const [context, setContext] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState({});
  useEffect(() => {
    let alive = true;
    prepare().then(result => { if (alive) setContext(result); }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [target, item.revision]);
  const normal = useMemo(() => context && mergeDrafts(context.base, target, context.source, choices), [context, target, choices]);
  const missing = normal?.conflicts.filter(conflict => !conflict.selected).length || 0;
  async function apply() {
    setBusy(true); setError('');
    try { await onApply(context, normal.project); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Merge into current draft" wide onClose={() => { if (!busy) onClose(); }} className="branch-merge-dialog">
    <div className="merge-endpoints"><span><small>Incoming version</small><strong>{item.title || item.message}</strong></span><GitMerge size={18}/><span><small>Current draft</small><strong>{destination || target.title}</strong></span></div>
    {error && <p className="ai-error" role="alert">{error}</p>}
    {!context && !error && <p role="status">Comparing both paths with their common checkpoint…</p>}
    {normal && <>
      {!!normal.conflicts.length && <section><h3>Conflicting changes</h3>
        {normal.conflicts.map((conflict, index) => <fieldset className="merge-conflict" key={conflict.id}>
          <legend>{conflict.label}</legend>
          {['current', 'incoming'].map(key => <label key={key}><span><input type="radio" name={'conflict-' + index} checked={choices[conflict.id] === key} onChange={() => setChoices(prev => ({ ...prev, [conflict.id]: key }))}/>{key === 'current' ? 'Keep current' : 'Use incoming'}</span><pre>{mergeDisplay(conflict[key])}</pre></label>)}
        </fieldset>)}
      </section>}
      <MergePreview target={target} project={normal.project} fields={normal.fields}/>
      {!normal.fields.length && !missing && <p className="small-muted">The text already matches your choices. Applying records the connection between these paths.</p>}
    </>}
    <div className="modal-footer">{missing > 0 && <small role="status">Choose a version for {missing} {missing === 1 ? 'conflict' : 'conflicts'}.</small>}
      <button className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="primary-button" disabled={!normal || Boolean(missing) || busy} onClick={apply}><GitMerge size={15}/>{busy ? 'Merging…' : 'Apply merge'}</button>
    </div>
  </Modal>;
}
