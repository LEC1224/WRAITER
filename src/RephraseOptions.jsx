import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function RephraseOptions({ editor, proposal, onChoose, onAccept, onDismiss, onRetry }) {
  const ref = useRef(null), [position, setPosition] = useState({ left: -10000, top: 0 });
  const items = proposal.alternatives;
  useLayoutEffect(() => {
    const surface = editor.view.dom, scroller = surface.closest('.writing-scroll');
    const place = () => {
      if (editor.isDestroyed || !ref.current) return;
      const anchor = editor.view.coordsAtPos(proposal.to, -1), bounds = scroller.getBoundingClientRect(), menu = ref.current.getBoundingClientRect();
      const left = Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - menu.width - 12));
      const top = anchor.bottom + menu.height + 10 < bounds.bottom ? anchor.bottom + 8 : Math.max(bounds.top + 8, anchor.top - menu.height - 8);
      setPosition({ left, top });
    };
    surface.setAttribute('aria-controls', 'rephrase-options'); surface.setAttribute('aria-expanded', 'true'); surface.setAttribute('aria-haspopup', 'listbox');
    place(); scroller.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    const observer = new ResizeObserver(place); observer.observe(ref.current);
    return () => { scroller.removeEventListener('scroll', place); window.removeEventListener('resize', place); observer.disconnect(); for (const name of ['aria-controls', 'aria-expanded', 'aria-haspopup', 'aria-activedescendant']) surface.removeAttribute(name); };
  }, [editor, proposal.to]);
  useLayoutEffect(() => { editor.view.dom.setAttribute('aria-activedescendant', `rephrase-option-${proposal.activeOption}`); ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [proposal.activeOption]);
  return createPortal(<div ref={ref} className="rephrase-menu" style={position} onMouseDown={event => event.preventDefault()}>
    <div className="rephrase-menu-heading"><strong>Rephrase / translate</strong><button aria-label="Dismiss rephrasing alternatives" onClick={onDismiss}>×</button></div>
    <div id="rephrase-options" role="listbox" aria-label="Rephrasing alternatives">{items.map((item, index) => <button key={index} id={`rephrase-option-${index}`} role="option" tabIndex={-1} aria-selected={index === proposal.activeOption} onMouseEnter={() => onChoose(index)} onClick={() => onAccept(index)}><span className="rephrase-option-text">{item.text}</span><span className="rephrase-rating" aria-label={item.rating ? `${item.rating} of 3 stars for context fit` : 'Not rated'} title="Model’s judgment of fit with the surrounding context">{item.rating ? <><span>{'★'.repeat(item.rating)}</span><span className="empty-stars">{'☆'.repeat(3 - item.rating)}</span></> : 'Unrated'}</span></button>)}</div>
    <div className="rephrase-menu-footer"><span>↑ ↓ Choose · Enter / Tab Accept · Esc Dismiss</span><button onClick={onRetry}>More alternatives</button></div>
    <small>Stars reflect the model’s judgment of context fit.</small>
  </div>, document.body);
}
