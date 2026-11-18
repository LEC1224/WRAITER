import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, GitBranch, GitMerge, Layers, Maximize, Minus, Plus } from 'lucide-react';
import { centerCamera, connector, fitCamera, versionLabel, zoomCamera } from './history-map.js';

const shortDate = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const visibleAt = (p, size) => p.x >= -90 && p.x <= size.w + 90 && p.y >= -80 && p.y <= size.h + 80;
const sceneSize = s => s.members.length > 1 ? s.members.length + ' versions' : shortDate(s.first.item.date);

function MiniMap({ map, camera, size, move }) {
  const w = 142, h = 55, bounds = map.bounds;
  const k = Math.min((w - 16) / Math.max(bounds.right, 1), (h - 16) / Math.max(bounds.bottom, 1));
  const x = (w - bounds.right * k) / 2, y = (h - bounds.bottom * k) / 2;
  const project = p => ({ x: x + p.x * k, y: y + p.y * k });
  const go = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    move({ x: ((event.clientX - rect.left) * w / rect.width - x) / k, y: ((event.clientY - rect.top) * h / rect.height - y) / k });
  };
  return <svg className="story-minimap" viewBox={'0 0 ' + w + ' ' + h} aria-label="Overview of all writing paths" role="img" onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); go(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) go(e); }}>
    {map.edges.map(edge => <path key={edge.from.item.revision + edge.to.item.revision} className={'map-edge ' + (edge.active ? 'active' : edge.merge ? 'merged' : '')} d={connector(project(edge.from), project(edge.to))}/>)}
    {map.scenes.map(s => <circle key={s.id} cx={x + s.x * k} cy={y + s.y * k} r={s.current ? 2.5 : 1.2}/>)}
    <rect x={Math.max(1, Math.min(w - 3, x - camera.x / camera.k * k))} y={Math.max(1, Math.min(h - 3, y - camera.y / camera.k * k))}
      width={Math.max(2, Math.min(w - 1, x + (size.w - camera.x) / camera.k * k) - Math.max(1, x - camera.x / camera.k * k))}
      height={Math.max(2, Math.min(h - 1, y + (size.h - camera.y) / camera.k * k) - Math.max(1, y - camera.y / camera.k * k))}/>
  </svg>;
}

export default function HistoryMapCanvas({ map, selection, focus, onSelect, onCurrent, memory, onVisible }) {
  const view = useRef(null), drag = useRef(null), suppressed = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 }), [camera, setCamera] = useState(memory.camera || null);
  const [dragging, setDragging] = useState(false);
  const fit = useMemo(() => fitCamera(map.bounds, size.w, size.h), [map.bounds, size]);
  const cam = camera || fit, minimum = Math.min(0.15, fit.k * 0.83);
  const activeScene = map.sceneOf.get(selection.id);
  useLayoutEffect(() => {
    const el = view.current;
    const measure = () => setSize(prev => {
      const w = el.clientWidth, h = el.clientHeight;
      return w && h && (w !== prev.w || h !== prev.h) ? { w, h } : prev;
    });
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (size.w) memory.camera = cam;
  }, [cam, size, memory]);
  const lastFocus = useRef(null);
  useLayoutEffect(() => {
    if (!focus || !size.w || focus === lastFocus.current) return;
    const point = focus.version ? map.points.get(focus.id) : map.sceneOf.get(focus.id);
    if (point) {
      lastFocus.current = focus;
      const k = focus.version ? Math.max(1.65, cam.k) : Math.max(0.8, Math.min(2.3, (size.w - 150) / Math.max(80, point.last.x - point.first.x)));
      setCamera(centerCamera(point, k, size.w, size.h));
    }
  }, [focus, map, size, cam.k]);
  useEffect(() => {
    const el = view.current;
    const wheel = e => {
      if (e.target.closest('.story-map-controls,.story-minimap')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect(), delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1);
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setCamera(prev => zoomCamera(prev || fit, Math.exp(-Math.max(-1200, Math.min(1200, delta)) * 0.0022), anchor, minimum));
    };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, [fit, size.h, minimum]);
  const project = p => ({ x: p.x * cam.k + cam.x, y: p.y * cam.k + cam.y });
  const visible = map.scenes.filter(s => {
    const { x, y } = project(s);
    return visibleAt({ x, y }, size) || (y > -70 && y < size.h + 70 && project(s.first).x < size.w && project(s.last).x > 0);
  });
  const centerX = size.w / 2;
  const labelCandidates = [...visible].sort((a, b) => Number(b === activeScene) - Number(a === activeScene) || Number(b.current) - Number(a.current) ||
    Number(b.members.length > 1) - Number(a.members.length > 1) || Math.abs(project(a).x - centerX) - Math.abs(project(b).x - centerX));
  const labels = [], labelSlots = [];
  for (const scene of labelCandidates) {
    const p = project(scene);
    if (p.x < -6 || p.x > size.w + 6 || p.y < -5 || p.y > size.h + 5) continue;
    const width = Math.min(150, size.w - 10), left = Math.min(Math.max(5, p.x - width / 2), size.w - width - 5);
    for (const side of [-1, 1]) {
      const top = p.y + (side < 0 ? -81 : 24);
      if (top < 4 || top + 55 > size.h - 4 || labelSlots.some(r => top < r.top + 59 && top + 59 > r.top && left < r.left + width + 5 && left + width + 5 > r.left)) continue;
      labels.push({ scene, p, left, top, width, side }); labelSlots.push({ left, top }); break;
    }
  }
  const priorities = [...new Set([activeScene?.group?.key, ...labels.map(l => l.scene.group?.key), ...visible.map(s => s.group?.key)].filter(Boolean))].join(' ');
  useEffect(() => { onVisible(priorities ? priorities.split(' ') : []); }, [priorities, onVisible]);
  const activeVersion = selection.version ? map.points.get(selection.id) : null;
  const dots = cam.k >= 1.45 ? [...map.points.values()].filter(p => visibleAt(project(p), size)) : [];
  const choose = (scene, point) => { if (!suppressed.current) onSelect(scene, point); };
  const zoom = factor => setCamera(prev => zoomCamera(prev || fit, factor, { x: size.w / 2, y: size.h / 2 }, minimum));
  const pointerDown = e => {
    if (e.button !== 0 && e.button !== 1 || e.target.closest('.story-map-controls,.story-minimap')) return;
    suppressed.current = false;
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, cam };
    if (!e.target.closest('button')) { e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); }
  };
  const pointerMove = e => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!e.buttons) { drag.current = null; setDragging(false); return; }
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) < 4 && !suppressed.current) return;
    if (!suppressed.current && !e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
    suppressed.current = true; setDragging(true);
    setCamera({ ...d.cam, x: d.cam.x + dx, y: d.cam.y + dy });
  };
  const endDrag = () => { drag.current = null; setDragging(false); };
  const keys = e => {
    if (e.target !== view.current) return;
    const delta = { ArrowRight: [-80, 0], ArrowLeft: [80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[e.key];
    if (delta) setCamera(c => ({ ...(c || fit), x: (c || fit).x + delta[0], y: (c || fit).y + delta[1] }));
    else if (e.key === '+' || e.key === '=') zoom(1.5);
    else if (e.key === '-') zoom(1 / 1.5);
    else if (e.key === 'Home') setCamera(null);
    else return;
    e.preventDefault();
  };
  return <div ref={view} tabIndex={0} role="region" aria-label="Writing history map" className={'story-viewport' + (dragging ? ' dragging' : '')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={keys}>
    <svg className="story-network" aria-hidden="true">
      <g className="story-world" transform={'translate(' + cam.x + ' ' + cam.y + ') scale(' + cam.k + ')'}>
        {map.edges.map(e => <path key={e.from.item.revision + e.to.item.revision} d={connector(e.from, e.to)} className={'map-edge ' + (e.merge ? 'merged' : e.active ? 'active' : '')}/>)}
        {map.scenes.filter(s => s.members.length > 1).map(s => <path key={s.id} className={'map-span' + (s.onCurrentPath ? ' active' : '')} d={'M' + s.first.x + ',' + s.y + ' H' + s.last.x}/>)}
      </g>
      {visible.map(s => { const p = project(s); return <circle key={s.id} className={'map-knot' + (s.onCurrentPath ? ' active' : '') + (s === activeScene ? ' selected' : '')} cx={p.x} cy={p.y} r={s.current || s === activeScene ? 5 : 3.5}/>; })}
      {labels.map(({ scene, p, side }) => <path key={scene.id} className="map-stem" d={'M' + p.x + ',' + (p.y + side * 7) + ' v' + side * 17}/>)}
    </svg>
    {visible.filter(s => cam.k < 1.45 && visibleAt(project(s), size)).map(s => { const p = project(s); return <button key={s.id} className="map-hit" tabIndex={-1} style={{ left: p.x, top: p.y }} aria-label={'Select passage: ' + s.title} onClick={() => choose(s)}/>; })}
    {dots.map(p => { const screen = project(p); return <button key={p.item.revision} className={'map-version' + (p === activeVersion || p.current ? ' selected' : '')} style={{ left: screen.x, top: screen.y }} title={versionLabel(p.item)} aria-label={'Select version: ' + versionLabel(p.item)} onClick={() => choose(map.sceneOf.get(p.item.revision), p)}/>; })}
    {labels.map(({ scene: s, left, top, width }) => {
      const Icon = s.first.parentRevisions.length > 1 ? GitMerge : s.members.length > 1 ? Layers : GitBranch;
      return <button key={s.id} className={'map-caption' + (s === activeScene ? ' selected' : '')} style={{ left, top, width }} onClick={() => choose(s)} onDoubleClick={() => onSelect(s, null, true)} aria-label={'Passage: ' + s.title} aria-pressed={s === activeScene}>
        <span><Icon size={12}/>{s.current ? 'Current draft' : sceneSize(s)}</span><strong>{s.title}</strong></button>;
    })}
    <div className="story-map-controls" role="group" aria-label="Map navigation">
      <button title="Zoom out" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)} disabled={cam.k <= minimum}><Minus size={15}/></button>
      <button title="Zoom in" aria-label="Zoom in" onClick={() => zoom(1.5)} disabled={cam.k >= 6}><Plus size={15}/></button>
      <button onClick={() => setCamera(null)} title="Show all writing paths"><Maximize size={14}/>Fit all</button>
      <button onClick={onCurrent} title="Go to the current version"><Crosshair size={14}/>Current draft</button>
    </div>
    <MiniMap map={map} camera={cam} size={size} move={p => setCamera(centerCamera(p, cam.k, size.w, size.h))}/>
  </div>;
}
