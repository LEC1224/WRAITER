import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';

export const imageImportKey = new PluginKey('imageImport');
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const supported = 'Use a PNG, JPEG, GIF, or WebP image.';

export function imageMime(bytes) {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function embeddedImage(src, name = 'Image') {
  const match = typeof src === 'string' && src.match(/^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error(supported);
  const data = match[2].replace(/\s/g, '');
  if (data.length * 3 / 4 - (data.match(/=+$/)?.[0].length || 0) > MAX_IMAGE_BYTES) throw new Error('Images can be up to 10 MB each. Choose a smaller image.');
  src = `data:image/${match[1].toLowerCase().replace(/^jpg$/, 'jpeg')};base64,${data}`;
  const image = new globalThis.Image();
  await new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); image.onload = image.onerror = null; error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('The image could not be read. Try another image.')), 10000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error('The image could not be read. Try another image.'));
    image.src = src;
  });
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('This image is too large to display. Choose an image with smaller dimensions.');
  return { src, alt: name.slice(0, 500) };
}

export async function readImageFile(file) {
  if (!file.size) throw new Error(`${file.name || 'This image'} is empty. ${supported}`);
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name || 'This image'} is larger than 10 MB. Choose a smaller image.`);
  // Explorer and some clipboard providers leave MIME types blank. Check bytes
  // instead of trusting the filename or turning an unsupported file into an image.
  const mime = imageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mime) throw new Error(`${file.name || 'This file'} is not a supported image. ${supported} Use File → Open for documents.`);
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reader.onabort = () => reject(new Error(`${file.name || 'The image'} could not be read. Try again.`));
    reader.readAsDataURL(new Blob([file], { type: mime }));
  });
  return embeddedImage(src, file.name || 'Pasted image');
}

export function transferFiles(transfer) {
  const files = Array.from(transfer?.files || []);
  return files.length ? files : Array.from(transfer?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
}
export function hasFileTransfer(transfer) {
  return Array.from(transfer?.types || []).includes('Files') || Array.from(transfer?.items || []).some(item => item.kind === 'file') || Boolean(transfer?.files?.length);
}

export function prepareImageHTML(html, onNotice) {
  if (!/<img\b/i.test(html)) return html;
  const template = document.createElement('template'); template.innerHTML = html;
  let omitted = false;
  for (const image of template.content.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) image.setAttribute('src', src.replace(/^data:image\/jpg;/i, 'data:image/jpeg;'));
    else { image.replaceWith(document.createTextNode(`[Image not embedded: ${image.getAttribute('alt') || 'linked or unsupported image'}]`)); omitted = true; }
  }
  if (omitted) onNotice('Linked images were replaced with labels. Copy the image itself or save it, then paste or drop the image file.');
  return template.innerHTML;
}

export function createImageImportPlugin({ canInsert = () => true, onNotice = () => {}, readFile = readImageFile } = {}) {
  let destroyed = false;
  const allowed = view => !destroyed && view.editable && canInsert(view);
  const clearDrop = view => view.dom?.removeAttribute('data-image-drop');
  async function begin(view, load, selection, origin) {
    clearDrop(view);
    if (!allowed(view)) { onNotice('Finish the current operation, then insert the image.'); return false; }
    if (imageImportKey.getState(view.state)?.pending) { onNotice('An image import is already in progress.'); return false; }
    const id = {};
    view.dispatch(view.state.tr.setMeta(imageImportKey, { add: { id, bookmark: selection.getBookmark(), moved: false } }).setMeta('addToHistory', false));
    if (origin !== 'picker') onNotice('Importing image…');
    try {
      const { images, errors = [] } = await load();
      if (destroyed) return false;
      const pending = imageImportKey.getState(view.state)?.pending;
      if (pending?.id !== id) return false;
      if (!allowed(view)) throw new Error('The document is busy. Insert the image again after the current operation finishes.');
      if (images.length) {
        const target = pending.bookmark.resolve(view.state.doc), previousSelection = view.state.selection;
        const tr = view.state.tr.setSelection(target).replaceSelection(new Slice(Fragment.fromArray(images.map(attrs => view.state.schema.nodes.image.create(attrs))), 0, 0));
        if (!tr.docChanged) throw new Error('An image cannot be inserted here. Place the cursor in a paragraph and try again.');
        // Typing/caret movement during decoding must not redirect the import or
        // steal the writer's new selection when it finishes.
        if (pending.moved) tr.setSelection(previousSelection.map(tr.doc, tr.mapping));
        tr.setMeta(imageImportKey, { remove: id }).setMeta('historyLabel', images.length === 1 ? 'Insert image' : `Insert ${images.length} images`).setMeta('uiEvent', origin === 'drop' ? 'drop' : 'paste');
        view.dispatch(pending.moved ? tr : tr.scrollIntoView());
        if (!pending.moved) view.focus();
        onNotice(`${images.length === 1 ? 'Image inserted.' : `${images.length} images inserted.`} Undo with Ctrl+Z.${errors.length ? ` ${errors.join(' ')}` : ''}`);
      } else if (errors.length) onNotice(errors.join(' '));
      return Boolean(images.length);
    } catch (error) {
      if (!destroyed) onNotice(error?.message || 'The image could not be imported. Try again.');
      return false;
    } finally {
      if (!destroyed && imageImportKey.getState(view.state)?.pending?.id === id) view.dispatch(view.state.tr.setMeta(imageImportKey, { remove: id }).setMeta('addToHistory', false));
    }
  }
  const loadFiles = files => async () => {
    const results = await Promise.allSettled(files.map(readFile));
    return { images: results.filter(result => result.status === 'fulfilled').map(result => result.value), errors: results.filter(result => result.status === 'rejected').map(result => result.reason?.message || 'An image could not be read.') };
  };
  function drop(view, event, _slice, moved) {
    if (moved || view.dragging || !hasFileTransfer(event.dataTransfer)) return false;
    event.preventDefault(); clearDrop(view);
    const files = transferFiles(event.dataTransfer);
    if (!files.length) { onNotice('The dropped file could not be read. Try again.'); return true; }
    let position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
    if (position == null) {
      const bounds = view.dom.getBoundingClientRect();
      position = event.clientY < bounds.top ? 0 : view.state.doc.content.size;
    }
    void begin(view, loadFiles(files), Selection.near(view.state.doc.resolve(position)), 'drop');
    return true;
  }
  function dragover(view, event) {
    if (view.dragging || !hasFileTransfer(event.dataTransfer)) return false;
    event.preventDefault();
    const ready = allowed(view) && !imageImportKey.getState(view.state)?.pending;
    event.dataTransfer.dropEffect = ready ? 'copy' : 'none';
    view.dom?.setAttribute('data-image-drop', ready ? 'ready' : 'blocked');
    return true;
  }
  function dragleave(view, event) { if (!view.dom?.contains(event.relatedTarget)) clearDrop(view); return false; }
  return new Plugin({
    key: imageImportKey,
    state: {
      init: () => ({ pending: null }),
      apply(tr, value) {
        let pending = value.pending;
        if (pending) pending = { ...pending, bookmark: pending.bookmark.map(tr.mapping), moved: pending.moved || tr.docChanged || tr.selectionSet };
        const meta = tr.getMeta(imageImportKey);
        if (meta?.add) pending = meta.add;
        if (meta?.remove === pending?.id) pending = null;
        return { pending };
      }
    },
    props: {
      transformPastedHTML: html => prepareImageHTML(html, onNotice),
      handleDrop: drop,
      handlePaste(view, event) {
        const files = transferFiles(event.clipboardData);
        // A rich passage copied from Office can include a rendered image as well
        // as text. Let the normal rich-text paste keep the passage together.
        if (!files.length || event.clipboardData.getData('text/plain').trim()) return false;
        event.preventDefault(); void begin(view, loadFiles(files), view.state.selection, 'paste'); return true;
      },
      handleDOMEvents: { dragover, dragleave, dragend(view) { clearDrop(view); return false; } }
    },
    view(view) {
      return {
        update() { view.dom.setAttribute('aria-busy', String(Boolean(imageImportKey.getState(view.state)?.pending))); },
        destroy() {
          destroyed = true; clearDrop(view); view.dom.removeAttribute('aria-busy');
          if (imageImportKey.getState(view.state)?.pending) onNotice('Image import cancelled because you left this chapter. Insert it again in the chapter you want.');
        }
      };
    },
    pick(view, picker) { return begin(view, async () => { const src = await picker(); return { images: src ? [await embeddedImage(src)] : [] }; }, view.state.selection, 'picker'); },
    dropFiles(view, files, coordinates) { const pos = view.posAtCoords(coordinates)?.pos ?? view.state.doc.content.size; return begin(view, loadFiles(files), Selection.near(view.state.doc.resolve(pos)), 'drop'); },
    surfaceEvents: { drop, dragover, dragleave }
  });
}

export function imageImportExtension(options) {
  return Extension.create({ name: 'imageImport', addProseMirrorPlugins: () => [createImageImportPlugin(options)] });
}
export function insertPickedImage(editor, picker) {
  if (!editor || editor.isDestroyed) return Promise.resolve(false);
  return imageImportKey.get(editor.state)?.spec.pick(editor.view, picker) || Promise.resolve(false);
}
export function imageSurfaceEvent(editor, type, event) {
  if (!editor || editor.isDestroyed || event.defaultPrevented) return false;
  return imageImportKey.get(editor.state)?.spec.surfaceEvents[type]?.(editor.view, event) || false;
}
export function insertDroppedImages(editor, files, coordinates) {
  if (!editor || editor.isDestroyed) return Promise.resolve(false);
  return imageImportKey.get(editor.state)?.spec.dropFiles(editor.view, files, coordinates) || Promise.resolve(false);
}
