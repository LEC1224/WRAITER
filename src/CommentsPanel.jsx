import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CornerUpLeft, MapPin, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react';
import { addComment, deleteComment, projectCommentRows, updateComment } from './comments.js';
import { MAX_COMMENT_TEXT } from '../electron/comments.mjs';

function CommentCard({ row, active, disabled, onNavigate, onChange }) {
  const { comment, chapter, ranges, locations, detached } = row;
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(comment.text);
  const [error, setError] = useState('');
  const card = useRef(null);
  useEffect(() => { if (!editing) setDraft(comment.text); }, [comment.text, editing]);
  useEffect(() => { if (active) card.current?.scrollIntoView({ block: 'nearest' }); }, [active]);
  function save(event) {
    event.preventDefault();
    try { onChange({ text: draft }, 'Edit comment'); setEditing(false); setError(''); }
    catch (error) { setError(error.message); }
  }
  return <article ref={card} className={`comment-card ${comment.resolved ? 'resolved' : ''} ${active ? 'active' : ''}`} data-comment-id={comment.id}>
    <div className="comment-card-heading"><strong>{chapter?.title || 'Removed chapter'}</strong><span className="comment-state">{comment.resolved ? 'Resolved' : 'Open'}</span></div>
    <button className="comment-passage" disabled={disabled || detached} onClick={() => onNavigate?.({ ...comment, chapterId: chapter.id }, ranges[0])} title={detached ? 'The original passage has been removed. The comment is still saved.' : 'Go to this passage'}>
      <MapPin size={13} /><span>{comment.quote}</span>
    </button>
    {locations.length > 1 && <div className="comment-locations">{locations.map(location => <button key={location.chapter.id} className="text-button" disabled={disabled} onClick={() => onNavigate?.({ ...comment, chapterId: location.chapter.id }, location.ranges[0])}><MapPin size={12} />{location.chapter.title || 'Untitled chapter'}</button>)}</div>}
    {detached && <p className="comment-detached">Passage removed · comment retained</p>}
    {editing ? <form className="comment-edit-form" onSubmit={save}>
      <textarea className="field-input comment-textarea" aria-label="Edit comment text" autoFocus maxLength={MAX_COMMENT_TEXT} rows={4} value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} />
      {error && <p className="comment-error" role="alert">{error}</p>}
      <div className="comment-actions"><button className="primary-button" disabled={disabled || !draft.trim()}><Check size={13} />Save comment</button><button type="button" className="text-button" onClick={() => { setEditing(false); setDraft(comment.text); setError(''); }}><X size={13} />Cancel</button></div>
    </form> : <p className="comment-body">{comment.text}</p>}
    <div className="comment-actions">
      <button className="text-button" disabled={disabled} onClick={() => { setDraft(comment.text); setEditing(true); }}><Pencil size={13} />Edit</button>
      <button className="text-button" disabled={disabled} onClick={() => onChange({ resolved: !comment.resolved }, comment.resolved ? 'Reopen comment' : 'Resolve comment')}>{comment.resolved ? <CornerUpLeft size={13} /> : <Check size={13} />}{comment.resolved ? 'Reopen' : 'Resolve'}</button>
      <button className="text-button comment-delete" disabled={disabled} onClick={() => onChange(null, 'Delete comment')}><Trash2 size={13} />Delete</button>
    </div>
  </article>;
}

// onChange receives the complete immutable project, history label, anchor's
// chapter ID, and optional selection. The application commits it in one batch.
export default function CommentsPanel({ project, editor, selection = null, onChange, onNavigate, disabled = false, activeCommentId = null, focusRequest = 0 }) {
  const [filter, setFilter] = useState('open'), [draft, setDraft] = useState(''), [error, setError] = useState('');
  const textarea = useRef(null);
  const rows = useMemo(() => projectCommentRows(project, editor?.schema), [project.chapters, project.comments, editor?.schema]);
  const openCount = rows.filter(row => !row.comment.resolved).length;
  const visible = rows.filter(row => filter === 'all' || (filter === 'resolved' ? row.comment.resolved : !row.comment.resolved));
  const selected = selection && selection.to > selection.from && project.chapters.some(chapter => chapter.id === selection.chapterId);
  useEffect(() => { if (focusRequest) textarea.current?.focus(); }, [focusRequest]);
  useEffect(() => {
    const targeted = (project.comments || []).find(comment => comment.id === activeCommentId);
    if (targeted) setFilter(targeted.resolved ? 'resolved' : 'open');
  }, [activeCommentId, project.comments]);
  function add(event) {
    event.preventDefault();
    try {
      if (!selected) throw new Error('Select a passage in the manuscript first.');
      const result = addComment(project, { ...selection, text: draft }, editor?.schema);
      onChange(result.project, 'Add comment', result.comment.chapterId, result.selection);
      setDraft(''); setError(''); setFilter('open');
    } catch (error) { setError(error.message); }
  }
  function change(comment, changes, label) {
    const next = changes === null ? deleteComment(project, comment.id, editor?.schema) : updateComment(project, comment.id, changes);
    onChange(next, label, comment.chapterId);
  }
  return <div className="inspector-body comments-panel">
    <div className="panel-description"><h3>Comments</h3><p>Attach private revision notes to a selected passage. Comments stay in this manuscript and are excluded from exports and AI context.</p></div>
    <form className="comment-compose" onSubmit={add}>
      <label className="field-label" htmlFor="new-comment-text">NEW COMMENT</label>
      <textarea ref={textarea} id="new-comment-text" className="field-input comment-textarea" aria-label="New comment text" placeholder={selected ? 'What would you like to revisit here?' : 'Select a passage, then write a comment…'} value={draft} onChange={event => setDraft(event.target.value)} maxLength={MAX_COMMENT_TEXT} rows={4} disabled={disabled} />
      <p className="small-muted">{selected ? 'This comment will follow the selected passage as you edit.' : 'Select text in the manuscript to attach a comment.'}</p>
      {error && <p className="comment-error" role="alert">{error}</p>}
      <button className="primary-button full" disabled={disabled || !selected || !draft.trim()}><MessageSquarePlus size={15} />Add comment</button>
    </form>
    <div className="comment-list-heading"><strong>{openCount} open · {rows.length} total</strong><select aria-label="Comment filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="open">Open comments</option><option value="resolved">Resolved comments</option><option value="all">All comments</option></select></div>
    {!visible.length && <div className="empty-state"><MessageSquarePlus size={30} /><p>{rows.length ? `No ${filter === 'resolved' ? 'resolved' : 'open'} comments.` : 'No comments yet.'}</p><small>{rows.length ? 'Choose another filter to see your saved notes.' : 'Select a passage to leave a revision note.'}</small></div>}
    <div className="comment-list">{visible.map(row => <CommentCard key={row.comment.id} row={row} active={activeCommentId === row.comment.id} disabled={disabled} onNavigate={onNavigate} onChange={(changes, label) => change(row.comment, changes, label)} />)}</div>
  </div>;
}
