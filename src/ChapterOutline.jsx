import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { contentWordCount } from './document.js';
const TYPE = 'application/x-wraiter-chapter';

export default function ChapterOutline({ project, activeId, renameId, onRenameStart, onRenameEnd, onActivate, onRename, onMove, disabled }) {
  const [draft, setDraft] = useState(''), [drop, setDrop] = useState(null), input = useRef();
  useEffect(() => { setDraft(project.chapters.find(item => item.id === renameId)?.title || ''); input.current?.focus(); input.current?.select(); }, [renameId, project.id]);
  function commit(id) { if (!draft.trim()) { input.current?.focus(); return; } onRename(id, draft); onRenameEnd(); }
  return <nav className="chapter-list" aria-label="Chapters">{project.chapters.map((item, index) => <div className={`chapter-item ${item.id === activeId ? 'selected' : ''} ${drop?.id === item.id ? `drop-${drop.after ? 'after' : 'before'}` : ''}`} key={item.id} draggable={!disabled && renameId !== item.id}
    onDragStart={event => { if (disabled) { event.preventDefault(); return; } event.dataTransfer.setData(TYPE, JSON.stringify({ id: item.id, project: project.id })); event.dataTransfer.effectAllowed = 'move'; }}
    onDragOver={event => { if (disabled || !event.dataTransfer.types.includes(TYPE)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const bounds = event.currentTarget.getBoundingClientRect(); setDrop({ id: item.id, after: event.clientY > bounds.top + bounds.height / 2 }); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(null); }} onDragEnd={() => setDrop(null)}
    onDrop={event => { if (!event.dataTransfer.types.includes(TYPE)) return; event.preventDefault(); setDrop(null); if (disabled) return; try { const source = JSON.parse(event.dataTransfer.getData(TYPE)); if (source.project === project.id) onMove(source.id, item.id, event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2); } catch {} }}>
    <button className="chapter-select" disabled={disabled} title="Double-click or press F2 to rename; drag to reorder" onClick={() => onActivate(item.id)} onDoubleClick={() => onRenameStart(item.id)} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); onRenameStart(item.id); } }}><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="chapter-item-text"><span>{item.title}</span><small>{contentWordCount(item.content).toLocaleString()} words</small></span>{item.status === 'Final' ? <CheckCircle2 size={13} /> : <span className={`chapter-status ${(item.status || 'Draft').toLowerCase()}`} />}</button>
    {renameId === item.id && <input ref={input} className="outline-rename" aria-label={`Rename chapter ${item.title}`} maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft.trim()) commit(item.id); else onRenameEnd(); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(item.id); } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onRenameEnd(); } }} />}
  </div>)}</nav>;
}
