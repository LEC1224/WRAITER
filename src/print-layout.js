// Print controls deliberately produce only validated CSS. User text is encoded
// as a CSS string and cannot close the surrounding style element.
function cssLiteral(value) {
  return JSON.stringify(String(value).slice(0, 500)).replace(/</g, '\\3c ').replace(/>/g, '\\3e ');
}
function marginContent(text) {
  const parts = String(text || '').split(/(\{page\}|\{pages\})/g).filter(Boolean);
  return parts.length ? parts.map(part => part === '{page}' ? 'counter(page)' : part === '{pages}' ? 'counter(pages)' : cssLiteral(part)).join(' ') : 'none';
}
export const DEFAULT_PRINT_LAYOUT = { size: 'A4', orientation: 'portrait', top: 22, right: 22, bottom: 22, left: 22, header: '', footer: '' };
export function normalizePrintLayout(settings = {}) {
  if (!settings || typeof settings !== 'object') settings = {};
  return { size: ['A4', 'A5', 'Letter'].includes(settings.size) ? settings.size : 'A4', orientation: settings.orientation === 'landscape' ? 'landscape' : 'portrait', ...Object.fromEntries(['top', 'right', 'bottom', 'left'].map(key => [key, Math.min(60, Math.max(8, Number.isFinite(Number(settings[key])) ? Number(settings[key]) : 22))])), header: String(settings.header || '').slice(0, 500), footer: String(settings.footer || '').slice(0, 500) };
}
export function pageDimensions(settings = {}) {
  const layout = normalizePrintLayout(settings), sizes = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };
  const [width, height] = sizes[layout.size];
  return layout.orientation === 'landscape' ? { width: height, height: width } : { width, height };
}
export function printLayoutCSS(options = {}) {
  const settings = options.printLayout;
  if (!settings) return '';
  const sizes = { A4: 'A4', A5: 'A5', Letter: 'letter' };
  const size = sizes[settings.size] || 'A4';
  const orientation = settings.orientation === 'landscape' ? 'landscape' : 'portrait';
  const margin = value => Math.min(60, Math.max(8, Number.isFinite(Number(value)) ? Number(value) : 22));
  const margins = ['top', 'right', 'bottom', 'left'].map(key => `${margin(settings[key])}mm`).join(' ');
  const header = marginContent(settings.header), footer = marginContent(settings.footer);
  return `@page{size:${size} ${orientation};margin:${margins};@top-center{content:${header};font:9pt serif;color:#555}@bottom-center{content:${footer};font:9pt serif;color:#555}}`;
}
