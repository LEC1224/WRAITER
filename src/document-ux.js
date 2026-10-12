export const DOCUMENT_EXTENSIONS = ['wraiter', 'odt', 'docx', 'txt', 'md', 'markdown', 'html', 'htm'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
export const ZOOM_LEVELS = [50, 75, 90, 100, 110, 125, 150, 175, 200];
export const extensionOf = name => String(name || '').split('.').at(-1).toLowerCase();
export function moveItem(items, id, targetId, after = false) {
  if (id === targetId || !items.some(item => item.id === id) || !items.some(item => item.id === targetId)) return items;
  const next = items.filter(item => item.id !== id), index = next.findIndex(item => item.id === targetId);
  next.splice(index + Number(after), 0, items.find(item => item.id === id));
  return next.every((item, i) => item === items[i]) ? items : next;
}
export function nextZoom(value, direction) {
  return direction > 0 ? ZOOM_LEVELS.find(level => level > value) || 200 : [...ZOOM_LEVELS].reverse().find(level => level < value) || 50;
}
export function imageDimensions(attrs, naturalWidth, naturalHeight, maxWidth = 600, maxHeight = 900) {
  const width = Number(attrs?.width) > 0 ? Number(attrs.width) : naturalWidth;
  const height = Number(attrs?.height) > 0 ? Number(attrs.height) : width * naturalHeight / naturalWidth;
  const scale = !Number(attrs?.width) && !Number(attrs?.height) ? Math.min(1, maxWidth / width, maxHeight / height) : 1;
  return { width: width * scale, height: height * scale };
}
export function captureReadingAnchor(scroller) {
  if (!scroller) return null;
  const viewport = scroller.getBoundingClientRect(), center = viewport.top + viewport.height / 2;
  const blocks = [...scroller.querySelectorAll('.manuscript > *, .chapter-heading')];
  const element = blocks.find(block => block.getBoundingClientRect().bottom > center) || blocks.at(-1);
  return element ? { element, offset: element.getBoundingClientRect().top - viewport.top, scroller } : null;
}
export function restoreReadingAnchor(anchor) {
  if (!anchor?.element.isConnected) return;
  anchor.scroller.scrollTop += anchor.element.getBoundingClientRect().top - anchor.scroller.getBoundingClientRect().top - anchor.offset;
}
