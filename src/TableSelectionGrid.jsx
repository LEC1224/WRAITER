import React, { useEffect, useMemo, useRef } from 'react';
import { Plus, Scan } from 'lucide-react';
import { contrastRatio } from './highlight-appearance';

function columnName(index) {
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + (n - 1) % 26) + label;
  }
  return label;
}

function address(column, row) {
  return columnName(column) + (row + 1);
}

function InsertControl({ position, label, children, onClick }) {
  return <button type="button" className={'table-insert-control insert-' + position} aria-label={label} title={label} onClick={onClick}>
    <Plus size={15} aria-hidden="true" />{children}
  </button>;
}

const directions = { ArrowUp: ['vert', -1], ArrowDown: ['vert', 1], ArrowLeft: ['horiz', -1], ArrowRight: ['horiz', 1] };

export default function TableSelectionGrid({ editor, rect, execute }) {
  const { map, table, tableStart } = rect;
  const selection = editor.state.selection;
  const first = map.map[rect.top * map.width + rect.left];
  const anchor = selection.$anchorCell ? selection.$anchorCell.pos - tableStart : first;
  const head = selection.$headCell ? selection.$headCell.pos - tableStart : first;
  const selected = new Set(map.cellsInRect(rect));
  const scrollArea = useRef(null);
  const drag = useRef(null);
  useEffect(() => {
    const endDrag = () => { drag.current = null; };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);
  const columns = Array.from({ length: map.width }, (_, i) => columnName(i));
  const rows = useMemo(() => {
    const positions = new Map();
    map.map.forEach((offset, i) => { if (!positions.has(offset)) positions.set(offset, i); });
    const result = [];
    table.forEach((row, rowOffset) => {
      const cells = [];
      row.forEach((cell, cellOffset) => {
        const offset = rowOffset + 1 + cellOffset;
        const index = positions.get(offset);
        if (index === undefined) return;
        const left = index % map.width, top = Math.floor(index / map.width);
        const { cellBackground, cellBorder, colspan, rowspan } = cell.attrs;
        const style = { '--map-fill': cellBackground, '--map-border': cellBorder };
        if (cellBackground) style['--map-ink'] = contrastRatio('#000000', cellBackground) >= contrastRatio('#ffffff', cellBackground) ? '#000' : '#fff';
        cells.push({ cell, offset, name: address(left, top), left, top, right: left + colspan, bottom: top + rowspan, style });
      });
      result.push(cells);
    });
    return result;
  }, [table, map]);

  function buttonFor(offset) {
    return scrollArea.current?.querySelector('[data-cell-offset="' + offset + '"]');
  }

  useEffect(() => {
    const cell = buttonFor(head);
    const area = scrollArea.current;
    if (!cell || !area) return;
    const box = cell.getBoundingClientRect(), viewport = area.getBoundingClientRect();
    if (box.left < viewport.left + 27) area.scrollLeft += box.left - viewport.left - 27;
    else if (box.right > viewport.right) area.scrollLeft += box.right - viewport.right;
    if (box.top < viewport.top + 23) area.scrollTop += box.top - viewport.top - 23;
    else if (box.bottom > viewport.bottom) area.scrollTop += box.bottom - viewport.bottom;
  }, [head]);

  function select(from, to) {
    editor.commands.setCellSelection({ anchorCell: tableStart + from, headCell: tableStart + to });
  }

  function navigate(event, offset) {
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const next = map.nextCell(offset, ...direction);
    if (next == null) return;
    select(event.shiftKey ? anchor : next, next);
    buttonFor(next)?.focus({ preventScroll: true });
  }

  const start = address(rect.left, rect.top), end = address(rect.right - 1, rect.bottom - 1);
  const range = start === end ? start : start + ':' + end;
  return <section className="table-selection-panel" aria-label="Table selection">
    <div className="table-section-heading"><h3>Table layout</h3><output aria-label="Selected range" className="table-range"><Scan size={13} aria-hidden="true" />{range}</output></div>
    <div className="table-compass">
      <InsertControl position="above" label="Add row above" onClick={() => execute(c => c.addRowBefore())}>Row above</InsertControl>
      <InsertControl position="left" label="Add column before" onClick={() => execute(c => c.addColumnBefore())}>Column left</InsertControl>
      <div className="table-map-scroll" ref={scrollArea}>
        <table className="table-map" style={{ minWidth: 27 + map.width * 57 }} aria-label="Select table cells" aria-describedby="table-range-help">
          <colgroup><col className="table-axis-col" />{columns.map(col => <col key={col} />)}</colgroup>
          <thead><tr><td className="table-axis-corner" />{columns.map((col, i) => <th key={col} scope="col" className={i >= rect.left && i < rect.right ? 'axis-selected' : undefined}>{col}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i}>
            <th className={i >= rect.top && i < rect.bottom ? 'axis-selected' : undefined} scope="row">{i + 1}</th>
            {row.map(({ cell, offset, name, left, right, top, bottom, style }) => {
              const active = selected.has(offset);
              const content = cell.textContent;
              return <td key={offset} colSpan={cell.attrs.colspan} rowSpan={cell.attrs.rowspan} style={style}
                className={cell.type.spec.tableRole === 'header_cell' ? 'map-header' : undefined} data-selected={active || undefined}
                data-top={active && top === rect.top || undefined} data-bottom={active && bottom === rect.bottom || undefined}
                data-left={active && left === rect.left || undefined} data-right={active && right === rect.right || undefined}>
                <button type="button" data-cell-offset={offset} aria-label={'Select ' + name + (content ? ', ' + content : '')} aria-pressed={active}
                  tabIndex={head === offset ? 0 : -1} title={content ? name + ' · ' + content : name} onKeyDown={e => navigate(e, offset)}
                  onPointerDown={e => {
                    if (e.pointerType !== 'mouse' || e.button !== 0) return;
                    drag.current = e.shiftKey ? anchor : offset;
                    select(drag.current, offset);
                  }}
                  onPointerEnter={e => {
                    if (e.buttons === 1 && drag.current !== null) select(drag.current, offset);
                  }}
                  onClick={e => {
                    if (e.detail === 0 || e.nativeEvent.pointerType !== 'mouse') select(e.shiftKey ? anchor : offset, offset);
                  }}>
                  {content || <span aria-hidden="true" className="empty-table-cell">·</span>}
                </button>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <InsertControl position="right" label="Add column after" onClick={() => execute(c => c.addColumnAfter())}>Column right</InsertControl>
      <InsertControl position="below" label="Add row below" onClick={() => execute(c => c.addRowAfter())}>Row below</InsertControl>
    </div>
    <p className="table-range-help" id="table-range-help">Drag or Shift-click to select a range.</p>
  </section>;
}
