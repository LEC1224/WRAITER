import { NodeSelection } from '@tiptap/pm/state';

export function selectedImage(editor) {
  if (!editor || editor.isDestroyed) return null;
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return null;
  const element = editor.view.nodeDOM(selection.from)?.querySelector?.('img');
  const attrs = selection.node.attrs;
  return { editor, pos: selection.from, node: selection.node, attrs, width: Math.round(Number(attrs.width) || element?.clientWidth || element?.naturalWidth || 1), height: Math.round(Number(attrs.height) || element?.clientHeight || element?.naturalHeight || 1) };
}

export function applyImageProperties(image, attrs) {
  const { editor, pos, node } = image;
  if (editor.isDestroyed || editor.state.doc.nodeAt(pos) !== node) return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }).setMeta('historyLabel', 'Edit image properties'));
  return true;
}

// Keep resizing in the live editor. The document schema and exported HTML use
// ordinary image nodes; only the completed gesture changes the manuscript.
export function imageControls(extension, canEdit) {
  return extension.extend({
    addNodeView() {
      return ({ node: initial, editor, getPos }) => {
        let node = initial, resize = null;
        const dom = document.createElement('div'), picture = document.createElement('img');
        dom.className = 'image-node'; dom.dataset.imageNode = ''; dom.draggable = true;
        picture.draggable = false; dom.append(picture);
        function paint() {
          if (picture.getAttribute('src') !== node.attrs.src) picture.src = node.attrs.src;
          picture.alt = node.attrs.alt || ''; picture.title = node.attrs.title || '';
          picture.style.width = node.attrs.width ? `${node.attrs.width}px` : '';
          picture.style.height = node.attrs.width && node.attrs.height ? 'auto' : node.attrs.height ? `${node.attrs.height}px` : '';
          picture.style.aspectRatio = node.attrs.width && node.attrs.height ? `${node.attrs.width} / ${node.attrs.height}` : '';
        }
        paint();
        function move(event) {
          if (!resize) return;
          const delta = (event.clientX - resize.x) / resize.scale * resize.direction;
          resize.width = Math.max(24, Math.min(editor.view.dom.clientWidth, 16000, Math.round(resize.startWidth + delta)));
          resize.height = Math.max(1, Math.round(resize.width / resize.ratio));
          picture.style.width = `${resize.width}px`; picture.style.height = `${resize.height}px`;
        }
        function cleanup() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', finish); dom.classList.remove('resizing'); resize = null; }
        function finish() {
          const size = resize; cleanup();
          if (!size || !canEdit(editor) || editor.isDestroyed || editor.state.doc.nodeAt(getPos()) !== node) { paint(); return; }
          if (size.width * size.height > 32000000) { paint(); return; }
          if (size.width === size.startWidth && size.height === size.startHeight) { paint(); return; }
          editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, width: size.width, height: size.height }).setMeta('historyLabel', 'Resize image'));
        }
        for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
          const handle = document.createElement('span'); handle.className = `image-resize-handle ${corner}`; handle.dataset.imageResize = corner;
          handle.addEventListener('mousedown', event => {
            if (event.button !== 0 || !canEdit(editor)) return;
            event.preventDefault(); event.stopPropagation();
            editor.commands.setNodeSelection(getPos());
            const rect = picture.getBoundingClientRect(), width = picture.clientWidth, height = picture.clientHeight;
            if (!width || !height) return;
            resize = { x: event.clientX, scale: rect.width / width, direction: corner.endsWith('left') ? -1 : 1, startWidth: width, startHeight: height, width, height, ratio: width / height };
            dom.classList.add('resizing'); document.addEventListener('mousemove', move); document.addEventListener('mouseup', finish);
          });
          dom.append(handle);
        }
        return { dom, update(next) { if (next.type !== node.type) return false; node = next; if (!resize) paint(); return true; }, selectNode() { dom.classList.add('ProseMirror-selectednode'); }, deselectNode() { dom.classList.remove('ProseMirror-selectednode'); }, stopEvent(event) { return !!event.target.closest?.('[data-image-resize]'); }, ignoreMutation() { return true; }, destroy() { cleanup(); } };
      };
    }
  });
}
