import { TextSelection } from '@tiptap/pm/state';

// A pane switch has an asynchronous save boundary. Keep the initiating mouse
// gesture alive while the workspace is inert, without allowing edits against
// the previous document's journal. Only selection positions cross that boundary.
export function capturePaneSelection(source, pointer) {
  if (!source || source.isDestroyed || !Number.isInteger(pointer?.position)) return null;
  const originalDoc = source.state.doc, win = source.view.dom.ownerDocument.defaultView;
  const controller = new AbortController(), options = { capture: true, signal: controller.signal };
  const anchor = pointer.shiftKey ? source.state.selection.anchor : pointer.position;
  let head = pointer.position, current = null, down = true, cancelled = false, frame = 0;
  let point = { x: pointer.x, y: pointer.y }, moved = false;
  const edits = [];
  const matches = event => pointer.pointerId == null || event.pointerId === pointer.pointerId;
  const valid = editor => editor && !editor.isDestroyed && editor.view.dom.isConnected;
  const selection = editor => TextSelection.between(editor.state.doc.resolve(Math.min(anchor, editor.state.doc.content.size)), editor.state.doc.resolve(Math.min(head, editor.state.doc.content.size)));
  const cancel = () => { cancelled = true; controller.abort(); win.cancelAnimationFrame(frame); frame = 0; edits.length = 0; };
  const finish = () => { if (!down && current) { controller.abort(); win.cancelAnimationFrame(frame); frame = 0; } };
  const locate = editor => {
    if (!moved || !valid(editor)) return;
    const bounds = editor.view.dom.getBoundingClientRect(), scroller = editor.view.dom.closest('.writing-scroll');
    const viewport = scroller?.getBoundingClientRect() || bounds;
    const left = Math.max(bounds.left + 1, Math.min(point.x, bounds.right - 1));
    const top = Math.max(Math.max(bounds.top, viewport.top) + 1, Math.min(point.y, Math.min(bounds.bottom, viewport.bottom) - 1));
    const position = editor.view.posAtCoords({ left, top })?.pos;
    if (position != null) head = position;
  };
  const apply = () => {
    if (cancelled || !valid(current)) return;
    const next = selection(current);
    if (!next.eq(current.state.selection)) current.view.dispatch(current.state.tr.setSelection(next));
  };
  const tick = () => {
    frame = 0;
    if (cancelled || !valid(current || source)) return;
    const scroller = current?.view.dom.closest('.writing-scroll');
    let scrolling = false;
    if (down && moved && scroller) {
      const bounds = scroller.getBoundingClientRect(), previous = scroller.scrollTop;
      // Match ordinary selection dragging at the edge, confined to this pane.
      if (point.y < bounds.top + 20) scroller.scrollTop -= Math.min(24, (bounds.top + 20 - point.y) / 2);
      else if (point.y > bounds.bottom - 20) scroller.scrollTop += Math.min(24, (point.y - bounds.bottom + 20) / 2);
      scrolling = scroller.scrollTop !== previous;
    }
    locate(current || source); apply();
    if (scrolling) frame = win.requestAnimationFrame(tick);
  };
  const update = event => {
    if (!matches(event)) return;
    if (Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y) > 2) moved = true;
    point = { x: event.clientX, y: event.clientY };
    // Coalesce geometry/selection work to one update per animation frame.
    if (!frame) frame = win.requestAnimationFrame(tick);
  };
  win.addEventListener('pointermove', event => {
    if (!down || !matches(event)) return;
    if (!(event.buttons & 1)) { down = false; finish(); return; }
    update(event);
  }, options);
  win.addEventListener('pointerup', event => {
    if (!matches(event) || event.button !== 0) return;
    update(event); locate(current || source); down = false; apply(); finish();
  }, options);
  win.addEventListener('pointercancel', event => { if (matches(event)) cancel(); }, options);
  win.addEventListener('pointerdown', cancel, options);
  win.addEventListener('blur', event => { if (event.target === win) cancel(); }, options);
  win.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); }, options);

  // Ctrl+C / Ctrl+V can arrive before disk I/O finishes. Preserve the browser's
  // clipboard event, then run edits through the destination's normal paste and
  // history handling once it owns the active document. Never read the clipboard
  // outside the user's copy/paste gesture.
  for (const type of ['copy', 'cut', 'paste']) win.addEventListener(type, event => {
    if (current) { apply(); return; }
    if (cancelled || !valid(source) || !event.clipboardData) return;
    if (type === 'paste') {
      if (event.clipboardData.files.length) return;
      const html = event.clipboardData.getData('text/html'), text = event.clipboardData.getData('text/plain');
      if (!html && !text) return;
      edits.push(editor => html ? editor.view.pasteHTML(html) : editor.view.pasteText(text));
    } else {
      const selected = selection(source);
      if (selected.empty) return;
      // TipTap's plain-text serializer reads the editor's selection, whereas
      // ProseMirror's HTML serializer consumes the supplied slice.
      if (!selected.eq(source.state.selection)) source.view.dispatch(source.state.tr.setSelection(selected));
      const { dom, text } = source.view.serializeForClipboard(selected.content());
      event.clipboardData.setData('text/html', dom.innerHTML);
      event.clipboardData.setData('text/plain', text);
      if (type === 'cut') edits.push(editor => editor.commands.deleteSelection());
    }
    event.preventDefault(); event.stopImmediatePropagation();
  }, options);
  return {
    cancel,
    restore(editor) {
      if (cancelled || !valid(editor) || !editor.isEditable || editor.view.dom.closest('[inert]') || !originalDoc.eq(editor.state.doc)) { cancel(); return false; }
      current = editor;
      apply(); current.view.focus();
      for (const edit of edits.splice(0)) edit(current);
      if (down && moved && !frame) frame = win.requestAnimationFrame(tick);
      finish();
      return true;
    }
  };
}
