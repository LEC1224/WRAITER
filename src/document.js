export const uid = () => crypto.randomUUID();
export const paragraph = text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined });
export const blankContent = () => ({ type: 'doc', content: [paragraph('')] });
export function newProject(demo = false) {
  return {
    format: 'wraiter', version: 1, id: uid(), title: demo ? 'The quiet hours' : 'Untitled manuscript',
    subtitle: '', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    chapters: demo ? [
      { id: uid(), title: 'An open window', status: 'Draft', content: { type: 'doc', content: [
        paragraph('The house was quiet enough to hear the rain moving through the garden. Mara opened the window an inch and set her notebook on the sill.'),
        paragraph('For weeks she had been waiting for a good first sentence. Something certain. Something that would explain where she had been, and where she meant to go.'),
        paragraph('Outside, a blackbird landed on the fence. It shook the water from its wings and began again.'),
        { type: 'paragraph', content: [{ type: 'text', text: 'Perhaps that was all a beginning needed to be.', marks: [{ type: 'italic' }] }] } ] } },
      { id: uid(), title: 'The road beyond', status: 'Notes', content: { type: 'doc', content: [paragraph('')] } }
    ] : [{ id: uid(), title: 'Chapter one', status: 'Draft', content: blankContent() }],
    references: [], notes: '', style: '', snapshots: []
  };
}
export function nodeText(node, separator = '\n', includeImages = false) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'horizontalRule') return '* * *';
  if (node.type === 'image') return includeImages ? node.attrs?.alt ? `[Image: ${node.attrs.alt}]` : '[Image]' : '';
  const block = ['doc', 'bulletList', 'orderedList', 'listItem', 'table', 'tableCell', 'tableHeader', 'blockquote'].includes(node.type);
  return (node.content || []).map(n => nodeText(n, separator, includeImages)).join(node.type === 'tableRow' ? '\t' : block ? separator : '');
}
export const wordCount = text => (String(text || '').trim().match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;
export const projectWords = project => project.chapters.reduce((sum, c) => sum + wordCount(nodeText(c.content)), 0);
export function snapshot(project, name) {
  return { id: uid(), name: name || `Revision ${new Date().toLocaleString()}`, createdAt: new Date().toISOString(), title: project.title, chapters: structuredClone(project.chapters), notes: project.notes, style: project.style, language: project.language, documentStyle: structuredClone(project.documentStyle), references: structuredClone(project.references || []) };
}
export function exportText(project) { return [project.title, ...project.chapters.flatMap(c => [c.title, nodeText(c.content, '\n', true)])].join('\n\n'); }
export function inlineMarkup(node, format = 'md') {
  let text = node.text || '';
  const markdown = format === 'md';
  if (markdown) text = text.replace(/&/g, '&amp;').replace(/([\\`*_[\]<>#|~])/g, '\\$1');
  else text = text.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
  for (const mark of node.marks || []) {
    if (mark.type === 'bold') text = format === 'md' ? `**${text}**` : `[b]${text}[/b]`;
    if (mark.type === 'italic') text = format === 'md' ? `*${text}*` : `[i]${text}[/i]`;
    if (mark.type === 'underline' && format !== 'md') text = `[u]${text}[/u]`;
    if (mark.type === 'strike') text = format === 'md' ? `~~${text}~~` : `[s]${text}[/s]`;
    if (mark.type === 'code') text = markdown ? `<code>${(node.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>` : `[code]${text}[/code]`;
    if (mark.type === 'link') {
      const href = String(mark.attrs?.href || '').replace(/\s/g, c => encodeURIComponent(c));
      text = markdown ? `[${text}](<${href.replace(/</g, '%3C').replace(/>/g, '%3E')}>)` : `[url=${href.replace(/\[/g, '%5B').replace(/\]/g, '%5D')}]${text}[/url]`;
    }
  }
  return text;
}
export function blockMarkup(node, format = 'md', depth = 0) {
  if (node.type === 'text') return inlineMarkup(node, format);
  if (node.type === 'hardBreak') return format === 'md' ? '  \n' : '\n';
  if (node.type === 'horizontalRule') return '\n* * *\n\n';
  if (node.type === 'codeBlock') {
    const text = nodeText(node);
    const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
    return format === 'md' ? `${fence}\n${text}\n${fence}\n\n` : `[code]${text.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')}[/code]\n\n`;
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    const start = Number(node.attrs?.start) || 1;
    const items = (node.content || []).map((item, i) => {
      const inner = (item.content || []).map(n => blockMarkup(n, format, depth + 1)).join('').trimEnd();
      if (format !== 'md') return `[*]${inner}\n`;
      const marker = node.type === 'orderedList' ? `${start + i}. ` : '- ';
      return marker + inner.split('\n').map((line, index) => index ? ' '.repeat(marker.length) + line : line).join('\n') + '\n';
    }).join('');
    return format === 'md' ? items + '\n' : `[list${node.type === 'orderedList' ? '=1' : ''}]\n${items}[/list]\n\n`;
  }
  if (node.type === 'table') {
    const rows = (node.content || []).map(row => (row.content || []).map(cell => blockMarkup(cell, format, depth).trim().replace(/\n+/g, format === 'md' ? '<br>' : ' / ')));
    if (!rows.length) return '';
    if (format !== 'md') return rows.map(row => row.join('\t')).join('\n') + '\n\n';
    const width = Math.max(...rows.map(row => row.length));
    const line = row => '| ' + Array.from({ length: width }, (_, i) => row[i] || '').join(' | ') + ' |\n';
    return line(rows[0]) + line(Array(width).fill('---')) + rows.slice(1).map(line).join('') + '\n';
  }
  const inner = (node.content || []).map(n => blockMarkup(n, format, depth)).join('');
  if (node.type === 'heading') return (format === 'md' ? '#'.repeat(node.attrs.level) + ' ' : '[b]') + inner + (format === 'md' ? '\n\n' : '[/b]\n\n');
  if (node.type === 'paragraph') return (format === 'md' ? inner.replace(/^(\s{0,3}\d+)([.)])(?=\s)/gm, '$1\\$2').replace(/^(\s{0,3})([+-])(?=\s)/gm, '$1\\$2').replace(/^(\s{0,3})([-=]{3,})\s*$/gm, (_, space, run) => space + run.split('').map(c => '\\' + c).join('')) : inner) + '\n\n';
  if (node.type === 'listItem') return inner;
  if (node.type === 'blockquote') return format === 'md' ? inner.trimEnd().split('\n').map(l => `> ${l}`).join('\n') + '\n\n' : `[quote]${inner.trim()}[/quote]\n\n`;
  if (node.type === 'tableCell' || node.type === 'tableHeader') return inner.trim();
  if (node.type === 'tableRow') return inner + '\n';
  if (node.type === 'image') return format === 'md' ? `![${inlineMarkup({ text: node.attrs?.alt || 'Image' })}](<${String(node.attrs?.src || '').replace(/</g, '%3C').replace(/>/g, '%3E')}>)\n\n` : '[Image omitted from BBCode export]\n\n';
  return inner;
}
