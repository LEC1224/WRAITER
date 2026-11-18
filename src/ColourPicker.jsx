import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Eraser, Highlighter, LockKeyhole, LockKeyholeOpen, Type } from 'lucide-react';
import { COLOUR_PRESETS, readPalette, updatePalette, writePalette } from './color-palettes.js';

// Imported colours can be CSS names or rgb(); native inputs require six-digit hex.
function hexColour(colour, fallback) {
  if (!colour || !CSS.supports('color', colour)) return fallback;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return fallback;
  context.fillStyle = colour;
  if (/^#[\da-f]{6}$/i.test(context.fillStyle)) return context.fillStyle.toLowerCase();
  context.fillRect(0, 0, 1, 1);
  return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
}

export default function ColourPicker({ kind, active, colour, onApply, onClear }) {
  const highlighting = kind === 'highlight', title = highlighting ? 'Highlight colour' : 'Text colour';
  const fallback = highlighting ? '#fff29b' : '#000000', suffix = highlighting ? 'highlight' : 'text colour';
  const [open, setOpen] = useState(false), [chosen, setChosen] = useState(fallback), [position, setPosition] = useState({});
  const [palette, setPalette] = useState(() => readPalette(kind));
  const control = useRef(), dropdown = useRef(), popup = useRef(), custom = useRef(), commitCustom = useRef(), focusAction = useRef();
  useEffect(() => { if (colour) setChosen(hexColour(colour, fallback)); }, [colour, fallback]);
  useEffect(() => { writePalette(kind, palette); }, [kind, palette]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = event => {
      if (event?.target instanceof Node && popup.current?.contains(event.target)) return;
      const rect = control.current.getBoundingClientRect(), width = Math.min(260, innerWidth - 24), height = popup.current.offsetHeight;
      const next = { left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), top: Math.max(12, Math.min(rect.bottom + 5, innerHeight - height - 12)), width };
      setPosition(previous => Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
    };
    place();
    popup.current.querySelector('button')?.focus({ preventScroll: true });
    const outside = event => { if (!popup.current?.contains(event.target) && !control.current?.contains(event.target)) setOpen(false); };
    const observer = new ResizeObserver(() => place());
    observer.observe(popup.current);
    document.addEventListener('mousedown', outside);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); document.removeEventListener('mousedown', outside); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!focusAction.current) return;
    const action = popup.current?.querySelector(`[data-colour-action="${focusAction.current}"]`);
    action?.focus({ preventScroll: true });
    action?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    focusAction.current = null;
  }, [palette]);
  const remember = value => setPalette(current => updatePalette(current, kind, 'remember', value));
  const apply = (value, close = true, record = true) => { setChosen(value); if (record) remember(value); onApply(value); if (close) setOpen(false); };
  const clear = () => { onClear(); setOpen(false); };
  const toggleLock = (value, locked) => {
    focusAction.current = `${locked ? 'lock' : 'unlock'}-${value}`;
    setPalette(current => updatePalette(current, kind, locked ? 'unlock' : 'lock', value));
  };
  // React onChange also fires for native input previews. Record only the native
  // change event so dragging through a colour dialog does not fill the history.
  commitCustom.current = value => apply(value, false);
  useEffect(() => {
    if (!open) return;
    const input = custom.current, commit = event => commitCustom.current(event.target.value);
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, [open]);
  const swatch = (value, name = value) => <button type="button" title={name === value ? value : `${name} (${value})`} aria-label={`${name} ${suffix}`} aria-pressed={chosen === value} className={'colour-swatch' + (chosen === value ? ' selected' : '')} style={{ '--colour-swatch': value }} onMouseDown={event => event.preventDefault()} onClick={() => apply(value)}><span /></button>;
  const customSwatches = (values, locked) => <div className="colour-grid" role="group" aria-label={locked ? 'Locked colours' : 'Recent custom colours'}>{values.map(value => <div className="colour-entry" key={value}>
    {swatch(value)}<button type="button" className="colour-lock" data-colour-action={`${locked ? 'unlock' : 'lock'}-${value}`} aria-label={`${locked ? 'Unlock' : 'Lock'} ${value}`} title={locked ? `Unlock ${value} and return it to history` : `Lock ${value} in the palette`} onMouseDown={event => event.preventDefault()} onClick={() => toggleLock(value, locked)}>{locked ? <LockKeyhole size={12} /> : <LockKeyholeOpen size={12} />}</button>
  </div>)}</div>;
  return <><div ref={control} className="colour-picker" style={{ '--colour-swatch': chosen }}>
    {highlighting && <button type="button" className={'icon-button colour-toggle' + (active ? ' active' : '')} aria-label="Highlight" aria-pressed={!!active} onMouseDown={event => event.preventDefault()} onClick={() => active ? clear() : apply(chosen, true, palette.recent.includes(chosen))} title={active ? 'Remove highlighting from the selection or next text you type.' : 'Apply the current highlight colour to the selection or next text you type.'}><Highlighter size={17} strokeWidth={1.7} /></button>}
    <button ref={dropdown} type="button" className={'icon-button ' + (highlighting ? 'colour-dropdown' : 'text-colour-dropdown')} style={highlighting ? undefined : { '--colour-swatch': colour || 'var(--text)' }} aria-label={title} aria-haspopup="dialog" aria-expanded={open} onMouseDown={event => event.preventDefault()} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }} title={`Choose a ${highlighting ? 'highlight' : 'text'} colour and apply it to the selection or next text you type.`}>{!highlighting && <Type size={17} />}<ChevronDown size={12} /></button>
  </div>{open && createPortal(<div ref={popup} className="colour-popup" role="dialog" aria-label={`${title}s`} style={position} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); dropdown.current?.focus(); }
    else if (event.key === 'Tab') {
      const controls = [...popup.current.querySelectorAll('button, input')];
      if (event.shiftKey ? event.target === controls[0] : event.target === controls.at(-1)) { setOpen(false); dropdown.current?.focus(); }
    }
  }}>
    <div className="colour-popup-title">{title}</div>
    <div className="colour-grid" role="group" aria-label="Default colours">{COLOUR_PRESETS[kind].map(([name, value]) => <React.Fragment key={value}>{swatch(value, name)}</React.Fragment>)}</div>
    {!!palette.locked.length && <><hr className="colour-divider" /><div className="colour-section-title">Locked colours</div>{customSwatches(palette.locked, true)}</>}
    <label className="colour-custom">Custom colour<input ref={custom} type="color" aria-label={highlighting ? 'Custom highlight colour' : 'Custom text colour'} value={chosen} onInput={event => apply(event.currentTarget.value, false, false)} onChange={() => {}} /></label>
    {!!palette.recent.length && <div className="colour-history"><div className="colour-section-title">Recent custom colours</div>{customSwatches(palette.recent, false)}</div>}
    <button type="button" className="colour-clear" onMouseDown={event => event.preventDefault()} onClick={clear} title={highlighting ? 'Remove the highlight or imported background colour while keeping other text formatting.' : 'Restore the automatic text colour while keeping other formatting.'}><Eraser size={16} />{highlighting ? 'No highlight' : 'Automatic text colour'}</button>
  </div>, document.body)}</>;
}
