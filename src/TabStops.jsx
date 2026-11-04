import React, { useState } from 'react';
import { regularTabInterval } from './tabs.js';
import { applyParagraphLayout } from './paragraph-layout.js';
const cm = value => Math.round((Number(value || 0) * 2.54 / 72) * 100) / 100;
const pt = value => Math.round(Number(value) * 72 / 2.54 * 100) / 100;

export default function TabStops({ Modal, target, onClose }) {
  const [values, setValues] = useState({ leftIndent: cm(target.attrs.leftIndent), rightIndent: cm(target.attrs.rightIndent), firstLineIndent: cm(target.attrs.firstLineIndent), spaceBefore: target.attrs.spaceBefore || 0, spaceAfter: target.attrs.spaceAfter || 0, lineHeight: target.attrs.lineHeight || target.lineHeight, tabSpacing: cm(target.attrs.tabStops?.[0] || 36) });
  const [dirty, setDirty] = useState(new Set()), [error, setError] = useState('');
  const change = (name, value) => { setValues(old => ({ ...old, [name]: value })); setDirty(old => new Set([...old, name])); setError(''); };
  const customTabs = target.attrs.tabStops?.length && !regularTabInterval(target.attrs.tabStops);
  function save(event) {
    event.preventDefault(); const attrs = {};
    for (const name of dirty) attrs[name === 'tabSpacing' ? 'tabStops' : name] = name === 'tabSpacing' ? [pt(values.tabSpacing)] : name.endsWith('Indent') ? pt(values[name]) : Number(values[name]);
    if (!applyParagraphLayout(target, attrs)) { setError('The paragraph changed or a value is outside its range. Reopen the layout settings and try again.'); return; }
    onClose();
  }
  const input = (label, name, min, max, unit, step = 0.1) => <label>{label}<span className="layout-number"><input className="field-input" aria-label={label} type="number" min={min} max={max} step={step} required value={values[name]} onChange={event => change(name, event.target.value)} /><span>{unit}</span></span></label>;
  return <Modal title="Paragraph layout" subtitle={`Applies to ${target.positions.length === 1 ? 'the paragraph at your cursor.' : `${target.positions.length} selected paragraphs. Values shown are from the first; only changed fields are applied.`}`} onClose={onClose} wide className="paragraph-layout-dialog"><form onSubmit={save}>
    <div className="paragraph-layout-grid"><div>
      <fieldset><legend>Indents</legend><div className="form-grid">{input('Left indent', 'leftIndent', -5.08, 5.08, 'cm', 0.01)}{input('Right indent', 'rightIndent', -5.08, 5.08, 'cm', 0.01)}{input('First line', 'firstLineIndent', -5.08, 5.08, 'cm', 0.01)}</div><p className="small-muted">A positive first-line value moves the first line in. A negative value makes a hanging indent.</p></fieldset>
      <fieldset><legend>Spacing</legend><div className="form-grid">{input('Before paragraph', 'spaceBefore', 0, 72, 'pt', 0.01)}{input('After paragraph', 'spaceAfter', 0, 72, 'pt', 0.01)}{input('Line spacing', 'lineHeight', 1, 3, '×', 0.01)}</div></fieldset>
      <fieldset><legend>Tabs</legend>{input('Tab spacing', 'tabSpacing', 0.1, 10, 'cm', 0.01)}<p className="small-muted">Each tab aligns text to the next evenly spaced stop. Use Tools → Insert tab character; your Tab key can still request AI suggestions.</p>{!!customTabs && <p className="review-issue">This paragraph has uneven Office tab stops. They stay as saved unless you change Tab spacing; evenly spaced stops display consistently in the editor and PDF.</p>}</fieldset>
    </div><div className="layout-preview-column"><strong>Preview</strong><div className="paragraph-preview" aria-label="Paragraph layout preview"><div className="layout-ruler" aria-hidden="true">{[0, 2, 4, 6, 8, 10, 12, 14, 16].map(value => <span key={value}>{value}</span>)}<small>cm</small></div><div className="layout-preview-copy"><p style={{ marginLeft: `${Number(values.leftIndent) / 16 * 100}%`, marginRight: `${Number(values.rightIndent) / 16 * 100}%`, textIndent: `${Number(values.firstLineIndent) / 16 * 100}%`, lineHeight: Number(values.lineHeight), paddingTop: `${Number(values.spaceBefore) / 3}px`, paddingBottom: `${Number(values.spaceAfter) / 3}px` }}>A paragraph begins here. Adjust the indents and spacing to see how the first line and the remaining lines sit on the page. Your words stay the same.</p></div><div className="tab-preview" style={{ tabSize: `${Math.max(0.1, Number(values.tabSpacing)) * 16}px` }}>One{'\t'}Two{'\t'}Three</div></div><p className="small-muted">Illustrative preview. The editor uses your document font and width.</p><button type="button" className="text-button" onClick={() => { if (applyParagraphLayout(target, { leftIndent: null, rightIndent: null, firstLineIndent: null, spaceBefore: null, spaceAfter: null, lineHeight: null, tabStops: null })) onClose(); else setError('The manuscript changed. Reopen paragraph layout.'); }} title="Reset indents, spacing and tab stops for the targeted paragraphs to their style defaults.">Reset to style defaults</button></div></div>
    {error && <p role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={!dirty.size} title="Apply only the fields you changed to the targeted paragraphs.">Apply layout</button></div>
  </form></Modal>;
}
