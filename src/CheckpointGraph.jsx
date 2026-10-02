import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Eye, GitBranch, Search } from 'lucide-react';
import { checkpointGraph } from './checkpoint-tree.js';

const COLUMN = 280, ROW = 154, LEFT = 24, TOP = 24, CARD_WIDTH = 248, CARD_HEIGHT = 128;

export default function CheckpointGraph({ history, onPreview, onRestore }) {
  const [query, setQuery] = useState('');
  const scroller = useRef(null);
  const { rows, laneCount } = useMemo(() => checkpointGraph(history.entries, history.headRevision), [history.entries, history.headRevision]);
  const positions = useMemo(() => new Map(rows.map(row => [row.item.revision, row])), [rows]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = row => [row.item.title, row.item.message, row.item.summary, row.item.location, row.item.date].some(value => String(value || '').toLocaleLowerCase().includes(needle));
  const center = (row, behavior = 'smooth') => {
    if (!row || !scroller.current) return;
    const view = scroller.current;
    view.scrollTo({ left: Math.max(0, LEFT + row.lane * COLUMN - (view.clientWidth - CARD_WIDTH) / 2), top: Math.max(0, TOP + row.row * ROW - (view.clientHeight - CARD_HEIGHT) / 2), behavior });
  };
  useEffect(() => { const frame = requestAnimationFrame(() => center(rows.find(row => row.current), 'instant')); return () => cancelAnimationFrame(frame); }, [rows]);
  const width = Math.max(320, LEFT * 2 + (laneCount - 1) * COLUMN + CARD_WIDTH);
  const height = Math.max(320, TOP * 2 + (rows.length - 1) * ROW + CARD_HEIGHT + 300);
  return <div className="checkpoint-graph-view">
    <div className="checkpoint-graph-toolbar">
      <p className="small-muted">Each line leads from a saved version to the next. The blue path is your current draft.</p>
      <div className="checkpoint-graph-tools"><label className="history-search"><Search size={14} /><input className="field-input" type="search" aria-label="Find a version in the tree" placeholder="Find a version" value={query} onChange={event => { const value = event.target.value; setQuery(value); const term = value.trim().toLocaleLowerCase(); if (term) center(rows.find(row => [row.item.title, row.item.message, row.item.summary, row.item.location].some(text => String(text || '').toLocaleLowerCase().includes(term)))); }} /></label><button className="secondary-button" onClick={() => center(rows.find(row => row.current))}>Current version</button></div>
    </div>
    <div className="checkpoint-graph-scroll" ref={scroller} aria-label="Complete version tree">
      <div className="checkpoint-graph-canvas" style={{ width, height }}>
        <svg className="checkpoint-graph-lines" width={width} height={height} aria-hidden="true">
          {rows.map(row => {
            const parent = positions.get(row.parentRevision);
            if (!parent) return null;
            const fromX = LEFT + parent.lane * COLUMN + CARD_WIDTH / 2, fromY = TOP + parent.row * ROW + CARD_HEIGHT;
            const toX = LEFT + row.lane * COLUMN + CARD_WIDTH / 2, toY = TOP + row.row * ROW;
            const bend = Math.min(toY - 10, fromY + 14);
            return <path key={row.item.revision} className={row.onCurrentPath && parent.onCurrentPath ? 'current-path' : ''} d={fromX === toX ? `M ${fromX} ${fromY} V ${toY}` : `M ${fromX} ${fromY} V ${bend} H ${toX} V ${toY}`} />;
          })}
        </svg>
        {rows.map(row => {
          const item = row.item, dimmed = needle && !matches(row);
          return <article key={item.revision} className={`checkpoint-graph-card${row.current ? ' current' : ''}${row.onCurrentPath ? ' current-path' : ''}${dimmed ? ' dimmed' : ''}`} style={{ left: LEFT + row.lane * COLUMN, top: TOP + row.row * ROW }}>
            <div className="checkpoint-graph-card-heading"><GitBranch size={13} /><button onClick={() => onPreview?.(item)}><strong>{item.title || item.message}</strong></button></div>
            <div className="checkpoint-meta"><Clock3 size={12} /><time dateTime={item.date}>{new Date(item.date).toLocaleString()}</time></div>
            <p className="checkpoint-graph-card-summary">{item.summary || item.location || 'Saved manuscript version'}</p>
            <div className="checkpoint-graph-card-footer"><span>{row.current ? 'Current version' : row.onCurrentPath ? 'Current path' : 'Other path'}</span><button className="text-button" onClick={() => onPreview?.(item)}><Eye size={13} />Preview</button>{!row.current && <button className="text-button" onClick={() => onRestore?.(item)}>Continue here</button>}</div>
          </article>;
        })}
      </div>
    </div>
  </div>;
}
