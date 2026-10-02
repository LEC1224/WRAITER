import React from 'react';
import { Paintbrush, PaintbrushVertical } from 'lucide-react';

// The application owns the session buffer so formatting can be reused between
// chapters and tabs without copying text onto the system clipboard.
export default function FormatPainter({ available, hasFormatting, onCopy, onPaste }) {
  return <div className="format-painter" role="group" aria-label="Copy and paste formatting">
    <button type="button" className="icon-button" title="Copy formatting · uses the start of the selection" aria-label="Copy formatting" disabled={!available} onMouseDown={event => event.preventDefault()} onClick={onCopy}><Paintbrush size={17} strokeWidth={1.7} /></button>
    <button type="button" className="icon-button" title="Paste formatting · selected text or current paragraph" aria-label="Paste formatting" disabled={!available || !hasFormatting} onMouseDown={event => event.preventDefault()} onClick={onPaste}><PaintbrushVertical size={17} strokeWidth={1.7} /></button>
  </div>;
}
