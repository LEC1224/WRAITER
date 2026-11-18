import React, { memo, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { contentWordCount } from './document.js';
import { chapterHeadings } from './headings.js';
import { MAX_CHAPTER_TITLE } from './chapter-actions.js';
import './navigation.css';
const TYPE = 'application/x-wraiter-chapter';
const RENAME_DELAY = 500, RENAME_WINDOW = 2000;

const ChapterItem = memo(function ChapterItem({ item, index, active, renaming, dropAfter, projectId, disabled, canNavigate, input, actions }) {
  const headings = canNavigate ? chapterHeadings(item.content) : [];
  return <div className={`chapter-item ${active ? 'selected' : ''} ${dropAfter !== null ? `drop-${dropAfter ? 'after' : 'before'}` : ''}`} draggable={!disabled && !renaming}
    onDragStart={event => { if (disabled) { event.preventDefault(); return; } event.dataTransfer.setData(TYPE, JSON.stringify({ id: item.id, project: projectId })); event.dataTransfer.effectAllowed = 'move'; }}
    onDragOver={event => { if (disabled || !event.dataTransfer.types.includes(TYPE)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const bounds = event.currentTarget.getBoundingClientRect(); actions.current.setDrop({ id: item.id, after: event.clientY > bounds.top + bounds.height / 2 }); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) actions.current.setDrop(null); }} onDragEnd={() => actions.current.setDrop(null)}
    onDrop={event => { if (!event.dataTransfer.types.includes(TYPE)) return; event.preventDefault(); actions.current.setDrop(null); if (disabled) return; try { const source = JSON.parse(event.dataTransfer.getData(TYPE)); if (source.project === projectId) actions.current.onMove(source.id, item.id, event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2); } catch {} }}>
    <button className="chapter-select" data-chapter-id={item.id} disabled={disabled} title="Press F2 to rename; drag to reorder"
      onClick={event => actions.current.activate(event, item.id)}
      onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); actions.current.onRenameStart(item.id); } }}>
      <span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="chapter-item-text"><span data-chapter-title>{item.title}</span><small>{contentWordCount(item.content).toLocaleString()} words</small></span>{item.status === 'Final' ? <CheckCircle2 size={13} /> : <span className={`chapter-status ${(item.status || 'Draft').toLowerCase()}`} />}
    </button>
    {renaming && <input ref={input} className="outline-rename" aria-label={'Rename chapter ' + item.title} maxLength={MAX_CHAPTER_TITLE} defaultValue={item.title}
      onBlur={event => actions.current.finishRename(item.id, event.currentTarget, true)} onKeyDown={event => actions.current.renameKey(event, item.id)} />}
    {canNavigate && headings.length > 0 && <details className="chapter-headings" onDragStart={event => event.stopPropagation()}><summary>Headings ({headings.length})</summary>{headings.map((heading, index) => <button className="chapter-heading-link" style={{ paddingLeft: `${12 + (heading.level - 1) * 12}px` }} key={index} disabled={disabled} title={heading.title} onClick={() => actions.current.onNavigate(item.id, heading)}>{heading.title}</button>)}</details>}
  </div>;
});

export default function ChapterOutline({ project, activeId, renameId, onRenameStart, onRenameEnd, onActivate, onNavigate, onRename, onMove, disabled }) {
  const [drop, setDrop] = useState(null), input = useRef(), lastTitleClick = useRef(null), actions = useRef(null);
  useLayoutEffect(() => {
    lastTitleClick.current = null;
    input.current?.focus();
    input.current?.select();
  }, [renameId, project.id]);

  function resetTitleClick() { lastTitleClick.current = null; }
  function activate(event, id) {
    const previous = lastTitleClick.current;
    resetTitleClick();
    // Chromium also counts a quick double-click if the OS timeout is longer.
    if (event.detail === 1 && event.target.closest('[data-chapter-title]') &&
        !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      const elapsed = event.timeStamp - previous?.time;
      if (id === activeId && previous?.id === id && elapsed >= RENAME_DELAY && elapsed <= RENAME_WINDOW) {
        onRenameStart(id);
        return;
      }
      lastTitleClick.current = { id, time: event.timeStamp };
    }
    onActivate(id);
  }

  function finishRename(id, field, save, restoreFocus = false) {
    if (input.current !== field) return;
    input.current = null; // Restoring button focus also blurs the field.
    if (save && field.value.trim()) onRename(id, field.value);
    onRenameEnd();
    if (restoreFocus) field.parentElement?.querySelector('.chapter-select')?.focus({ preventScroll: true });
  }
  function renameKey(event, id) {
    if (event.nativeEvent.isComposing || !['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const save = event.key === 'Enter';
    if (!save || event.currentTarget.value.trim()) finishRename(id, event.currentTarget, save, true);
  }
  actions.current = { onRenameStart, activate, onNavigate, onMove, setDrop, finishRename, renameKey };
  return <nav className="chapter-list" aria-label="Chapters" onBlurCapture={resetTitleClick} onContextMenuCapture={resetTitleClick} onDragStartCapture={resetTitleClick}>{project.chapters.map((item, index) => <ChapterItem key={item.id} item={item} index={index} active={item.id === activeId} renaming={item.id === renameId} dropAfter={drop?.id === item.id ? drop.after : null} projectId={project.id} disabled={disabled} canNavigate={!!onNavigate} input={input} actions={actions} />)}</nav>;
}
