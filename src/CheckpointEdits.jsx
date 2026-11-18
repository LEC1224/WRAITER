import React, { useEffect, useState } from 'react';
import { diffChars } from 'diff';
import { ArrowLeft } from 'lucide-react';
import { EditDetails } from './HistoryPanel.jsx';
import { checkpointEvents } from './history.js';
import { nodeText } from './document.js';

function ChapterDiff({ chapter, previous }) {
  const [open, setOpen] = useState(false);
  const prior = previous ? nodeText(previous.content, '\n', true) : '';
  const next = chapter ? nodeText(chapter.content, '\n', true) : '';
  const parts = open && prior !== next ? diffChars(prior, next, { timeout: 120, maxEditLength: 4000 }) || [{ removed: true, value: prior }, { added: true, value: next }] : [];
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{(chapter || previous).title}</summary>
    {open && (parts.length ? <pre className="checkpoint-diff">{parts.map((part, i) => part.added ? <ins key={i}>{part.value}</ins> : part.removed ? <del key={i}>{part.value}</del> : part.value)}</pre> : <p className="small-muted">Chapter details or formatting changed.</p>)}
  </details>;
}

export default function CheckpointEdits({ item, journal, getRevision, onBack }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [limit, setLimit] = useState(40);
  useEffect(() => {
    let alive = true;
    Promise.all([getRevision(item.revision), item.parentRevision && getRevision(item.parentRevision)]).then(([after, before]) => {
      if (!alive) return;
      const events = checkpointEvents(journal, before, after, item.parentRevision);
      setData({ events, after, before });
    }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [item, journal, getRevision]);
  const prior = new Map(data?.before?.chapters.map(chapter => [chapter.id, chapter]));
  const current = new Map(data?.after.chapters.map(chapter => [chapter.id, chapter]));
  const changed = data && !data.events?.length ? [...new Set([...current.keys(), ...prior.keys()])].filter(id => JSON.stringify(current.get(id)) !== JSON.stringify(prior.get(id))) : [];
  return <div className="checkpoint-inspect">
    <button className="text-button" onClick={onBack}><ArrowLeft size={14}/> Back to tree</button>
    <h3>{item.title || item.message}</h3>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading edits…</p> : data.events?.length ? <>
      <p className="small-muted">{data.events.length} individual {data.events.length === 1 ? 'edit' : 'edits'} · newest first</p>
      {data.events.slice(0, limit).map(({ sequence, entry }) => <details key={sequence}><summary>{entry.label} · {entry.chapterTitle || 'Manuscript'} <small>{new Date(entry.timestamp).toLocaleTimeString()}</small></summary><EditDetails entry={entry}/></details>)}
      {data.events.length > limit && <button className="secondary-button" onClick={() => setLimit(limit + 40)}>Show more edits</button>}
    </> : <>
      <p className="small-muted">{!item.parentRevision ? 'Initial checkpoint' : data.events === null ? 'Comparing saved chapters. Individual journal edits are unavailable for this version.' : 'No individual edits between these checkpoints.'}</p>
      {changed.map(id => <ChapterDiff key={id} chapter={current.get(id)} previous={prior.get(id)}/>)}
      {!changed.length && <p>{item.summary || 'Chapter text is unchanged.'}</p>}
    </>}
  </div>;
}
