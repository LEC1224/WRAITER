import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function SuggestionModal({ title, onClose, children }) {
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement;
    dialog.showModal();
    (dialog.querySelector('[data-initial-focus]') || dialog.querySelector('textarea,select'))?.focus();
    return () => { dialog.close(); previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className="modal suggestion-modal" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => event.stopPropagation()}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={17}/></button></div>
    {children}
  </dialog>;
}
