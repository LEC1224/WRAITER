import React, { useState } from 'react';
import { normalizePrintLayout } from './print-layout.js';
export default function PageSetupDialog({ Modal, project, onApply, onClose }) {
  const [page, setPage] = useState(() => normalizePrintLayout(project.printLayout));
  return <Modal title="Page setup" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onApply(normalizePrintLayout(page)); }}>
      <div className="form-grid">
        <label>Paper size<select aria-label="Paper size" className="field-input" value={page.size} onChange={event => setPage({ ...page, size: event.target.value })}><option>A4</option><option>A5</option><option>Letter</option></select></label>
        <label>Orientation<select aria-label="Orientation" className="field-input" value={page.orientation} onChange={event => setPage({ ...page, orientation: event.target.value })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
        {['top', 'right', 'bottom', 'left'].map(side => {
          const label = `${side[0].toUpperCase() + side.slice(1)} margin (mm)`;
          return <label key={side}>{label}<input aria-label={label} className="field-input" type="number" min="8" max="60" step="0.1" required value={page[side]} onChange={event => setPage({ ...page, [side]: event.target.value })} /></label>;
        })}
        <label>Header<input aria-label="Header" className="field-input" maxLength="500" value={page.header} onChange={event => setPage({ ...page, header: event.target.value })} /></label>
        <label>Footer<input aria-label="Footer" className="field-input" maxLength="500" value={page.footer} onChange={event => setPage({ ...page, footer: event.target.value })} /></label>
      </div>
      <p className="small-muted">Saved with this manuscript and used for standard PDF, Word and OpenDocument exports. Use {'{page}'} and {'{pages}'} for page numbers.</p>
      <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" title="Save paper size, margins, header and footer settings for this manuscript.">Apply page setup</button></div>
    </form>
  </Modal>;
}
