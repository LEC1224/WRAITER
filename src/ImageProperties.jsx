import React, { useState } from 'react';

export default function ImageProperties({ Modal, image, onApply, onClose }) {
  const [description, setDescription] = useState(image.attrs.alt || '');
  const [width, setWidth] = useState(String(image.width)), [height, setHeight] = useState(String(image.height));
  const [locked, setLocked] = useState(true), [error, setError] = useState('');
  const ratio = image.width / image.height;
  function dimension(value, horizontal) {
    (horizontal ? setWidth : setHeight)(value);
    if (locked && Number(value) > 0) (horizontal ? setHeight : setWidth)(String(Math.max(1, Math.round(horizontal ? Number(value) / ratio : Number(value) * ratio))));
  }
  return <Modal title="Image properties" onClose={onClose}><form onSubmit={event => {
    event.preventDefault();
    const size = { width: Number(width), height: Number(height) };
    if (Object.values(size).some(value => !Number.isInteger(value) || value < 1 || value > 16000) || size.width * size.height > 32000000) { setError('Choose whole pixel dimensions from 1 to 16,000, up to 32 million pixels.'); return; }
    if (onApply({ ...size, alt: description }) === false) setError('The image changed. Close this dialog and select it again.');
  }}>
    <label className="field-label" htmlFor="image-description">Description</label><input id="image-description" className="field-input" aria-label="Image description" value={description} maxLength={2000} onChange={event => setDescription(event.target.value)} />
    <p className="small-muted">Describe the picture for readers using assistive technology.</p>
    <div className="form-grid"><label>Width (pixels)<input className="field-input" aria-label="Image width" type="number" min="1" max="16000" value={width} onChange={event => dimension(event.target.value, true)} /></label><label>Height (pixels)<input className="field-input" aria-label="Image height" type="number" min="1" max="16000" value={height} onChange={event => dimension(event.target.value, false)} /></label></div>
    <label className="check-label"><input type="checkbox" checked={locked} onChange={event => setLocked(event.target.checked)} />Keep proportions</label>
    {error && <p role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">Apply image properties</button></div>
  </form></Modal>;
}
