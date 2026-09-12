import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock3, GitBranch, Plus, Redo2, Search, Undo2 } from 'lucide-react';
import { historyStatus, timelineEntries } from './history.js';

function readableNode(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'image') return '[Image]';
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(readableNode).join(['doc', 'bulletList', 'orderedList', 'blockquote'].includes(node.type) ? '\n' : '');
}
function fragments(steps) {
  return (steps || []).filter(step => step.slice?.content?.length).slice().sort((a, b) => (a.from || 0) - (b.from || 0)).map(step => readableNode({ type: 'doc', content: step.slice.content })).join('\n…\n');
}
const fieldNames = { title: 'Title', subtitle: 'Subtitle', content: 'Chapter text', notes: 'Notes', style: 'Writing instructions', references: 'References', documentStyle: 'Document formatting', language: 'Content language', layout: 'Layout', status: 'Chapter status' };
function displayValue(value) {
  if (value === undefined) return '(unset)';
  if (value?.type === 'doc') return readableNode(value);
  if (typeof value === 'string') return value || '(empty)';
  if (Array.isArray(value)) return value.map(item => item?.name || item?.title || String(item)).join(', ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${fieldNames[key] || key}: ${String(item)}`).join('\n');
  return String(value);
}
function ChangeText({ label, text }) {
  if (!text) return null;
  return <div className="history-change"><strong>{label}</strong><pre>{text.length > 12000 ? text.slice(0, 12000) + '\n[Preview limited to 12,000 characters; the complete edit is saved.]' : text}</pre></div>;
}
function EditDetails({ entry }) {
  if (entry.kind === 'steps') {
    const added = fragments(entry.forward), removed = fragments(entry.inverse);
    const formats = [...new Set(entry.forward.map(step => step.mark?.type || (step.stepType === 'attr' ? step.attr : '')).filter(Boolean))];
    return <div className="history-edit-details">
      <ChangeText label="Removed" text={removed} /><ChangeText label="Inserted" text={added} />
      {formats.length > 0 && <p className="small-muted">Formatting: {formats.join(', ')}.</p>}
      {!added && !removed && !formats.length && <p className="small-muted">Changed document structure or paragraph formatting.</p>}
      <small className="small-muted">{entry.forward.length} operation{entry.forward.length === 1 ? '' : 's'} · one undo step</small>
    </div>;
  }
  return <div className="history-edit-details">{(entry.patches || []).map((patch, index) => {
    if (patch.scope === 'chapter-order') return <p className="small-muted" key={index}>Chapter order changed.</p>;
    if (patch.scope === 'chapter') return <p className="small-muted" key={index}>{patch.hasAfter ? 'Added' : 'Removed'} chapter: {(patch.after || patch.before)?.title || 'Untitled'}.</p>;
    const label = fieldNames[patch.key] || patch.key;
    return <div className="history-field-change" key={index}><strong>{label}</strong><ChangeText label="Before" text={displayValue(patch.before)} /><ChangeText label="After" text={displayValue(patch.after)} /></div>;
  })}</div>;
}

export default function HistoryPanel({ journal, gitHistory = { entries: [] }, onUndo, onRedo, onCheckpoint, onRestoreGit, onInspectEntry }) {
  const [tab, setTab] = useState('edits'), [query, setQuery] = useState(''), [shown, setShown] = useState(100), [expanded, setExpanded] = useState(null);
  const status = historyStatus(journal);
  const entries = useMemo(() => timelineEntries(journal), [journal]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? entries.filter(entry => [entry.label, entry.chapterTitle, entry.summary, entry.status, new Date(entry.timestamp).toLocaleString()].some(value => String(value || '').toLocaleLowerCase().includes(needle))) : entries;
  }, [entries, query]);
  return <div className="inspector-body history-panel">
    <div className="history-tabs" role="tablist" aria-label="Revision history views">
      <button role="tab" aria-selected={tab === 'edits'} onClick={() => setTab('edits')}>Every edit <span>{status.totalEdits}</span></button>
      <button role="tab" aria-selected={tab === 'checkpoints'} onClick={() => setTab('checkpoints')}>Checkpoints <span>{gitHistory.entries?.length || 0}</span></button>
    </div>
    {tab === 'edits' ? <>
      <div className="history-actions"><button className="secondary-button" disabled={!status.canUndo} title={status.undoLabel ? `Undo: ${status.undoLabel}` : 'Nothing to undo'} onClick={onUndo}><Undo2 size={14} />Undo</button><button className="secondary-button" disabled={!status.canRedo} title={status.redoLabel ? `Redo: ${status.redoLabel}` : 'Nothing to redo'} onClick={onRedo}><Redo2 size={14} />Redo</button></div>
      <p className="small-muted">Every text and formatting edit is saved. Undo and redo continue across chapters and sessions.</p>
      <label className="history-search"><Search size={14} /><input className="field-input" type="search" aria-label="Search editing history" placeholder="Search edits, chapters or dates" value={query} onChange={event => { setQuery(event.target.value); setShown(100); }} /></label>
      {!entries.length && <p className="small-muted history-empty">Your editing history begins when you change this document.</p>}
      {Boolean(entries.length) && !filtered.length && <p className="small-muted history-empty">No edits match this search.</p>}
      <div className="history-timeline">{filtered.slice(0, shown).map(entry => <article key={entry.id} className={`history-edit ${entry.status}${entry.current ? ' current' : ''}`}>
        <button className="history-edit-heading" aria-expanded={expanded === entry.id} onClick={() => { setExpanded(expanded === entry.id ? null : entry.id); onInspectEntry?.(entry); }}>
          {expanded === entry.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span><strong>{entry.label}</strong><small>{entry.chapterTitle || 'Manuscript'} · {new Date(entry.timestamp).toLocaleString()}</small></span>
        </button>
        <div className="history-edit-state"><span>{entry.current ? 'Current revision' : entry.status === 'applied' ? 'Applied' : entry.status === 'undone' ? 'Undone · available to redo' : 'Earlier branch'}</span>{entry.status === 'branched' && <GitBranch size={12} />}</div>
        {expanded === entry.id ? <EditDetails entry={entry} /> : entry.summary && <p className="history-edit-summary">{entry.summary}</p>}
      </article>)}</div>
      {filtered.length > shown && <button className="secondary-button full" onClick={() => setShown(value => value + 100)}>Show 100 more edits ({filtered.length - shown} remaining)</button>}
    </> : <>
      <p className="small-muted">Named versions and automatic Git checkpoints preserve complete manuscripts.</p>
      <button className="primary-button full" onClick={() => onCheckpoint?.()}><Plus size={15} />Save version</button>
      {gitHistory.error && <p className="ai-error">{gitHistory.error}</p>}
      {!gitHistory.entries?.length && <p className="small-muted history-empty">Save a version to mark an important point in your draft.</p>}
      {(gitHistory.entries || []).map(item => <div className="snapshot-card" key={item.revision}><div><Clock3 size={14} /><small>{new Date(item.date).toLocaleString()}</small></div><strong>{item.message}</strong><code>{item.revision.slice(0, 8)}</code><button className="secondary-button" onClick={() => onRestoreGit?.(item)}>Restore this version</button></div>)}
    </>}
  </div>;
}
