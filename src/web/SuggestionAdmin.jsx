import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { request } from './api.js';
import SuggestionModal from './SuggestionModal.jsx';
import './suggestions.css';

const states = { pending:'Awaiting review', queued:'Waiting for developer PC', delivering:'Opening Codex chat', sent:'Sent to Codex', failed:'Delivery failed', declined:'Declined' };
function Review({ action, item, models, onClose, onUpdated }) {
  const initialModel = models.find(m => m.isDefault) || models[0];
  const [modelId, setModel] = useState(initialModel?.id || ''), [effort, setEffort] = useState(initialModel?.defaultEffort || ''), [tier, setTier] = useState('');
  const [value, setValue] = useState(action === 'edit' ? item.prompt : ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const choice = models.find(m => m.id === modelId);
  useEffect(() => {
    if (!choice && initialModel) { setModel(initialModel.id); setEffort(initialModel.defaultEffort); setTier(''); }
  }, [choice,initialModel]);
  const title = { approve:'Send suggestion to Codex', edit:'Edit suggestion prompt', decline:'Decline suggestion', retry:'Retry Codex delivery' }[action];
  const submitLabel = { approve:'Send to Codex', edit:'Save changes', decline:'Decline and email', retry:'Retry delivery' }[action];
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    const body = { revision:item.revision, ...(action === 'edit' && { prompt:value }), ...(action === 'decline' && { motivation:value }), ...(action === 'approve' && { model:modelId, effort, tier }) };
    try { await request(`/api/admin/suggestions/${item.id}/${action}`, { method:'POST', body }); onUpdated(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return <SuggestionModal title={title} onClose={() => { if (!busy) onClose(); }}>
    <form className="suggestion-form" onSubmit={submit}>
      {action === 'approve' && <>
        <label>Model<select className="field-input" required value={modelId} onChange={e => { const next = models.find(m => m.id === e.target.value); setModel(next.id); setEffort(next.defaultEffort); setTier(''); }}>{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        {choice ? <>
          <label>Reasoning<select className="field-input" value={effort} onChange={e => setEffort(e.target.value)}>{(choice.efforts.length ? choice.efforts : ['']).map(level => <option key={level} value={level}>{level || 'Model default'}</option>)}</select></label>
          <label>Speed<select className="field-input" value={tier} onChange={e => setTier(e.target.value)}><option value="">Standard</option>{choice.tiers.map(id => <option value={id} key={id}>{id === 'priority' || id === 'fast' ? 'Fast' : id}</option>)}</select></label>
        </> : <p role="status">The developer PC must connect once to provide model choices.</p>}
      </>}
      {action === 'edit' && <label>Prompt for Codex<textarea className="field-input" required maxLength={8000} rows={8} value={value} onChange={e => setValue(e.target.value)}/></label>}
      {action === 'decline' && <><label>Motivation<textarea className="field-input" required maxLength={4000} rows={5} value={value} onChange={e => setValue(e.target.value)}/></label><p>This explanation will be emailed to {item.email}.</p></>}
      {action === 'retry' && <p>Resume delivery using the approved prompt and model settings.</p>}
      {error && <p className="suggestion-error" role="alert">{error}</p>}
      <div className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || (action === 'approve' && !choice) || (['edit','decline'].includes(action) && !value.trim())}>{submitLabel}</button></div>
    </form>
  </SuggestionModal>;
}
export default function SuggestionAdmin({ onSignOut }) {
  const [pages,setPages] = useState([null]), [data,setData] = useState(null), [error,setError] = useState(''), [dialog,setDialog] = useState(null);
  const sequence = useRef(0), before = pages.at(-1);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await request('/api/admin/suggestions' + (before ? '?before=' + before : ''));
      if (current === sequence.current) { setData(next); setError(''); }
    } catch (err) { if (current === sequence.current) { setError(err.message); if ([401,403].includes(err.status)) setData(null); } }
  }, [before]);
  useEffect(() => { setData(null); refresh(); const timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000); return () => { ++sequence.current; clearInterval(timer); }; }, [refresh]);
  return <div className="web-root suggestions-admin">
    <header className="web-cloud-header"><a href="/">WRAITER</a><button className="secondary-button" onClick={onSignOut}>Sign out</button></header>
    <main><div className="suggestions-heading"><h1>Suggestions</h1><button type="button" className="secondary-button" onClick={refresh}><RefreshCw size={15}/>Refresh</button></div>
      {error && <p role="alert" className="suggestion-error">{error}</p>}
      {data ? <><p className="relay-status">Developer PC {data.online ? 'online' : 'offline'}</p>
        {data.items.length === 0 && <p>No suggestions yet.</p>}
        {data.items.map(item => <article key={item.id}>
          <header><strong>{states[item.status]}</strong><time dateTime={new Date(item.created).toISOString()}>{new Date(item.created).toLocaleString()}</time></header>
          <p className="author">{item.email} · {new URL(item.origin).host}</p>
          <p className="suggestion-text">{item.prompt}</p>
          {item.prompt !== item.original && <details><summary>Original suggestion</summary><p className="suggestion-text">{item.original}</p></details>}
          {item.filenames.length > 0 && <p className="author">Attachments · {item.filenames.join(', ')}</p>}
          {!item.received_mail && <p className="author">Admin notification pending</p>}
          {item.status === 'declined' && <><p className="suggestion-text">{item.motivation}</p><p>{item.decline_mail ? 'Decline email sent' : 'Decline email pending'}</p></>}
          {item.status === 'pending' && <div className="suggestion-actions">
            <button className="secondary-button" onClick={() => setDialog({ action:'approve',item })}><ThumbsUp size={15}/>Approve</button>
            <button className="secondary-button" onClick={() => setDialog({ action:'decline',item })}><ThumbsDown size={15}/>Decline</button>
            <button className="secondary-button" onClick={() => setDialog({ action:'edit',item })}><Pencil size={15}/>Edit</button>
          </div>}
          {item.status === 'failed' && <><p className="suggestion-error">{item.delivery_error}</p><button className="secondary-button" onClick={() => setDialog({ action:'retry',item })}>Retry delivery</button></>}
          {item.status === 'sent' && <a href={`codex://threads/${item.thread_id}`}>Open in Codex</a>}
        </article>)}
        <nav className="suggestion-actions" aria-label="Suggestion pages">{pages.length > 1 && <button className="secondary-button" onClick={() => setPages(pages.slice(0,-1))}>Newer suggestions</button>}{data.next && <button className="secondary-button" onClick={() => setPages([...pages,data.next])}>Older suggestions</button>}</nav>
      </> : !error && <p role="status">Loading suggestions…</p>}
      {dialog && <Review {...dialog} models={data?.models || []} onClose={() => setDialog(null)} onUpdated={() => { setDialog(null); refresh(); }}/>}
    </main></div>;
}
