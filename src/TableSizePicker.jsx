import React, { useRef, useState } from 'react';
import { Grid2X2Plus, PanelTop, Table2 } from 'lucide-react';

const gridRows = 6, gridColumns = 8;
const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

export default function TableSizePicker({ execute }) {
  const [rows, setRows] = useState(3), [columns, setColumns] = useState(3);
  const [header, setHeader] = useState(true), [hover, setHover] = useState(null);
  const grid = useRef(null);
  const r = Number(rows), c = Number(columns);
  const valid = Number.isInteger(r) && Number.isInteger(c) && r >= 1 && r <= 50 && c >= 1 && c <= 20;
  const shownRows = hover?.[0] ?? r, shownColumns = hover?.[1] ?? c;
  const tabRow = Math.min(Math.max(Math.trunc(r) || 1, 1), gridRows), tabColumn = Math.min(Math.max(Math.trunc(c) || 1, 1), gridColumns);

  function choose(row, col) {
    setRows(row);
    setColumns(col);
    setHover(null);
  }

  function navigate(event, row, col) {
    const delta = arrows[event.key];
    if (!delta) return;
    event.preventDefault();
    const nextRow = Math.max(1, Math.min(gridRows, row + delta[0]));
    const nextCol = Math.max(1, Math.min(gridColumns, col + delta[1]));
    choose(nextRow, nextCol);
    grid.current.children[(nextRow - 1) * gridColumns + nextCol - 1]?.focus();
  }

  return <form onSubmit={event => {
    event.preventDefault();
    if (valid) execute(chain => chain.insertTable({ rows: r, cols: c, withHeaderRow: header }));
  }}>
    <div className="table-workspace table-new-workspace">
      <section className="table-selection-panel table-picker-panel" aria-label="Choose table size">
        <div className="table-section-heading"><h3>Table size</h3><output aria-label="Preview size" className="table-range"><Table2 size={13} aria-hidden="true" />{shownRows || '–'} × {shownColumns || '–'}</output></div>
        <div className="table-size-grid" role="group" aria-label="Size picker, rows by columns" ref={grid}
          onPointerLeave={() => setHover(null)}>
          {Array.from({ length: gridRows * gridColumns }, (_, i) => {
            const row = Math.floor(i / gridColumns) + 1, col = i % gridColumns + 1;
            const marked = row <= shownRows && col <= shownColumns;
            return <button key={i} type="button" aria-label={row + (row === 1 ? ' row by ' : ' rows by ') + col + (col === 1 ? ' column' : ' columns')}
              aria-pressed={row === r && col === c} tabIndex={row === tabRow && col === tabColumn ? 0 : -1}
              className={marked ? (header && row === 1 ? 'picked picked-header' : 'picked') : undefined}
              onPointerEnter={event => { if (event.pointerType === 'mouse') setHover([row, col]); }}
              onKeyDown={event => navigate(event, row, col)} onClick={() => choose(row, col)} />;
          })}
        </div>
      </section>
      <div className="table-inspector table-dimensions">
        <section><h3>Dimensions</h3>
          <label>Rows<input className="field-input" type="number" min="1" max="50" required value={rows} onChange={e => { setRows(e.target.value); setHover(null); }} /></label>
          <label>Columns<input className="field-input" type="number" min="1" max="20" required value={columns} onChange={e => { setColumns(e.target.value); setHover(null); }} /></label>
        </section>
        <section><h3>Headers</h3><label className="table-header-option"><PanelTop size={16} aria-hidden="true" />Header row<input type="checkbox" checked={header} onChange={e => setHeader(e.target.checked)} /></label></section>
      </div>
    </div>
    <footer className="table-tools-footer table-new-footer"><button className="primary-button" type="submit" disabled={!valid}><Grid2X2Plus size={16} aria-hidden="true" />Insert table</button></footer>
  </form>;
}
