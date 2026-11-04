import { xmlEscape as esc } from './package.js';
import { styleIdValid } from '../named-styles.js';

export const officeStyleId = id => styleIdValid(id) ? `WS_${id}` : undefined;
export const styleDefinitions = project => (project.namedStyles || []).filter(s => styleIdValid(s.id));
export function docxStyleDefinitions(project) {
  const paragraphStyles = [], characterStyles = [];
  for (const style of styleDefinitions(project)) {
    const a = style.attrs, indent = {};
    for (const key of ['left','right']) if (a[key + 'Indent'] != null) indent[key] = Math.round(a[key + 'Indent'] * 20);
    if (a.firstLineIndent != null) indent[a.firstLineIndent < 0 ? 'hanging' : 'firstLine'] = Math.round(Math.abs(a.firstLineIndent) * 20);
    const definition = { id: officeStyleId(style.id), name: style.name,
      run: { font: a.fontFamily, size: a.fontSize != null ? a.fontSize * 2 : undefined, color: a.color?.replace('#',''), bold: a.bold, italics: a.italic, underline: a.underline === true ? {} : a.underline === false ? { type: 'none' } : undefined } };
    if (style.kind === 'paragraph') {
      definition.paragraph = { alignment: { left:'left', right:'right', center:'center', justify:'both' }[a.textAlign], indent, spacing: { before: a.spaceBefore != null ? a.spaceBefore * 20 : undefined, after: a.spaceAfter != null ? a.spaceAfter * 20 : undefined, line: a.lineHeight != null ? a.lineHeight * 240 : undefined } };
      paragraphStyles.push(definition);
    } else characterStyles.push(definition);
  }
  return { paragraphStyles, characterStyles };
}
export function odtStyleDefinitions(project) {
  return styleDefinitions(project).map(style => {
    const a = style.attrs, run = {}, paragraph = {};
    if (a.fontFamily) run['fo:font-family'] = a.fontFamily;
    if (a.fontSize != null) run['fo:font-size'] = a.fontSize + 'pt';
    if (a.color) run['fo:color'] = a.color;
    if (a.bold != null) run['fo:font-weight'] = a.bold ? 'bold' : 'normal';
    if (a.italic != null) run['fo:font-style'] = a.italic ? 'italic' : 'normal';
    if (a.underline != null) run['style:text-underline-style'] = a.underline ? 'solid' : 'none';
    for (const [key, prop] of [['spaceBefore','margin-top'], ['spaceAfter','margin-bottom'], ['leftIndent','margin-left'], ['rightIndent','margin-right'], ['firstLineIndent','text-indent']]) if (a[key] != null) paragraph['fo:' + prop] = a[key] + 'pt';
    if (a.lineHeight != null) paragraph['fo:line-height'] = a.lineHeight * 100 + '%';
    if (a.textAlign) paragraph['fo:text-align'] = a.textAlign;
    const attrs = values => Object.entries(values).map(([name,value]) => ` ${name}="${esc(value)}"`).join('');
    return `<style:style style:name="${officeStyleId(style.id)}" style:display-name="${esc(style.name)}" style:family="${style.kind === 'paragraph' ? 'paragraph' : 'text'}"><style:text-properties${attrs(run)}/>${style.kind === 'paragraph' ? `<style:paragraph-properties${attrs(paragraph)}/>` : ''}</style:style>`;
  }).join('');
}
