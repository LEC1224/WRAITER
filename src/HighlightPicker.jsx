import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Eraser, Highlighter } from 'lucide-react';

const colours = [
  ['Yellow', '#fff29b'], ['Green', '#8de5a1'], ['Blue', '#8bc7ff'], ['Pink', '#ff9ecb'],
  ['Orange', '#ffbe79'], ['Purple', '#c6adff'], ['Red', '#ff9292'], ['Grey', '#b9c0ca']
];

// Imported colours may use CSS names or rgb() rather than hex. The native
// colour input requires a six-digit hex value; the saved colour stays intact.
function hexColour(colour) {
  if (!colour || !CSS.supports('color', colour)) return '#fff29b';
  const context = document.createElement('canvas').getContext('2d');
  context.fillStyle = colour;
  if (/^#[\da-f]{6}$/i.test(context.fillStyle)) return context.fillStyle;
  context.fillRect(0, 0, 1, 1);
  return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
}

export default function HighlightPicker({ active, colour, onApply, onClear }) {
  const [open, setOpen] = useState(false), [chosen, setChosen] = useState('#fff29b'), [position, setPosition] = useState({});
  const control = useRef(), dropdown = useRef(), popup = useRef();
  useEffect(() => { if (colour) setChosen(hexColour(colour)); }, [colour]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = control.current.getBoundingClientRect(), width = Math.min(260, innerWidth - 24), height = popup.current.offsetHeight;
      setPosition({ left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), top: Math.max(12, Math.min(rect.bottom + 5, innerHeight - height - 12)), width });
    };
    place();
    popup.current.querySelector('button')?.focus();
    const outside = event => { if (!popup.current?.contains(event.target) && !control.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('resize', place); };
  }, [open]);
  const apply = (value, close = true) => { setChosen(value); onApply(value); if (close) setOpen(false); };
  const clear = () => { onClear(); setOpen(false); };
  return <><div ref={control} className="highlight-picker" style={{ '--highlight-swatch': chosen }}>
    <button type="button" className={'icon-button highlight-toggle' + (active ? ' active' : '')} title="Highlight" aria-label="Highlight" aria-pressed={!!active} onMouseDown={event => event.preventDefault()} onClick={() => active ? clear() : apply(chosen)}><Highlighter size={17} strokeWidth={1.7} /></button>
    <button ref={dropdown} type="button" className="icon-button highlight-dropdown" title="Highlight colour" aria-label="Highlight colour" aria-haspopup="dialog" aria-expanded={open} onMouseDown={event => event.preventDefault()} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><ChevronDown size={12} /></button>
  </div>{open && createPortal(<div ref={popup} className="highlight-popup" role="dialog" aria-label="Highlight colours" style={position} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); dropdown.current?.focus(); } }}>
    <div className="highlight-popup-title">Highlight colour</div>
    <div className="highlight-colours">{colours.map(([name, value]) => <button key={value} type="button" title={name} aria-label={`${name} highlight`} aria-pressed={chosen === value} className={chosen === value ? 'selected' : ''} style={{ '--highlight-swatch': value }} onMouseDown={event => event.preventDefault()} onClick={() => apply(value)}><span /></button>)}</div>
    <label className="highlight-custom">Custom colour<input type="color" aria-label="Custom highlight colour" value={chosen} onChange={event => apply(event.target.value, false)} /></label>
    <button type="button" className="highlight-clear" onMouseDown={event => event.preventDefault()} onClick={clear}><Eraser size={16} />No highlight</button>
  </div>, document.body)}</>;
}
