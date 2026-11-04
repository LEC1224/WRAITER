import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { aiGrammarKey } from './ai-grammar.js';
import { PROOFREAD_CATEGORIES } from './proofreading.js';

function placeCard(card, rect) {
  if (!card) return;
  const gap = 6, edge = 8, { offsetWidth: width, offsetHeight: height } = card;
  const below = rect.bottom + gap, above = rect.top - gap - height;
  card.style.left = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge)) + 'px';
  card.style.top = Math.max(edge, Math.min(below + height + edge <= window.innerHeight ? below : above, window.innerHeight - height - edge)) + 'px';
}

// A passive preview of a finding already in the editor.
function GrammarHover({ editor }) {
  const box = useRef(null), [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const root = editor.view.dom;
    let candidate = null, visible = false, showTimer, hideTimer;
    const markAt = node => node instanceof Element && root.contains(node) ? node.closest('[data-ai-grammar-id]') : null;
    const inBox = node => node instanceof Node && box.current?.contains(node);
    const live = () => candidate?.mark.isConnected && !editor.isDestroyed && aiGrammarKey.getState(editor.state)?.hints.includes(candidate.hint);
    function hide() {
      clearTimeout(showTimer); clearTimeout(hideTimer); candidate = null;
      if (visible) { visible = false; setPreview(null); }
    }
    function show() {
      if (!live()) { hide(); return; }
      const { mark, hint, x, y } = candidate;
      // Anchor to the hovered line, even if a long hint wraps or crosses formatting.
      const rect = [...mark.getClientRects()].find(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) || mark.getBoundingClientRect();
      visible = true; setPreview({ hint, rect });
    }
    function over(event) {
      if (event.pointerType === 'touch' || event.buttons) return;
      if (inBox(event.target)) { clearTimeout(hideTimer); return; }
      const mark = markAt(event.target);
      if (!mark) return;
      const hint = aiGrammarKey.getState(editor.state)?.hints.find(item => item.id === mark.dataset.aiGrammarId);
      if (!hint) return;
      const same = candidate?.hint === hint;
      if (!same) hide();
      clearTimeout(hideTimer); candidate = { mark, hint, x: event.clientX, y: event.clientY };
      if (!same) showTimer = setTimeout(show, 300);
      else if (visible) show();
    }
    function out(event) {
      if (!candidate || (!inBox(event.target) && !markAt(event.target))) return;
      if (inBox(event.relatedTarget) || markAt(event.relatedTarget)?.dataset.aiGrammarId === candidate.hint.id) return;
      if (!visible) hide();
      else { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 180); } // Allow crossing the gap to read the preview.
    }
    function key(event) {
      if (visible && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      hide();
    }
    const scroll = event => { if (!inBox(event.target)) hide(); };
    const invalidate = () => { if (candidate && !live()) hide(); };
    document.addEventListener('pointerover', over); document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', hide, true); document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true); window.addEventListener('resize', hide); window.addEventListener('blur', hide);
    editor.on('transaction', invalidate); editor.on('destroy', hide);
    return () => {
      hide(); editor.off('transaction', invalidate); editor.off('destroy', hide);
      document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', hide, true); document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', hide); window.removeEventListener('blur', hide);
    };
  }, [editor]);
  useLayoutEffect(() => { if (preview) placeCard(box.current, preview.rect); }, [preview]);
  if (!preview) return null;
  const { hint } = preview;
  return <div ref={box} className="ai-grammar-tooltip" role="tooltip">
    <div className="ai-grammar-tooltip-heading"><Sparkles size={13} aria-hidden="true" /><strong>{PROOFREAD_CATEGORIES[hint.category]}</strong><span>AI hint</span></div>
    <p>{hint.reason || 'The AI flagged this passage without giving a reason.'}</p>
    <p className="ai-grammar-tooltip-wording"><span>Suggestion: </span>{hint.replacement ? <q>{hint.replacement}</q> : 'Remove the underlined text.'}</p>
    <small>Right-click for a quick correction, or click to review.</small>
  </div>;
}

export default function AIGrammarHints({ grammar, editor }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!grammar.selected || !editor || editor.isDestroyed) return;
    const place = () => {
      if (editor.isDestroyed) return;
      const coords = editor.view.coordsAtPos(Math.min(grammar.selected.from, editor.state.doc.content.size));
      placeCard(ref.current, coords);
    };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); grammar.close(); } };
    place(); ref.current?.querySelector('button')?.focus();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true); document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('keydown', escape); };
  }, [grammar.selected, editor]);
  if (!grammar.enabled) return null;
  const { status, selected } = grammar;
  const text = status.kind === 'checking' ? 'Checking paragraph…' : status.kind === 'ready' ? status.count ? `${status.count} AI grammar hint${status.count === 1 ? '' : 's'}` : 'No AI grammar hints' : status.kind === 'error' ? 'AI grammar unavailable · Retry' : status.kind === 'paused' ? 'AI grammar paused' : status.kind === 'unsupported' ? 'AI grammar · place cursor in a plain paragraph' : 'AI grammar · waiting for typing pause';
  return <>
    <div className="ai-grammar-status"><Sparkles size={13} /><button type="button" disabled={!status.count && status.kind !== 'error'} title={status.message || 'Checks the current plain paragraph (up to 4,000 characters) using your proofreading connection. Paragraphs with notes or tracked changes are skipped. Hover an underline for an explanation, or click to apply or ignore.'} onClick={status.kind === 'error' ? grammar.retry : grammar.review}>{text}</button></div>
    {!selected && status.kind === 'ready' && status.count > 0 && <GrammarHover editor={editor} />}
    {selected && <div ref={ref} className="ai-grammar-popover" role="dialog" aria-label="AI grammar suggestion">
      <div className="ai-grammar-popover-heading"><strong><Sparkles size={14} />AI grammar suggestion</strong><button type="button" className="icon-button" aria-label="Close grammar suggestion" onClick={grammar.close} title="Close this suggestion without changing the text."><X size={14} /></button></div>
      <p className="ai-grammar-change"><del>{selected.original}</del> → <ins>{selected.replacement || '(remove)'}</ins></p>
      <p>{selected.reason || 'The AI flagged this passage without giving a reason.'}</p><small>Review the suggestion; AI can make mistakes.</small>
      <div className="ai-grammar-actions"><button type="button" className="secondary-button" onClick={grammar.ignore} title="Dismiss this grammar hint while keeping your wording.">Ignore</button><button type="button" className="primary-button" onClick={grammar.apply} title="Replace the marked text with this correction. You can undo it.">Apply grammar suggestion</button></div>
    </div>}
  </>;
}
