import React, { useEffect, useReducer, useState } from 'react';
import { columnIsHeader, isInTable, rowIsHeader, selectedRect } from '@tiptap/pm/tables';
import {
  Check, Columns2, Eraser, Grid2X2Plus, PaintBucket, PanelLeft, PanelTop, RotateCcw,
  Rows2, SquareDashed, Table2, TableCellsMerge, TableCellsSplit, Trash2
} from 'lucide-react';
import TableSelectionGrid from './TableSelectionGrid';
import TableSizePicker from './TableSizePicker';
import './table-tools.css';

function ToolButton({ icon: Icon, label, children, title = label, ...props }) {
  return <button type="button" className="table-tool-button" aria-label={label} title={title} {...props}>
    <Icon size={16} aria-hidden="true" />{children}
  </button>;
}

function ColorControl({ label, inputLabel, icon: Icon, fallback, current, applyLabel, clearLabel, resetIcon, apply, canClear }) {
  const [color, setColor] = useState(/^#[0-9a-f]{6}$/i.test(current || '') ? current : fallback);
  return <div className="table-color-line">
    <label><Icon size={15} aria-hidden="true" /><span>{label}</span>
      <input type="color" aria-label={inputLabel} title={inputLabel} value={color} onChange={e => setColor(e.target.value)} /></label>
    <ToolButton icon={Check} label={applyLabel} onClick={() => apply(color)} />
    <ToolButton icon={resetIcon} label={clearLabel} onClick={() => apply(null)} disabled={!canClear} />
  </div>;
}

function TableInspector({ editor, rect, execute }) {
  const { map, table, tableStart } = rect;
  const cells = map.cellsInRect(rect);
  const first = table.nodeAt(cells[0]);
  function setColor(attribute, value) {
    execute(chain => chain.command(({ tr }) => {
      for (const offset of cells) {
        if (table.nodeAt(offset).attrs[attribute] !== value) tr.setNodeAttribute(tableStart + offset, attribute, value);
      }
      return true;
    }));
  }
  return <div className="table-inspector">
    <section><h3>Cells</h3><div className="table-tool-pair">
      <ToolButton icon={TableCellsMerge} label="Merge selected cells" title="Merge selected cells" disabled={!editor.can().mergeCells()} onClick={() => execute(c => c.mergeCells())}>Merge</ToolButton>
      <ToolButton icon={TableCellsSplit} label="Split cell" title="Split a merged cell" disabled={!editor.can().splitCell()} onClick={() => execute(c => c.splitCell())}>Split</ToolButton>
    </div></section>
    <section><h3>Headers</h3><div className="table-tool-pair">
      <ToolButton icon={PanelTop} label="Toggle header row" aria-pressed={rowIsHeader(map, table, 0)} onClick={() => execute(c => c.toggleHeaderRow())}>Top row</ToolButton>
      <ToolButton icon={PanelLeft} label="Toggle header column" aria-pressed={columnIsHeader(map, table, 0)} onClick={() => execute(c => c.toggleHeaderColumn())}>First column</ToolButton>
    </div></section>
    <section><h3>Cell colours</h3>
      <ColorControl key={'fill-' + first?.attrs.cellBackground} label="Fill" inputLabel="Cell background" icon={PaintBucket} fallback="#ffffcc" current={first?.attrs.cellBackground}
        applyLabel="Apply background" clearLabel="Clear background" resetIcon={Eraser}
        apply={value => setColor('cellBackground', value)} canClear={cells.some(pos => table.nodeAt(pos).attrs.cellBackground)} />
      <ColorControl key={'border-' + first?.attrs.cellBorder} label="Border" inputLabel="Cell border colour" icon={SquareDashed} fallback="#888888" current={first?.attrs.cellBorder}
        applyLabel="Apply border colour" clearLabel="Reset border" resetIcon={RotateCcw}
        apply={value => setColor('cellBorder', value)} canClear={cells.some(pos => table.nodeAt(pos).attrs.cellBorder)} />
    </section>
  </div>;
}

export default function TableTools({ Modal, editor, onClose }) {
  const inside = !!editor && !editor.isDestroyed && isInTable(editor.state);
  const [mode, setMode] = useState(inside ? 'edit' : 'new');
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const changed = ({ transaction }) => { if (transaction.selectionSet || transaction.docChanged) refresh(); };
    editor.on('transaction', changed);
    return () => editor.off('transaction', changed);
  }, [editor]);
  const editing = inside && mode === 'edit';
  const rect = editing ? selectedRect(editor.state) : null;

  function execute(command) {
    if (editor && !editor.isDestroyed && command(editor.chain().focus()).run()) onClose();
  }

  return <Modal title="Table tools" className="table-tools-dialog" onClose={onClose}>
    <div className="table-mode-bar">
      <div className="table-modes" role="group" aria-label="Table tools mode">
        <ToolButton icon={Table2} label="Edit table" aria-pressed={editing} disabled={!inside} data-initial-focus={editing || undefined} onClick={() => setMode('edit')}>Edit table</ToolButton>
        <ToolButton icon={Grid2X2Plus} label="New table" aria-pressed={!editing} data-initial-focus={!editing || undefined} onClick={() => setMode('new')}>New table</ToolButton>
      </div>
      {editing && <span className="table-shape">{rect.map.height} {rect.map.height === 1 ? 'row' : 'rows'}<span aria-hidden="true">·</span>{rect.map.width} {rect.map.width === 1 ? 'column' : 'columns'}</span>}
    </div>
    {editing ? <>
      <div className="table-workspace">
        <TableSelectionGrid editor={editor} rect={rect} execute={execute} />
        <TableInspector editor={editor} rect={rect} execute={execute} />
      </div>
      <footer className="table-tools-footer">
        <ToolButton icon={Rows2} label="Delete row" title="Delete selected rows" disabled={rect.bottom - rect.top === rect.map.height} onClick={() => execute(c => c.deleteRow())}>Delete row</ToolButton>
        <ToolButton icon={Columns2} label="Delete column" title="Delete selected columns" disabled={rect.right - rect.left === rect.map.width} onClick={() => execute(c => c.deleteColumn())}>Delete column</ToolButton>
        <button type="button" className="danger-button subtle table-remove" title="Remove the entire table and its contents" onClick={() => execute(c => c.deleteTable())}><Trash2 size={15} aria-hidden="true" />Remove table</button>
      </footer>
    </> : <TableSizePicker execute={execute} />}
  </Modal>;
}
