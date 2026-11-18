const TYPE = 'application/x-wraiter-passage';

// Let ProseMirror serialize/insert the passage through its ordinary clipboard,
// schema and history handlers. Only the source view owns a native move; another
// view has no dragging slice and therefore receives a copy of the rich text.
export function createPaneTextDrag() {
  let source = null, caret = null;
  const hide = () => { caret?.remove(); caret = null; };
  const clear = () => { source = null; hide(); };
  const isCopy = (id, editor, event) => source && source.id !== id && !source.editor.isDestroyed && editor && !editor.isDestroyed &&
    event.dataTransfer?.types.includes(TYPE) && editor.view.dom.contains(event.target);
  return {
    clear,
    start(id, editor, event) {
      clear();
      if (!editor || editor.isDestroyed || !editor.view.dragging || !event.dataTransfer || !editor.view.dom.contains(event.target)) return;
      if (!editor.view.dragging.slice.content.textBetween(0, editor.view.dragging.slice.content.size, '\n').length) return;
      source = { id, editor };
      event.dataTransfer.setData(TYPE, id);
    },
    over(id, editor, event, allowed) {
      if (!allowed || !isCopy(id, editor, event)) { hide(); return; }
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
      const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      if (position == null) { hide(); return; }
      const rect = editor.view.coordsAtPos(position);
      if (!caret) {
        caret = editor.view.dom.ownerDocument.createElement('div');
        caret.className = 'multitask-copy-caret'; caret.setAttribute('aria-hidden', 'true');
        editor.view.dom.ownerDocument.body.appendChild(caret);
      }
      Object.assign(caret.style, { left: `${rect.left}px`, top: `${rect.top}px`, height: `${Math.max(2, rect.bottom - rect.top)}px` });
    },
    leave(editor, event) { if (!editor?.view.dom.contains(event.relatedTarget)) hide(); },
    drop(id, editor, event, activate, allowed) {
      if (!isCopy(id, editor, event)) return;
      hide();
      if (!allowed || !activate(id)) { event.preventDefault(); event.stopPropagation(); clear(); return; }
      event.dataTransfer.dropEffect = 'copy';
      // Do not consume the drop. The now-editable target handles it natively.
    }
  };
}
