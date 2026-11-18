import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GitMerge, Sparkles } from 'lucide-react';
import { mergeDisplay, mergeDrafts, sameValue } from './branch-merge.js';
import { incomingWriting, integrateWriting } from '../electron/story-merge.mjs';
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
function Placement({ plan, candidate, target, update }) {
  const chapter = target.chapters.find(item => item.id === plan.targetId);
  const blocks = chapter?.content.content || [];
  function changeLocation(kind, id) {
    const selected = target.chapters.find(item => item.id === id) || target.chapters[0];
    update({ kind, targetId: kind === 'passage' ? selected.id : id, afterBlock: kind === 'passage' ? Math.min(plan.afterBlock, selected.content.content.length) : 0 });
  }
  return <section className="story-placement"><h3>{candidate.title}</h3>
    <p>{plan.reason}</p>
    <div className="story-position"><label>Insert as<select className="field-input" value={plan.kind} onChange={event => changeLocation(event.target.value, plan.targetId)}><option value="chapter">New chapter</option><option value="passage">Passage in a chapter</option></select></label>
      <label>{plan.kind === 'chapter' ? 'After chapter' : 'Chapter'}<select className="field-input" value={plan.targetId ?? ''} onChange={event => changeLocation(plan.kind, event.target.value || null)}>
        {plan.kind === 'chapter' && <option value="">Start of manuscript</option>}
        {target.chapters.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title}</option>)}
      </select></label>
      {plan.kind === 'passage' && (blocks.length <= 300 ? <label>Insert after<select className="field-input" value={plan.afterBlock} onChange={event => update({ afterBlock: Number(event.target.value) })}>
        <option value="0">Beginning of chapter</option>{blocks.map((block, i) => <option key={i} value={i + 1}>{i + 1}. {mergeDisplay(block).slice(0, 90) || 'Empty paragraph'}</option>)}
      </select></label> : <label>After paragraph or block<input className="field-input" type="number" min="0" max={blocks.length} value={plan.afterBlock} onChange={event => update({ afterBlock: Math.max(0, Math.min(blocks.length, Math.trunc(Number(event.target.value)) || 0)) })}/></label>)}
    </div>
    {plan.kind === 'passage' && blocks.length > 300 && <p className="small-muted">{plan.afterBlock ? 'Insert after “' + mergeDisplay(blocks[plan.afterBlock - 1]).slice(0, 180) + '”' : 'Insert at the start of this chapter.'}</p>}
    <h4>Continuity</h4><p>{plan.continuity}</p>
    {plan.edits.map((edit, index) => <label className="story-adaptation" key={index}><input type="checkbox" checked={edit.enabled !== false} onChange={event => update({ edits: plan.edits.map((old, i) => i === index ? { ...old, enabled: event.target.checked } : old) })}/>
      <span><strong>{edit.reason}</strong><del>{edit.before}</del><ins>{edit.after || '(remove this wording)'}</ins></span>
    </label>)}
  </section>;
}
export default function BranchMergeDialog({ Modal, target, item, tabId, destination, aiEnabled, prepare, onApply, onClose }) {
  const [context, setContext] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState({});
  const [mode, setMode] = useState('normal'), [advice, setAdvice] = useState(null), [advising, setAdvising] = useState(false);
  const request = useRef(null);
  const allocate = useMemo(() => {
    const ids = new Map();
    return (type, id) => { const key = type + ':' + id; if (!ids.has(key)) ids.set(key, crypto.randomUUID()); return ids.get(key); };
  }, [target]);
  function stopAdvice() {
    const id = request.current;
    request.current = null;
    if (id) window.wraiter.cancelGitMergeAdvice(id).catch(() => {});
  }
  useEffect(() => () => stopAdvice(), []);
  useEffect(() => {
    let alive = true;
    prepare().then(result => { if (alive) setContext(result); }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [target, item.revision]);
  const normal = useMemo(() => mode === 'normal' && context ? mergeDrafts(context.base, target, context.source, choices) : null, [context, target, choices, mode]);
  const candidates = useMemo(() => mode === 'story' && context ? incomingWriting(context.base, target, context.source) : [], [context, target, mode]);
  const story = useMemo(() => {
    if (mode !== 'story' || !advice) return null;
    try { return { project: integrateWriting(target, context.source, candidates, advice.placements, allocate) }; }
    catch (err) { return { error: err.message }; }
  }, [mode, advice, context, candidates, target, allocate]);
  async function suggest() {
    const id = 'story-merge-' + crypto.randomUUID(); request.current = id;
    setAdvising(true); setError('');
    try {
      const { base, source, ...expected } = context;
      const result = await window.wraiter.adviseGitMerge(tabId, target.id, expected, id);
      if (request.current === id) setAdvice(result);
    } catch (err) { if (request.current === id) setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { if (request.current === id) { setAdvising(false); request.current = null; } }
  }
  const missing = normal?.conflicts.filter(conflict => !conflict.selected).length || 0;
  async function apply() {
    setBusy(true); setError('');
    try { await onApply(context, (normal || story).project); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Merge into current draft" wide onClose={() => { if (!busy) onClose(); }} className="branch-merge-dialog">
    <div className="merge-endpoints"><span><small>Incoming version</small><strong>{item.title || item.message}</strong></span><GitMerge size={18}/><span><small>Current draft</small><strong>{destination || target.title}</strong></span></div>
    <div className="history-tabs" role="tablist" aria-label="Merge method">
      {[['normal', 'Normal merge'], ['story', 'AI-assisted merge']].map(([key, title]) => <button key={key} role="tab" aria-selected={mode === key} disabled={busy || !context} onClick={() => { if (key !== mode) { stopAdvice(); setAdvising(false); setMode(key); setError(''); } }}>{title}</button>)}
    </div>
    {error && <p className="ai-error" role="alert">{error}</p>}
    {!context && !error && <p role="status">Comparing both paths with their common checkpoint…</p>}
    {mode === 'story' && context && <>
      <p className="small-muted">Place new and revised passages in the current draft. Review the suggested chronology and choose which wording changes to apply.</p>
      {!candidates.length ? <p>This version has no new or revised passages to place. Normal merge includes other changes.</p> : !aiEnabled ? <p>Enable AI writing assistance in Settings → Connections to suggest placements.</p> : !advice && <button className="secondary-button" disabled={advising} onClick={suggest}><Sparkles size={15}/>{advising ? 'Reading both paths…' : 'Suggest placement and edits'}</button>}
      {advice && <>
        {advice.chapterCount < target.chapters.length && <p className="small-muted">Suggestions use excerpts from {advice.chapterCount} of {target.chapters.length} chapters per request.</p>}
        {advice.placements.map(plan => <Placement key={plan.id} plan={plan} candidate={candidates.find(item => item.id === plan.id)} target={target} update={patch => setAdvice(old => ({ ...old, placements: old.placements.map(item => item.id === plan.id ? { ...item, ...patch } : item) }))}/>)}
        {story?.error && <p role="alert">{story.error}</p>}
        {story?.project && <MergePreview target={target} project={story.project} fields={[]}/>}
      </>}
    </>}
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
      <button className="primary-button" disabled={(!normal && !story?.project) || Boolean(missing) || busy} onClick={apply}><GitMerge size={15}/>{busy ? 'Merging…' : 'Apply merge'}</button>
    </div>
  </Modal>;
}
