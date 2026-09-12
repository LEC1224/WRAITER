import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

export default function FontPicker({ value, fonts, onChange, label = 'Font family' }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [index, setIndex] = useState(0), [position, setPosition] = useState({});
  const button = useRef(), popup = useRef(), input = useRef(), list = useRef();
  const names = [...new Set([value, ...fonts].filter(Boolean))].filter(font => font.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => {
    if (!open) return;
    const rect = button.current.getBoundingClientRect(), width = Math.min(340, innerWidth - 24);
    setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - width - 12)), top: rect.bottom + 4, width, maxHeight: Math.max(140, Math.min(430, innerHeight - rect.bottom - 20)) });
    input.current?.focus();
    const outside = event => { if (!popup.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => { list.current?.children[index]?.scrollIntoView({ block: 'nearest' }); }, [index]);
  const choose = font => { if (font) { setOpen(false); setQuery(''); onChange(font); } };
  return <><button ref={button} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" className="font-picker-button" style={{ fontFamily: value }} onClick={() => { setOpen(!open); setQuery(''); setIndex(0); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><span>{value}</span><ChevronDown size={13} /></button>
    {open && createPortal(<div ref={popup} className="font-picker-popup" style={position}><label className="font-picker-search"><Search size={14} /><input ref={input} autoFocus aria-label="Search fonts" value={query} placeholder="Find a font" onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(current => Math.max(0, Math.min(names.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))); } else if (event.key === 'Enter') { event.preventDefault(); choose(names[index]); } }} /></label><div ref={list} className="font-picker-list" role="listbox" aria-label="Fonts">{names.map((font, i) => <button key={font} type="button" role="option" aria-selected={value === font} className={i === index ? 'focused' : ''} style={{ fontFamily: font }} onMouseDown={event => event.preventDefault()} onClick={() => choose(font)}><span>{font}</span><span className="font-specimen">Aa</span></button>)}{!names.length && <p>No matching fonts.</p>}</div></div>, document.body)}
  </>;
}
