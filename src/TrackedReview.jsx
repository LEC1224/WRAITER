import React, { useEffect, useRef, useState } from 'react';
import { Check, X, ArrowUpRight, PencilLine } from 'lucide-react';

export default function TrackedReview({ changes, chapterId, tracking, selectedId, issue, onToggle, onNavigate, onReview, disabled }) {
  const [scope, setScope] = useState('chapter'), [confirm, setConfirm] = useState(null), [error, setError] = useState('');
  const list = useRef(null);
  const visible = scope === 'document' ? changes : changes.filter(change => change.chapterId === chapterId);
  useEffect(() => { setConfirm(null); setError(''); }, [changes, scope, chapterId]);
  useEffect(() => { if (selectedId) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selectedId, chapterId]);
  function apply(items, accept) { try { onReview(items, accept); setConfirm(null); setError(''); } catch (failure) { setError(failure.message); } }
  return <div className="inspector-body review-panel" aria-label="Tracked edits">
    <div className="review-recording"><div><PencilLine size={17} /><strong>{tracking ? 'Recording text edits' : 'Recording is off'}</strong></div>
      <p>{tracking ? 'Your additions and removals wait for an Accept or Reject decision.' : 'Write normally, or record text edits to review them later.'}</p>
      <button className={tracking ? 'secondary-button' : 'primary-button'} disabled={disabled} onClick={onToggle} title={tracking ? "Stop recording new text edits; pending edits stay available for review." : "Record text additions and removals within paragraphs for later review."}>{tracking ? 'Stop recording' : 'Start recording text edits'}</button>
      {!tracking && changes.length > 0 && <small>Stopping recording keeps pending edits for review.</small>}
    </div>
    <div className="review-legend"><span className="review-added">Added text</span><span className="review-removed">Removed text</span></div>
    <p className="small-muted">Accept keeps the proposed wording. Reject restores the original. Both can be undone.</p>
    {tracking && <p className="review-limits">Records text within a paragraph. Stop recording for paragraph breaks, formatting or inserting objects.</p>}
    {issue && <p className="review-issue" role="alert">{issue}</p>}
    <label className="review-scope">Review<select className="field-input" aria-label="Review scope" value={scope} onChange={event => setScope(event.target.value)}><option value="chapter">Current chapter</option><option value="document">Whole document</option></select></label>
    <div className="review-count"><strong>{visible.length} pending {visible.length === 1 ? 'edit' : 'edits'}</strong>{visible.length > 1 && <div><button className="text-button" disabled={disabled} onClick={() => setConfirm(true)} title="Review accepting every pending edit in the chosen scope.">Accept all…</button><button className="text-button" disabled={disabled} onClick={() => setConfirm(false)} title="Review rejecting every pending edit in the chosen scope.">Reject all…</button></div>}</div>
    {confirm !== null && <div className="review-batch" role="group" aria-label="Confirm review of all edits"><p>{confirm ? 'Keep all proposed wording' : 'Restore the original wording'} for these {visible.length} edits? This is one undo step.</p><button className="primary-button" disabled={disabled} onClick={() => apply(visible, confirm)}>{confirm ? 'Accept' : 'Reject'} {visible.length} edits</button><button className="text-button" onClick={() => setConfirm(null)}>Cancel</button></div>}
    {error && <p role="alert">{error}</p>}
    {!visible.length && <div className="review-empty"><Check size={24} /><strong>No edits to review</strong><p>{tracking ? 'New text edits will appear here as you write.' : 'This scope has no pending additions or removals.'}</p></div>}
    <div ref={list} className="review-change-list">{visible.map(change => <article className="review-change" key={change.key} data-active={selectedId === change.id}>
      <div className="review-change-heading"><strong>{change.kind}</strong><button className="text-button" disabled={disabled} onClick={() => onNavigate(change)} aria-label={`Show ${change.kind.toLowerCase()} in text`} title="Show this edit in the manuscript"><ArrowUpRight size={15} />Show in text</button></div>
      <small>{change.chapterTitle} · {change.author || 'Writer'}</small>
      <div className="review-wording"><span>Original</span><p>{change.before}<del>{change.original}</del>{change.after}</p><span>Proposed</span><p>{change.before}<ins>{change.proposed}</ins>{change.after}</p></div>
      <div className="review-decisions"><button className="primary-button" disabled={disabled} onClick={() => apply([change], true)} title="Keep this proposed wording and mark the edit as reviewed. You can undo it."><Check size={14} />Accept change</button><button className="secondary-button" disabled={disabled} onClick={() => apply([change], false)} title="Restore the original wording for this edit. You can undo it."><X size={14} />Reject change</button></div>
    </article>)}</div>
  </div>;
}
