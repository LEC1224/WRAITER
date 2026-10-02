import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function RephraseRating({ rating, id }) {
  return <span id={id} className="rephrase-rating" aria-label={rating ? `${rating} of 3 stars for context fit` : 'Not rated'} title="Model’s judgment of fit with the surrounding context">{rating ? <><span>{'★'.repeat(rating)}</span><span className="empty-stars">{'☆'.repeat(3 - rating)}</span></> : 'Unrated'}</span>;
}

export default function RephraseOptions({ editor, proposal, onChoose, onAccept, onDismiss, onRetry, onRefine }) {
  const ref = useRef(null), [position, setPosition] = useState({ left: -10000, top: 0 });
  const vibeInput = useRef(null), [describingVibe, setDescribingVibe] = useState(false), [vibe, setVibe] = useState(proposal.vibe || '');
  const items = proposal.alternatives;
  const translating = proposal.suggestionKind === 'translation', correcting = proposal.mode === 'correct';
  const title = translating ? 'Translate' : correcting ? 'Spelling / grammar' : 'Rephrase / translate';
  const listLabel = translating ? 'Translation alternatives' : correcting ? 'Correction alternatives' : 'Rephrasing alternatives';
  const highestAlternative = items.length && items.every(item => item.rating != null) ? Math.max(...items.map(item => item.rating)) : null;
  const standing = proposal.currentRating != null && highestAlternative != null && proposal.currentRating >= highestAlternative ? (proposal.currentRating > highestAlternative ? 'Highest rated' : 'Tied highest') : '';
  useLayoutEffect(() => {
    const surface = editor.view.dom, scroller = surface.closest('.writing-scroll');
    const place = () => {
      if (editor.isDestroyed || !ref.current) return;
      const anchor = editor.view.coordsAtPos(proposal.to, -1), bounds = scroller.getBoundingClientRect(), menu = ref.current.getBoundingClientRect();
      const left = Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - menu.width - 12));
      const top = anchor.bottom + menu.height + 10 < bounds.bottom ? anchor.bottom + 8 : Math.max(bounds.top + 8, anchor.top - menu.height - 8);
      setPosition({ left, top, maxHeight: bounds.height - 16 });
    };
    surface.setAttribute('aria-controls', 'rephrase-options'); surface.setAttribute('aria-expanded', 'true'); surface.setAttribute('aria-haspopup', 'listbox');
    place(); scroller.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    const observer = new ResizeObserver(place); observer.observe(ref.current);
    return () => { scroller.removeEventListener('scroll', place); window.removeEventListener('resize', place); observer.disconnect(); for (const name of ['aria-controls', 'aria-expanded', 'aria-haspopup', 'aria-activedescendant']) surface.removeAttribute(name); };
  }, [editor, proposal.to]);
  useLayoutEffect(() => {
    if (items.length) editor.view.dom.setAttribute('aria-activedescendant', `rephrase-option-${proposal.activeOption}`);
    else editor.view.dom.removeAttribute('aria-activedescendant');
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [editor, proposal.activeOption, items.length]);
  useLayoutEffect(() => { if (describingVibe) vibeInput.current?.focus(); }, [describingVibe]);
  const closeVibe = () => { setDescribingVibe(false); setVibe(proposal.vibe || ''); editor.view.focus(); };
  return createPortal(<div ref={ref} className="rephrase-menu" style={position} onMouseDown={event => { if (!event.target.closest('.rephrase-vibe-form')) event.preventDefault(); }}>
    <div className="rephrase-menu-heading"><div><strong>{title}</strong><div className="rephrase-current-rating" role="group" aria-label="Current phrase rating"><span>Current phrase rating:</span><RephraseRating rating={proposal.currentRating} />{standing && <span className="rephrase-rating-standing" title="Compared with the shown alternatives">{standing}</span>}</div></div><button aria-label={`Dismiss ${listLabel.toLowerCase()}`} onClick={onDismiss}>×</button></div>
    <div id="rephrase-options" role="listbox" aria-label={listLabel}>{items.map((item, index) => <button key={index} id={`rephrase-option-${index}`} role="option" tabIndex={-1} aria-selected={index === proposal.activeOption} aria-labelledby={`rephrase-option-text-${index}`} aria-describedby={`${item.description ? `rephrase-description-${index} ` : ''}rephrase-rating-${index}`} onMouseEnter={() => onChoose(index)} onClick={() => onAccept(index)}>
      <span className="rephrase-option-copy"><span id={`rephrase-option-text-${index}`} className="rephrase-option-text">{item.text}</span>{item.description && <span id={`rephrase-description-${index}`} className="rephrase-option-description">{item.description}</span>}</span>
      <RephraseRating id={`rephrase-rating-${index}`} rating={item.rating} />
    </button>)}</div>
    {!items.length && <p className="rephrase-no-alternatives" role="status">No different wording suggested. Keep this phrase or request another set.</p>}
    <div className="rephrase-menu-footer"><span>{describingVibe ? 'Esc Back to options' : items.length ? '↑ ↓ Choose · Enter / Tab Accept · Esc Dismiss' : 'Enter / Tab Keep wording · Esc Dismiss'}</span><div className="rephrase-menu-links"><button onClick={onRetry}>More alternatives</button>{!correcting && <button aria-expanded={describingVibe} aria-controls="rephrase-vibe-form" onClick={() => describingVibe ? closeVibe() : setDescribingVibe(true)}>Describe your vibe</button>}</div></div>
    {describingVibe && <form id="rephrase-vibe-form" className="rephrase-vibe-form" onSubmit={event => { event.preventDefault(); if (vibe.trim()) onRefine(vibe.trim()); }} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); closeVibe(); } }}>
      <label htmlFor="rephrase-vibe">Describe your vibe</label>
      <p id="rephrase-vibe-hint">What should the reader feel or notice in this selection?</p>
      <textarea ref={vibeInput} id="rephrase-vibe" aria-describedby="rephrase-vibe-hint" rows={3} maxLength={2000} value={vibe} onChange={event => setVibe(event.target.value)} placeholder="Guide the tone, imagery, or point of view…" />
      <div className="rephrase-vibe-actions"><button type="button" className="rephrase-vibe-cancel" onClick={closeVibe}>Cancel</button><button type="submit" className="primary-button" disabled={!vibe.trim()}>Find alternatives</button></div>
    </form>}
    <small>Notes and stars reflect the model’s reading of the context.</small>
  </div>, document.body);
}
