import React, { useMemo, useState } from 'react';
import { currentParagraphNumber, paragraphLocations, paragraphPreview } from './navigation.js';

export default function GoToParagraph({ doc, position, onGo, onCancel }) {
  const paragraphs = useMemo(() => paragraphLocations(doc), [doc]);
  const [value, setValue] = useState(() => String(currentParagraphNumber(doc, position) || 1));
  const number = Number(value), valid = Number.isSafeInteger(number) && number >= 1 && number <= paragraphs.length;
  return <form onSubmit={event => { event.preventDefault(); if (valid) onGo(number); }}>
    <label className="field-label" htmlFor="go-paragraph-number">Paragraph number</label>
    <input id="go-paragraph-number" className="field-input" type="number" data-autoselect aria-label="Paragraph number" aria-describedby="go-paragraph-range" aria-invalid={!valid} min="1" max={paragraphs.length || 1} step="1" value={value} onChange={event => setValue(event.target.value)} />
    <p id="go-paragraph-range" className="small-muted">1–{paragraphs.length.toLocaleString()} in this chapter. Numbers match the page margin.</p>
    <div className="go-paragraph-preview" role="status" aria-live="polite">{valid ? paragraphPreview(paragraphs[number - 1]) : 'Enter a paragraph number within this chapter.'}</div>
    <div className="modal-footer"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={!valid}>Go to paragraph</button></div>
  </form>;
}
