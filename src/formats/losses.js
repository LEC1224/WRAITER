// These are actionable losses in this particular document. General format
// descriptions belong in export help and must not interrupt every plain save.
export function formatLosses(project, format) {
  const warnings = new Set(), plain = format === 'txt', markdown = format === 'md';
  if (!plain && !markdown && format !== 'html') return [];
  const name = plain ? 'Plain text' : 'Markdown';
  const visit = node => {
    const attrs = node.attrs || {}, marks = node.marks || [];
    if (format === 'html') {
      if (node.type === 'image' && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(attrs.src || '')) warnings.add('An external or unsupported image is replaced with a labelled placeholder.');
    } else {
      if (plain && marks.some(mark => ['bold', 'italic', 'underline', 'strike', 'code', 'highlight'].includes(mark.type))) warnings.add('Plain text removes emphasis, highlighting, and other inline formatting.');
      if (markdown && marks.some(mark => ['underline', 'highlight'].includes(mark.type))) warnings.add('Markdown does not retain underlining or highlighting.');
      if (marks.some(mark => mark.type === 'textStyle' && Object.values(mark.attrs || {}).some(value => value != null && value !== ''))) warnings.add(`${name} does not retain individual fonts, sizes, colours, or text spacing.`);
      if (plain && marks.some(mark => mark.type === 'link')) warnings.add('Plain text keeps link wording but removes the link destination.');
      if ((attrs.textAlign && attrs.textAlign !== 'left') || attrs.lineHeight != null || attrs.spaceAfter != null || attrs.firstLineIndent != null) warnings.add(`${name} does not retain paragraph alignment, line spacing, or indentation.`);
      if (plain && ['heading', 'orderedList', 'bulletList', 'blockquote', 'codeBlock'].includes(node.type)) warnings.add('Plain text flattens headings, lists, quotations, and code blocks into ordinary text.');
      if (plain && node.type === 'image') warnings.add('Plain text replaces images with labelled placeholders.');
      if (plain && node.type === 'table') warnings.add('Plain text turns tables into tab-separated rows.');
      if (markdown && ['tableCell', 'tableHeader'].includes(node.type) && (Number(attrs.colspan) > 1 || Number(attrs.rowspan) > 1)) warnings.add('Markdown tables do not retain merged cells.');
      if (markdown && node.type === 'table' && node.content?.[0]?.content?.some(cell => cell.type !== 'tableHeader')) warnings.add('Markdown uses the first table row as a header.');
    }
    for (const child of node.content || []) visit(child);
  };
  for (const chapter of project.chapters) visit(chapter.content);
  if (plain || markdown) {
    const style = project.documentStyle || {};
    if ((style.fontFamily && style.fontFamily !== 'Cambria') || (style.fontSize != null && Number(style.fontSize) !== 12) || (style.lineHeight != null && Number(style.lineHeight) !== 1.5)) warnings.add(`${name} does not retain the document’s custom font or paragraph defaults.`);
  }
  return [...warnings];
}
