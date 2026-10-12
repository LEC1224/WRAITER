import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

export default function FontPicker({ value, fonts, onChange, label = 'Font family' }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [index, setIndex] = useState(0), [position, setPosition] = useState({});
  const button = useRef(), popup = useRef(), input = useRef(), list = useRef();
  const available = useMemo(() => [...new Set([value, ...fonts].filter(Boolean))], [value, fonts]);
  const names = useMemo(() => { const needle = query.toLocaleLowerCase(); return needle ? available.filter(font => font.toLocaleLowerCase().includes(needle)) : available; }, [available, query]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = event => {
      if (event?.target instanceof Node && popup.current?.contains(event.target)) return;
      const rect = button.current.getBoundingClientRect(), width = Math.min(340, innerWidth - 24);
      const below = Math.max(0, innerHeight - rect.bottom - 12), above = Math.max(0, rect.top - 12), upwards = below < Math.min(240, above);
      const next = { left: Math.max(8, Math.min(rect.left, innerWidth - width - 12)), top: upwards ? 'auto' : rect.bottom + 4, bottom: upwards ? innerHeight - rect.top + 4 : 'auto', width, maxHeight: Math.min(430, upwards ? above : below) };
      setPosition(previous => Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
    };
    place();
    input.current?.focus();
    const outside = event => { if (!popup.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => { list.current?.children[index]?.scrollIntoView({ block: 'nearest' }); }, [open, index, names]);
  const close = () => { setOpen(false); button.current?.focus({ preventScroll: true }); };
  const choose = font => { if (font) { close(); setQuery(''); onChange(font); } };
  return <><button ref={button} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" className="font-picker-button" style={{ fontFamily: value }} onClick={() => { setOpen(!open); setQuery(''); setIndex(0); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setQuery(''); setIndex(0); setOpen(true); } }}><span>{value}</span><ChevronDown size={13} /></button>
    {open && createPortal(<div ref={popup} className="font-picker-popup" style={position}><label className="font-picker-search"><Search size={14} /><input ref={input} autoFocus aria-label="Search fonts" value={query} placeholder="Find a font" onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } else if (event.key === 'Tab') close(); else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(current => Math.max(0, Math.min(names.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))); } else if (event.key === 'Enter') { event.preventDefault(); choose(names[index]); } }} /></label><div ref={list} className="font-picker-list" role="listbox" aria-label="Fonts">{names.map((font, i) => <button key={font} type="button" role="option" tabIndex={-1} aria-selected={value === font} className={i === index ? 'focused' : ''} style={{ fontFamily: font }} onMouseDown={event => event.preventDefault()} onClick={() => choose(font)}><span>{font}</span><span className="font-specimen">Aa</span></button>)}{!names.length && <p>No matching fonts.</p>}</div></div>, document.body)}
  </>;
}
