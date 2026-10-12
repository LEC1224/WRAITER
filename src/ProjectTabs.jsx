import React, { useState } from 'react';
import { FileText, LoaderCircle, Plus, X } from 'lucide-react';
const TYPE = 'application/x-wraiter-tab';
export default function ProjectTabs({ tabs, activeId, project, path, saveState, request, cache, disabled, onActivate, onClose, onCycle, onMove, onNew }) {
  const [drop, setDrop] = useState(null);
  return <div className="project-tabs-bar"><div className="project-tabs" role="tablist" aria-label="Open projects">{tabs.map(tab => {
    const active = tab.id === activeId, title = active ? project.title : tab.title, working = request?.mode === 'chat' && request.tabId === tab.id, unread = cache.get(tab.id)?.unread;
    return <div className={'project-tab' + (active ? ' selected' : '') + (drop?.id === tab.id ? ` drop-${drop.after ? 'after' : 'before'}` : '')} key={tab.id} data-project-tab={tab.id} draggable={!disabled}
      onAuxClick={event => { if (event.button === 1) { event.preventDefault(); if (!disabled) onClose(tab.id); } }} onMouseDown={event => { if (event.button === 1) event.preventDefault(); }}
      onDragStart={event => { if (disabled) { event.preventDefault(); return; } event.dataTransfer.setData(TYPE, tab.id); event.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={event => { if (disabled || !event.dataTransfer.types.includes(TYPE)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDrop({ id: tab.id, after: event.clientX > rect.left + rect.width / 2 }); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(null); }} onDragEnd={() => setDrop(null)}
      onDrop={event => { if (!event.dataTransfer.types.includes(TYPE)) return; event.preventDefault(); setDrop(null); if (!disabled) { const rect = event.currentTarget.getBoundingClientRect(); onMove(event.dataTransfer.getData(TYPE), tab.id, event.clientX > rect.left + rect.width / 2); } }}>
      <button role="tab" id={`project-tab-${tab.id}`} aria-selected={active} aria-controls="project-workspace" tabIndex={active ? 0 : -1} disabled={disabled} title={(active ? path : tab.path) || 'Unnamed draft — saved in recovery'} onClick={() => onActivate(tab.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); if (event.ctrlKey && event.shiftKey) { const index = tabs.findIndex(item => item.id === tab.id), target = tabs[index + (event.key === 'ArrowRight' ? 1 : -1)]; if (target) onMove(tab.id, target.id, event.key === 'ArrowRight'); } else onCycle(event.key === 'ArrowRight' ? 1 : -1, true); } }}><FileText size={14} /><span>{title}</span>{active && ['pending', 'saving', 'error'].includes(saveState) && <span className={'tab-save-dot ' + saveState} aria-label={saveState === 'error' ? 'Save needs attention' : 'Saving changes'}>●</span>}{working ? <LoaderCircle size={12} className="spin tab-assistant-status" aria-hidden="true" title="Assistant working" /> : unread ? <span className="tab-assistant-status unread" aria-hidden="true" title="Assistant reply ready">●</span> : null}</button>
      <button type="button" className="icon-button" aria-label={`Close project ${title}`} title={`Close project ${title}`} disabled={disabled} onClick={() => onClose(tab.id)}><X size={17} /></button>
    </div>;
  })}</div><button type="button" className="icon-button" aria-label="New project tab" title="New project tab" disabled={disabled} onClick={onNew}><Plus size={17} /></button></div>;
}
