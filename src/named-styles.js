// Named styles carry stable IDs. CSS is generated only from bounded, validated
// values; no user-supplied property names or CSS fragments are interpolated.
const identifier = /^[A-Za-z0-9_-]{1,100}$/;
export const styleIdValid = value => typeof value === 'string' && identifier.test(value);
export function sanitizeNamedStyles(styles) {
  if (!Array.isArray(styles) || styles.length > 500) return null;
  const numeric = { fontSize:[6,96], lineHeight:[1,3], spaceBefore:[0,72], spaceAfter:[0,72], leftIndent:[-144,144], rightIndent:[-144,144], firstLineIndent:[-144,144] }, ids = new Set(), output = [];
  for (const style of styles) {
    if (!style || typeof style !== 'object' || Array.isArray(style) || !styleIdValid(style.id) || ids.has(style.id) || typeof style.name !== 'string' || !style.name.trim() || style.name.length > 100 || !['paragraph','character'].includes(style.kind) || !style.attrs || typeof style.attrs !== 'object' || Array.isArray(style.attrs)) return null;
    const attrs = {};
    for (const [key, value] of Object.entries(style.attrs)) {
      if (Object.hasOwn(numeric, key)) { const [min,max] = numeric[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null; }
      else if (['bold','italic','underline'].includes(key)) { if (typeof value !== 'boolean') return null; }
      else if (key === 'fontFamily') { if (typeof value !== 'string' || value.length > 200 || /[<>\x00-\x1f]/.test(value)) return null; }
      else if (key === 'color') { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null; }
      else if (key === 'textAlign') { if (!['left','right','center','justify'].includes(value)) return null; }
      else return null;
      attrs[key] = value;
    }
    ids.add(style.id); output.push({ id: style.id, name: style.name, kind: style.kind, attrs });
  }
  return output;
}
const unit = (value, min, max, suffix = 'pt') => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? `${value}${suffix}` : null;
export function namedStyleDeclarations(attrs = {}) {
  const css = [];
  if (typeof attrs.fontFamily === 'string' && attrs.fontFamily.length <= 200 && !/[<>\x00-\x1f]/.test(attrs.fontFamily)) css.push(`font-family:${JSON.stringify(attrs.fontFamily)}`);
  const size = unit(attrs.fontSize, 6, 96); if (size) css.push(`font-size:${size}`);
  if (/^#[0-9a-f]{6}$/i.test(attrs.color || '')) css.push(`color:${attrs.color}`);
  if (typeof attrs.bold === 'boolean') css.push(`font-weight:${attrs.bold ? 'bold' : 'normal'}`);
  if (typeof attrs.italic === 'boolean') css.push(`font-style:${attrs.italic ? 'italic' : 'normal'}`);
  if (typeof attrs.underline === 'boolean') css.push(`text-decoration:${attrs.underline ? 'underline' : 'none'}`);
  const line = unit(attrs.lineHeight, 1, 3, ''); if (line) css.push(`line-height:${line}`);
  for (const [key, prop, min, max] of [['spaceBefore','margin-top',0,72],['spaceAfter','margin-bottom',0,72],['leftIndent','margin-left',-144,144],['rightIndent','margin-right',-144,144],['firstLineIndent','text-indent',-144,144]]) { const v = unit(attrs[key], min, max); if (v !== null) css.push(`${prop}:${v}`); }
  if (['left','right','center','justify'].includes(attrs.textAlign)) css.push(`text-align:${attrs.textAlign}`);
  return css.join(';');
}
export function namedStyleCSS(styles, scope = '') {
  if (!Array.isArray(styles)) return '';
  return styles.filter(s => styleIdValid(s?.id) && ['paragraph','character'].includes(s.kind)).map(style => {
    const attr = style.kind === 'paragraph' ? 'data-paragraph-style' : 'data-character-style';
    return `${scope}[${attr}="${style.id}"]{${namedStyleDeclarations(style.attrs)}}`;
  }).join('\n');
}

export function applyNamedStyle(editor, style) {
  if (!editor || editor.isDestroyed || !styleIdValid(style?.id)) return false;
  if (style.kind === 'character') return editor.chain().focus().setMark('namedStyle', { id: style.id }).run();
  if (style.kind !== 'paragraph') return false;
  return editor.chain().focus().command(({ tr }) => {
    const positions = [];
    tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => { if (['paragraph','heading'].includes(node.type.name)) positions.push(pos); });
    if (!positions.length && ['paragraph','heading'].includes(tr.selection.$from.parent.type.name)) positions.push(tr.selection.$from.before());
    for (const pos of positions) { const node = tr.doc.nodeAt(pos); tr.setNodeMarkup(pos, undefined, { ...node.attrs, namedStyle: style.id }); }
    if (positions.length) tr.setMeta('historyLabel', `Apply ${style.name}`);
    return positions.length > 0;
  }).run();
}
export function clearNamedStyles(editor) {
  if (!editor || editor.isDestroyed) return false;
  return editor.chain().focus().command(({ tr, state }) => {
    const mark = state.schema.marks.namedStyle, { from, to, empty, $from } = tr.selection, positions = [];
    tr.doc.nodesBetween(from, to, (node, pos) => { if (['paragraph','heading'].includes(node.type.name) && node.attrs.namedStyle) positions.push(pos); });
    if (empty && ['paragraph','heading'].includes($from.parent.type.name) && $from.parent.attrs.namedStyle) positions.push($from.before());
    for (const pos of new Set(positions)) { const node = tr.doc.nodeAt(pos); tr.setNodeMarkup(pos, undefined, { ...node.attrs, namedStyle: null }); }
    if (empty) tr.removeStoredMark(mark); else tr.removeMark(from, to, mark);
    tr.setMeta('historyLabel', 'Clear named styles'); return true;
  }).run();
}
