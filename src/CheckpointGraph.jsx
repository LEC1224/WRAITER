import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Eye, GitBranch, GitMerge, Layers, ListTree, Minus, Plus, Search } from 'lucide-react';
import { checkpointGraph, checkpointWindows, matchesCheckpoint, projectCheckpointWindows } from './checkpoint-tree.js';
import CheckpointEdits from './CheckpointEdits.jsx';
import './checkpoint-graph.css';

const COLUMN = 302, ROW = 170, LEFT = 24, TOP = 24, CARD_WIDTH = 270, CARD_HEIGHT = 146;
const levels = ['Overview', 'Closer view', 'Every version'];
const date = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function CheckpointGraph({ history, projectId, journal, onPreview, onRestore, onMerge }) {
  const [query, setQuery] = useState(''), [detail, setDetail] = useState(0), [expanded, setExpanded] = useState(new Set());
  const [plans, setPlans] = useState({}), [inspect, setInspect] = useState(null);
  const scroller = useRef(null), requested = useRef(new Set()), focusRevision = useRef(history.headRevision);
  const graph = useMemo(() => checkpointGraph(history.entries, history.headRevision), [history.entries, history.headRevision]);
  const windows = useMemo(() => checkpointWindows(graph.rows, detail), [graph, detail]);
  const needle = query.trim().toLocaleLowerCase();
  const rows = useMemo(() => projectCheckpointWindows(graph.rows, windows, plans, expanded, needle), [graph, windows, plans, expanded, needle]);
  const positions = useMemo(() => new Map(rows.map(row => [row.item.revision, row])), [rows]);
  const matches = row => matchesCheckpoint(row.item, needle) || row.group && matchesCheckpoint(row.group, needle);
  const center = (row, behavior = 'smooth') => {
    const view = scroller.current;
    if (row && view) view.scrollTo({ left: Math.max(0, LEFT + row.lane * COLUMN - (view.clientWidth - CARD_WIDTH) / 2), top: Math.max(0, TOP + row.row * ROW - (view.clientHeight - CARD_HEIGHT) / 2), behavior });
  };
  const changeDetail = delta => {
    const view = scroller.current;
    const row = view && rows[Math.max(0, Math.min(rows.length - 1, Math.round((view.scrollTop + (view.clientHeight - CARD_HEIGHT) / 2 - TOP) / ROW)))];
    focusRevision.current = row?.item.revision || history.headRevision;
    setExpanded(new Set()); setDetail(value => Math.max(0, Math.min(2, value + delta)));
  };
  useLayoutEffect(() => {
    if (!focusRevision.current || inspect) return;
    const revision = focusRevision.current;
    center(positions.get(revision) || rows.find(row => row.group?.members.some(member => member.item.revision === revision)), 'instant');
    focusRevision.current = null;
  }, [rows, inspect]);
  useLayoutEffect(() => { if (needle && !inspect) center(rows.find(matches), 'instant'); }, [needle, inspect, rows]);
  useEffect(() => {
    const view = scroller.current;
    if (!view) return;
    const wheel = event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); changeDetail(event.deltaY < 0 ? 1 : -1); } };
    view.addEventListener('wheel', wheel, { passive: false });
    return () => view.removeEventListener('wheel', wheel);
  }, [rows, inspect]);
  useEffect(() => {
    const view = scroller.current, describe = window.wraiter.describeCheckpointRange;
    if (!view || !describe) return;
    const byKey = new Map(windows.map(range => [range.key, range]));
    const observer = new IntersectionObserver(entries => {
      for (const element of entries) {
        const key = element.target.dataset.range, range = byKey.get(key);
        if (!element.isIntersecting || !range || requested.current.has(key)) continue;
        requested.current.add(key);
        describe(projectId, range.members.map(row => row.item.revision)).then(sections => {
          if (sections?.length) setPlans(previous => ({ ...previous, [key]: sections }));
        }).catch(() => {});
      }
    }, { root: view, rootMargin: '200px' });
    for (const card of view.querySelectorAll('[data-range]')) observer.observe(card);
    return () => observer.disconnect();
  }, [windows, rows, projectId, inspect]);
  if (inspect) return <CheckpointEdits item={inspect} journal={journal} getRevision={window.wraiter.getGitRevision} onBack={() => { focusRevision.current = inspect.revision; setInspect(null); }}/>;
  const width = Math.max(320, LEFT * 2 + (graph.laneCount - 1) * COLUMN + CARD_WIDTH);
  const height = Math.max(320, TOP * 2 + (rows.length - 1) * ROW + CARD_HEIGHT);
  return <div className="checkpoint-graph-view">
    <div className="checkpoint-graph-toolbar revision-toolbar">
      <div className="revision-zoom" role="group" aria-label="History detail">
        <button aria-label="Zoom out" disabled={!detail} onClick={() => changeDetail(-1)}><Minus size={15}/></button>
        <span aria-live="polite">{levels[detail]}</span>
        <button aria-label="Zoom in" disabled={detail === 2} onClick={() => changeDetail(1)}><Plus size={15}/></button>
      </div>
      <div className="checkpoint-graph-tools">
        {!!expanded.size && <button className="text-button" onClick={() => setExpanded(new Set())}>Collapse groups</button>}
        <label className="history-search"><Search size={14}/><input className="field-input" type="search" aria-label="Find a version in the tree" placeholder="Find a version" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <button className="secondary-button" onClick={() => { setQuery(''); center(rows.find(row => row.current)); }}>Current version</button>
      </div>
    </div>
    {needle && !rows.some(matches) && <p className="small-muted" role="status">No versions match this search.</p>}
    <div className="checkpoint-graph-scroll" ref={scroller} aria-label="Complete version tree">
      <div className="checkpoint-graph-canvas" style={{ width, height }}>
        <svg className="checkpoint-graph-lines" width={width} height={height} aria-hidden="true">
          {rows.flatMap(row => row.parentRevisions.map((revision, index) => {
            const parent = positions.get(revision);
            if (!parent) return null;
            const fromX = LEFT + parent.lane * COLUMN + CARD_WIDTH / 2, fromY = TOP + parent.row * ROW + CARD_HEIGHT;
            const toX = LEFT + row.lane * COLUMN + CARD_WIDTH / 2, toY = TOP + row.row * ROW;
            const gutter = fromX + (toX < fromX ? -1 : 1) * (CARD_WIDTH / 2 + 10);
            const d = fromX === toX ? 'M ' + fromX + ' ' + fromY + ' V ' + toY : 'M ' + fromX + ' ' + fromY + ' v 9 H ' + gutter + ' V ' + (toY - 9) + ' H ' + toX + ' V ' + toY;
            return <path key={row.item.revision + revision} className={index ? 'merge-edge' : row.onCurrentPath && parent.onCurrentPath ? 'current-path' : ''} d={d}/>;
          }))}
        </svg>
        {rows.map(row => {
          const { item, group } = row, merged = row.parentRevisions.length > 1;
          const Icon = group ? Layers : merged ? GitMerge : GitBranch;
          const expand = () => { focusRevision.current = group.members[0].item.revision; setExpanded(value => new Set(value).add(focusRevision.current)); };
          return <article key={item.revision} data-range={group?.key} className={['checkpoint-graph-card', group && 'revision-group', row.current && 'current', row.onCurrentPath && 'current-path', needle && !matches(row) && 'dimmed'].filter(Boolean).join(' ')} style={{ left: LEFT + row.lane * COLUMN, top: TOP + row.row * ROW, width: CARD_WIDTH, height: CARD_HEIGHT }}>
            <div className="checkpoint-graph-card-heading"><Icon size={15}/><button onClick={group ? expand : () => onPreview(item)}><strong>{group?.title || item.title || item.message}</strong></button></div>
            <div className="checkpoint-meta"><Clock3 size={12}/>{group ? <span>{date(group.members[0].item.date)}{date(item.date) !== date(group.members[0].item.date) && ' – ' + date(item.date)}</span> : <time dateTime={item.date}>{new Date(item.date).toLocaleString()}</time>}</div>
            <p className="checkpoint-graph-card-summary">{group ? group.summary : item.summary || item.location}</p>
            <div className="revision-card-state">{group ? group.members.length + ' versions' : row.current ? 'Current version' : row.onCurrentPath ? 'Current path' : row.integrated ? 'Merged into current path' : 'Other path'}{merged && ' · Merge'}</div>
            <div className="checkpoint-graph-card-footer">
              {group ? <button className="text-button" onClick={expand}><ListTree size={13}/>Expand versions</button> : <>
                <button className="text-button" onClick={() => onPreview(item)}><Eye size={13}/>Preview</button>
                <button className="text-button" onClick={() => setInspect(item)}>Inspect edits</button>
                {!row.current && <button className="text-button" onClick={() => onRestore(item)}>Continue here</button>}
                {!row.integrated && onMerge && <button className="text-button" onClick={() => onMerge(item)}><GitMerge size={13}/>Merge…</button>}
              </>}
            </div>
          </article>;
        })}
      </div>
    </div>
  </div>;
}
