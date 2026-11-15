import React, { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, GripVertical, X } from 'lucide-react';
import ManuscriptEditor from './Editor.jsx';
import { contentWordCount } from './document.js';
import { documentLayout } from './layouts.js';
import { namedStyleCSS } from './named-styles.js';
import { imageSurfaceEvent } from './image-import.js';
import { startTabDrag } from './multitask.js';

// Stable props keep inactive manuscripts out of the typing/toolbar render path.
export default memo(function DocumentPane({ id, project, chapterId, epoch, tracking, active, multiple, prefs, actions, children }) {
  const [editor, setEditor] = useState(null), currentRef = useRef(null);
  const chapter = project.chapters.find(item => item.id === chapterId) || project.chapters[0];
  const docStyle = project.documentStyle || { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 };
  const editorPrefs = useMemo(() => ({ ...prefs, language: project.language || prefs.language }), [prefs, project.language]);
  const onReady = useCallback(current => { currentRef.current = current; setEditor(current); actions.current.register(id, current); }, [id, actions]);
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isEditable !== active) editor.setEditable(active, false);
    if (active) actions.current.ready(editor);
  }, [editor, active]);
  const onChange = useCallback((...args) => actions.current.content(id, ...args), [id, actions]);
  const onSelection = useCallback((...args) => actions.current.selection(id, ...args), [id, actions]);
  const onAction = useCallback((...args) => actions.current.action(id, ...args), [id, actions]);
  const canImportImages = useCallback(current => actions.current.canImportImages(current), [actions]);
  const notice = useCallback(message => actions.current.notice(message), [actions]);
  const words = contentWordCount(chapter.content);
  return <div className={`document-pane-content layout-${project.layout || 'story'}`} style={{ '--writing-font': docStyle.fontFamily, '--writing-size': `${docStyle.fontSize}pt`, '--writing-leading': docStyle.lineHeight }}
    onPointerDownCapture={event => {
      if (active || event.button !== 0 || event.target.closest('[data-pane-control]')) return;
      // Enable the resident editor before the browser handles this same press.
      // Its native caret, selection, double-click and drag behavior stays intact.
      const current = currentRef.current, inEditor = current?.view.dom.contains(event.target);
      const position = inEditor ? current.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos : null;
      if (!actions.current.activate(id, { target: event.target })) { event.preventDefault(); event.stopPropagation(); return; }
      if (inEditor && !current.isDestroyed) {
        // ProseMirror counts clicks per editor, so a quick return can look like
        // a double/triple click even after clicking in another document.
        if (current.view.input?.lastClick) current.view.input.lastClick.time = 0;
        const selected = current.state.selection;
        if (position != null && (event.shiftKey || selected.empty || position < selected.from || position > selected.to)) {
          current.commands.setTextSelection(event.shiftKey ? { from: selected.anchor, to: position } : position);
        }
        // Native focus of a freshly editable element otherwise starts at 1.
        // Preserve a selected passage here so its next native drag can copy it.
        current.view.focus();
      }
    }} onFocusCapture={event => { if (!active && !event.target.closest('[data-pane-control]')) actions.current.activate(id, { target: event.target }); }}>
    <style>{namedStyleCSS(project.namedStyles, `[data-pane-id="${id}"] .manuscript `)}</style>
    {multiple && <div className="multitask-pane-heading">
      <button className="multitask-pane-title" data-pane-control="true" draggable onDragStart={event => startTabDrag(event, id, actions.current.drag)} onDragEnd={() => actions.current.drag(null)} onClick={event => actions.current.activate(id, { target: event.currentTarget })} title={`${project.title} · Drag to move this panel`}><GripVertical size={14} /><span>{project.title}</span></button>
      <select data-pane-control="true" aria-label={`Chapter in ${project.title}`} value={chapter.id} onChange={event => actions.current.chapter(id, event.target.value)}>{project.chapters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
      <button className="icon-button" data-pane-control="true" aria-label={`Remove ${project.title} from multitask`} title="Remove this panel (keep the tab open)" onClick={() => actions.current.remove(id)}><X size={14} /></button>
    </div>}
    <div className={`writing-scroll ${prefs.pageMode === 'pages' ? 'divided-pages' : 'continuous-pages'} ${prefs.showRowNumbers || prefs.showPageNumbers || prefs.showParagraphNumbers ? 'has-numbering' : ''}`} onDragOver={event => imageSurfaceEvent(currentRef.current, 'dragover', event.nativeEvent)} onDragLeave={event => imageSurfaceEvent(currentRef.current, 'dragleave', event.nativeEvent)} onDrop={event => imageSurfaceEvent(currentRef.current, 'drop', event.nativeEvent)} style={{ '--numbering-width': `${[prefs.showRowNumbers, prefs.showPageNumbers, prefs.showParagraphNumbers].filter(Boolean).length * 34}px` }}>
      <article className="writing-sheet">
        <div className="chapter-kicker"><span>CHAPTER {String(project.chapters.findIndex(item => item.id === chapter.id) + 1).padStart(2, '0')}</span><span className="kicker-line" /><select aria-label="Chapter status" disabled={!active} value={chapter.status || 'Draft'} onChange={event => actions.current.editChapter(chapter.id, { status: event.target.value })} title="Label this chapter’s progress for your own organisation."><option>Draft</option><option>Notes</option><option>Revising</option><option>Final</option></select></div>
        <div className="chapter-title-row"><input className="chapter-title" aria-label="Chapter title" readOnly={!active} value={chapter.title} onChange={event => actions.current.editChapter(chapter.id, { title: event.target.value })} /><div className="chapter-tools">
          <button className="icon-button" aria-label="Move chapter earlier" title="Move chapter earlier" disabled={!active || project.chapters[0].id === chapter.id} onClick={() => actions.current.reorderChapter(chapter.id, -1)}><ArrowUp size={17} /></button>
          <button className="icon-button" aria-label="Move chapter later" title="Move chapter later" disabled={!active || project.chapters.at(-1).id === chapter.id} onClick={() => actions.current.reorderChapter(chapter.id, 1)}><ArrowDown size={17} /></button>
          <button className="icon-button" aria-label="Delete chapter" title="Delete chapter" disabled={!active || project.chapters.length === 1} onClick={() => actions.current.deleteChapter()}><Trash2 size={17} /></button>
        </div></div>
        {(project.showStatistics ?? documentLayout(project).showStatistics) && <div className="chapter-meta">{words.toLocaleString()} words<span>·</span>{Math.max(1, Math.ceil(words / 220))} min read</div>}
        <ManuscriptEditor key={`${project.id}:${chapter.id}:${epoch}`} chapter={chapter} tracking={tracking} prefs={editorPrefs} layoutSignature={JSON.stringify([docStyle, chapter.title, project.showStatistics])} onReady={onReady} onChange={onChange} onSelection={onSelection} onAction={onAction} onNotice={notice} canImportImages={canImportImages} />
        {children}
      </article>
    </div>
  </div>;
});
