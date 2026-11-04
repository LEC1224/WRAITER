import { closeHistory } from '@tiptap/pm/history';

export function captureParagraphLayout(editor, project = {}) {
  if (!editor || editor.isDestroyed) return null;
  const { doc, selection } = editor.state, positions = [];
  doc.nodesBetween(selection.from, selection.to, (node, pos) => { if (['paragraph', 'heading'].includes(node.type.name)) positions.push(pos); });
  if (!positions.length && ['paragraph', 'heading'].includes(selection.$from.parent.type.name)) positions.push(selection.$from.before());
  if (!positions.length) return null;
  const node = doc.nodeAt(positions[0]), style = project.namedStyles?.find(style => style.id === node.attrs.namedStyle)?.attrs || {};
  const attrs = { ...style, ...Object.fromEntries(Object.entries(node.attrs).filter(([, value]) => value != null)) };
  const element = editor.view?.nodeDOM?.(positions[0]);
  if (element && typeof getComputedStyle === 'function') {
    const computed = getComputedStyle(element);
    for (const [name, property] of [['spaceBefore', 'marginTop'], ['spaceAfter', 'marginBottom'], ['leftIndent', 'marginLeft'], ['rightIndent', 'marginRight'], ['firstLineIndent', 'textIndent']]) {
      if (attrs[name] == null) attrs[name] = Math.round((parseFloat(computed[property]) || 0) * 0.75 * 100) / 100;
    }
    if (attrs.lineHeight == null) attrs.lineHeight = Math.round(parseFloat(computed.lineHeight) / parseFloat(computed.fontSize) * 100) / 100 || project.documentStyle?.lineHeight || 1.5;
  }
  return { editor, doc, positions: [...new Set(positions)], attrs, lineHeight: project.documentStyle?.lineHeight || 1.5 };
}

export function applyParagraphLayout(target, attrs) {
  const editor = target?.editor;
  if (!editor || editor.isDestroyed || editor.state.doc !== target.doc) return false;
  const limits = { leftIndent: [-144, 144], rightIndent: [-144, 144], firstLineIndent: [-144, 144], spaceBefore: [0, 72], spaceAfter: [0, 72], lineHeight: [1, 3] };
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'tabStops') { if (value != null && (!Array.isArray(value) || value.length > 32 || value.some(item => !Number.isFinite(item) || item <= 0 || item > 1000))) return false; }
    else if (!limits[name] || value !== null && (!Number.isFinite(value) || value < limits[name][0] || value > limits[name][1])) return false;
  }
  const tr = closeHistory(editor.state.tr);
  for (const pos of target.positions) { const node = tr.doc.nodeAt(pos); tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }); }
  tr.setMeta('historyLabel', 'Paragraph layout');
  editor.view.dispatch(tr); editor.commands.focus(); return true;
}
