import React, { useEffect, useState } from 'react';
import { Bold, Italic, Undo2, Redo2, Sparkles, X, Check } from 'lucide-react';

// VisualViewport follows the software keyboard on iOS and Android. Preventing
// pointer focus on buttons leaves both the editor selection and keyboard intact.
export default function MobileWritingBar({ editor, onSuggest, onAccept, onDismiss, ghost, busy, onUndo, onRedo, canUndo, canRedo, onFontSize, fontSize, hidden }) {
  const [viewport, setViewport] = useState(null);
  useEffect(() => {
    let frame;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const view = window.visualViewport; setViewport(view ? { top: view.offsetTop + view.height, scale: view.scale } : null); }); };
    update(); window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update); window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  if (hidden || !editor) return null;
  const format = command => { if (!editor.isDestroyed) command(editor.chain().focus()).run(); };
  return <div className="mobile-writing-bar" role="toolbar" aria-label="Quick writing tools" style={viewport ? { top: `${viewport.top}px`, bottom: 'auto', transform: 'translateY(-100%)' } : undefined}>
    <button className="mobile-suggest" aria-label={ghost ? 'Accept AI suggestion (Tab)' : 'AI suggestion (Tab)'} title={ghost ? 'Accept suggestion' : 'Suggest at cursor or rephrase selection'} onPointerDown={event => event.preventDefault()} onClick={ghost ? onAccept : onSuggest} disabled={busy && !ghost}>{ghost ? <Check size={17} /> : <Sparkles size={17} />}<span>{ghost ? 'Accept' : 'AI Tab'}</span></button>
    {ghost && <button aria-label="Dismiss suggestion" onPointerDown={event => event.preventDefault()} onClick={onDismiss}><X size={17} /></button>}
    <button aria-label="Bold" aria-pressed={editor.isActive('bold')} onPointerDown={event => event.preventDefault()} onClick={() => format(chain => chain.toggleBold())}><Bold size={17} /></button>
    <button aria-label="Italic" aria-pressed={editor.isActive('italic')} onPointerDown={event => event.preventDefault()} onClick={() => format(chain => chain.toggleItalic())}><Italic size={17} /></button>
    <button aria-label="Decrease font size" onPointerDown={event => event.preventDefault()} onClick={() => onFontSize(Math.max(6, fontSize - 1))}>A−</button>
    <button aria-label="Increase font size" onPointerDown={event => event.preventDefault()} onClick={() => onFontSize(Math.min(96, fontSize + 1))}>A+</button>
    <button aria-label="Undo" disabled={!canUndo} onPointerDown={event => event.preventDefault()} onClick={onUndo}><Undo2 size={17} /></button>
    <button aria-label="Redo" disabled={!canRedo} onPointerDown={event => event.preventDefault()} onClick={onRedo}><Redo2 size={17} /></button>
  </div>;
}
