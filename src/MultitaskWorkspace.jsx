import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { MIN_PANE_WIDTH, placePane, resizePair, TAB_TRANSFER } from './multitask.js';

const stripStyle = count => ({ minWidth: count > 1 ? count * MIN_PANE_WIDTH + (count - 1) * 8 : undefined });

export default function MultitaskWorkspace({ panes, activeId, draggingId, disabled, onPlace, onResize, onDragEnd, renderPane }) {
  const root = useRef(null), resize = useRef(null), frame = useRef(0);
  const [preview, setPreview] = useState(null);
  // Preview the same placement and flex constraints as the committed layout.
  // Moving an existing pane preserves its width; adding one splits the target.
  const previewPanes = useMemo(() => draggingId && preview && !disabled ? placePane(panes, draggingId, preview.id, preview.side) : null, [panes, draggingId, preview, disabled]);
  const callbacks = useRef(); callbacks.current = { onResize, onDragEnd };
  const activeRef = useRef(activeId); activeRef.current = activeId;
  function revealActive() {
    const host = root.current;
    if (!host || host.dataset.resizing) return;
    const pane = [...host.querySelectorAll('[data-pane-id]')].find(item => item.dataset.paneId === activeRef.current);
    if (!pane) return;
    const bounds = host.getBoundingClientRect(), box = pane.getBoundingClientRect();
    if (box.left < bounds.left) host.scrollLeft -= bounds.left - box.left;
    else if (box.right > bounds.right) host.scrollLeft += box.right - bounds.right;
  }
  useEffect(() => { revealActive(); }, [activeId, panes.length]);
  useEffect(() => {
    let width = 0;
    const observer = new ResizeObserver(entries => {
      const next = entries[0].contentRect.width;
      if (Math.abs(next - width) > .5) { width = next; revealActive(); }
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  function finishResize(cancel = false) {
    const work = resize.current;
    if (!work) return;
    resize.current = null; cancelAnimationFrame(frame.current); frame.current = 0;
    const sizes = cancel ? work.original : work.latest;
    work.left.style.flexGrow = sizes[0]; work.right.style.flexGrow = sizes[1];
    root.current?.removeAttribute('data-resizing');
    document.documentElement.classList.remove('resizing-multitask');
    if (work.handle.hasPointerCapture(work.pointerId)) work.handle.releasePointerCapture(work.pointerId);
    if (!cancel) callbacks.current.onResize(work.index, sizes);
    // Numbering and page divisions measure once after a drag, not every frame.
    root.current?.dispatchEvent(new Event('multitask-resize-end', { bubbles: true }));
  }
  useEffect(() => {
    const end = () => { setPreview(null); callbacks.current.onDragEnd(); };
    const key = event => { if (event.key === 'Escape') { finishResize(true); end(); } };
    const blur = () => { finishResize(true); end(); };
    document.addEventListener('dragend', end); document.addEventListener('drop', end);
    document.addEventListener('keydown', key); window.addEventListener('blur', blur);
    return () => {
      finishResize(true);
      document.removeEventListener('dragend', end); document.removeEventListener('drop', end);
      document.removeEventListener('keydown', key); window.removeEventListener('blur', blur);
    };
  }, []);
  function beginResize(event, index) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget, left = handle.previousElementSibling, right = handle.nextElementSibling;
    resize.current = { handle, pointerId: event.pointerId, left, right, index, x: event.clientX,
      widths: [left.getBoundingClientRect().width, right.getBoundingClientRect().width],
      original: [panes[index].size, panes[index + 1].size], latest: [panes[index].size, panes[index + 1].size] };
    handle.setPointerCapture(event.pointerId);
    root.current.dataset.resizing = 'true'; document.documentElement.classList.add('resizing-multitask');
  }
  function moveResize(event) {
    const work = resize.current;
    if (!work) return;
    const widths = resizePair(...work.widths, event.clientX - work.x);
    const scale = (work.original[0] + work.original[1]) / (work.widths[0] + work.widths[1]);
    work.latest = widths.map(width => width * scale);
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (!resize.current) return;
      work.left.style.flexGrow = work.latest[0]; work.right.style.flexGrow = work.latest[1];
    });
  }
  function keyboardResize(event, index) {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    const left = event.currentTarget.previousElementSibling.getBoundingClientRect().width;
    const right = event.currentTarget.nextElementSibling.getBoundingClientRect().width;
    const delta = event.key === 'Home' ? -left : event.key === 'End' ? right : event.key === 'Enter' ? (right - left) / 2 : (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 80 : 24);
    const scale = (panes[index].size + panes[index + 1].size) / (left + right);
    onResize(index, resizePair(left, right, delta).map(width => width * scale));
  }
  function dropTarget(event) {
    const pane = event.target.closest?.('[data-pane-id]');
    if (!pane || !root.current.contains(pane) || pane.dataset.paneId === draggingId) return null;
    const bounds = pane.getBoundingClientRect();
    return { id: pane.dataset.paneId, side: event.clientX < bounds.left + bounds.width / 2 ? 'left' : 'right' };
  }
  return <div ref={root} className={`multitask-workspace${panes.length > 1 ? ' is-multitasking' : ''}`} aria-label="Document panels"
    onDragOverCapture={event => {
      if (!event.dataTransfer.types.includes(TAB_TRANSFER)) return;
      event.preventDefault(); event.stopPropagation();
      const next = disabled ? null : dropTarget(event);
      event.dataTransfer.dropEffect = next ? 'move' : 'none';
      setPreview(previous => previous?.id === next?.id && previous?.side === next?.side ? previous : next);
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }}
    onDropCapture={event => {
      if (!event.dataTransfer.types.includes(TAB_TRANSFER)) return;
      event.preventDefault(); event.stopPropagation();
      const target = dropTarget(event), id = event.dataTransfer.getData(TAB_TRANSFER);
      setPreview(null); onDragEnd();
      if (!disabled && target && id) onPlace(id, target.id, target.side);
    }}>
    <div className="multitask-strip" style={stripStyle(panes.length)}>
      {panes.map((pane, index) => <React.Fragment key={pane.id}>
        {index > 0 && <div className="multitask-divider" role="separator" aria-label={`Resize document panels ${index} and ${index + 1}`} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * panes[index - 1].size / (panes[index - 1].size + pane.size))} tabIndex={disabled ? -1 : 0}
          title="Drag to resize · Double-click to balance · Arrow keys to adjust" onPointerDown={event => beginResize(event, index - 1)} onPointerMove={moveResize} onPointerUp={() => finishResize()} onPointerCancel={() => finishResize(true)} onLostPointerCapture={() => finishResize(true)} onKeyDown={event => keyboardResize(event, index - 1)} onDoubleClick={() => { if (!disabled) { const half = (panes[index - 1].size + pane.size) / 2; onResize(index - 1, [half, half]); } }}><span /></div>}
        <section className="multitask-pane" data-pane-id={pane.id} data-active={pane.id === activeId ? 'true' : 'false'} style={{ flexGrow: pane.size }} aria-label={pane.id === activeId ? 'Active document panel' : 'Document panel'}>
          {renderPane(pane.id, panes.length > 1)}
        </section>
      </React.Fragment>)}
      {previewPanes && <div className="multitask-preview-clip" aria-hidden="true"><div className="multitask-drop-preview" style={stripStyle(previewPanes.length)}>
        {previewPanes.map((pane, index) => <React.Fragment key={pane.id}>
          {index > 0 && <div className="multitask-preview-divider" />}
          <div className="multitask-drop-slot" data-preview-pane={pane.id} style={{ flexGrow: pane.size }}>
            {pane.id === draggingId ? <div className={`multitask-drop-field ${preview.side} selected`}>
              {preview.side === 'left' ? <ArrowLeft size={24} /> : <ArrowRight size={24} />}<strong>{panes.some(item => item.id === draggingId) ? 'Move' : 'Open'} on the {preview.side}</strong><span>Release to place document</span>
            </div> : <div className="multitask-drop-remaining" />}
          </div>
        </React.Fragment>)}
      </div></div>}
    </div>
  </div>;
}
