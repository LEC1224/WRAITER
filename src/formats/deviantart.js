// DeviantArt Literature removes paragraph margins on paste. An actual empty
// paragraph gives exactly one empty editor line; CSS spacing does not.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gap = '<p><br></p>';
const tags = { bold: 'strong', italic: 'em', underline: 'u', strike: 's' };

export function deviantArtDocument(project, titles) {
  const styles = new Map((project.namedStyles || []).map(style => [style.id, style.attrs]));
  function inline(node, inherited = {}) {
    if (node.type === 'hardBreak') return { html: '<br>', text: '\n' };
    if (node.type === 'note') {
      const text = `[${node.attrs?.kind === 'endnote' ? 'Endnote' : 'Footnote'}: ${node.attrs?.text || ''}]`;
      return { html: escape(text), text };
    }
    if (node.type === 'image') {
      const text = `[Image: ${node.attrs?.alt || 'image omitted'}]`;
      return { html: escape(text), text };
    }
    if (node.type !== 'text') return inlines(node.content || [], inherited);
    const text = node.text || '', marks = node.marks || [];
    const named = styles.get(marks.find(mark => mark.type === 'namedStyle')?.attrs?.id) || {};
    const emphasis = { ...inherited, ...named };
    let html = escape(text).replace(/\r\n?|\n/g, '<br>');
    for (const [type, tag] of Object.entries(tags)) if (emphasis[type] || marks.some(mark => mark.type === type)) html = `<${tag}>${html}</${tag}>`;
    const href = marks.find(mark => mark.type === 'link')?.attrs?.href;
    if (typeof href === 'string' && /^(https?:\/\/|mailto:)/i.test(href)) html = `<a href="${escape(href.replace(/\s/g, c => encodeURIComponent(c)))}">${html}</a>`;
    return { html, text };
  }
  function inlines(nodes, inherited) {
    const parts = nodes.map(node => inline(node, inherited));
    return { html: parts.map(part => part.html).join(''), text: parts.map(part => part.text).join('') };
  }
  function join(parts, htmlSeparator = gap, textSeparator = '\n\n') {
    // Existing spacer paragraphs must not multiply the requested gap. Do not
    // trim content paragraphs: leading spaces and author punctuation survive.
    const content = parts.filter(part => part.text.trim() || part.visible);
    return { html: content.map(part => part.html).join(htmlSeparator), text: content.map(part => part.text).join(textSeparator), visible: content.length > 0 };
  }
  function block(node) {
    const attrs = node.attrs || {};
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type)) {
      const content = inlines(node.content || [], styles.get(attrs.namedStyle));
      const tag = node.type === 'heading' ? `h${Math.max(1, Math.min(3, Number(attrs.level) || 1))}` : 'p';
      const align = attrs.textAlign || styles.get(attrs.namedStyle)?.textAlign;
      const alignment = ['left', 'center', 'right', 'justify'].includes(align) ? ` style="text-align:${align}"` : '';
      return { ...content, html: `<${tag}${alignment}>${content.html}</${tag}>` };
    }
    if (node.type === 'horizontalRule') return { html: '<hr>', text: '* * *', visible: true };
    if (node.type === 'image') { const content = inline(node); return { ...content, html: `<p>${content.html}</p>` }; }
    if (node.type === 'blockquote') {
      const content = blocks(node.content || []);
      return { ...content, html: `<blockquote>${content.html}</blockquote>` };
    }
    if (['bulletList', 'orderedList'].includes(node.type)) {
      const ordered = node.type === 'orderedList', tag = ordered ? 'ol' : 'ul';
      const start = Number.isSafeInteger(attrs.start) && attrs.start > 0 ? attrs.start : 1;
      const items = (node.content || []).map(item => blocks(item.content || []));
      return { html: `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${items.map(item => `<li>${item.html || '<p><br></p>'}</li>`).join('')}</${tag}>`, text: items.map((item, i) => `${ordered ? `${start + i}.` : '•'} ${item.text}`).join('\n'), visible: items.length > 0 };
    }
    if (node.type === 'table') {
      // Literature has no table tool. Keep every cell's wording and emphasis
      // in readable rows instead of passing unsupported table markup.
      const cellLines = node => ['paragraph', 'heading', 'codeBlock'].includes(node.type)
        ? [inlines(node.content || [], styles.get(node.attrs?.namedStyle))]
        : ['text', 'hardBreak', 'note', 'image'].includes(node.type) ? [inline(node)]
        : node.type === 'horizontalRule' ? [{ html: '* * *', text: '* * *' }]
        : (node.content || []).flatMap(cellLines);
      return join((node.content || []).map(row => {
        const cells = (row.content || []).map(cell => join(cellLines(cell), '<br>', '\n'));
        return { html: `<p>${cells.map(cell => cell.html).join(' | ')}</p>`, text: cells.map(cell => cell.text).join(' | ') };
      }));
    }
    return blocks(node.content || []);
  }
  function blocks(nodes) { return join(nodes.map(block)); }
  const heading = (text, level) => block({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
  const parts = titles.includeTitle ? [heading(project.title, 1)] : [];
  for (const chapter of project.chapters) {
    if (titles.includeChapterTitles) parts.push(heading(chapter.title, 2));
    parts.push(...(chapter.content.content || []).map(block));
  }
  const { html, text } = join(parts);
  return { clipboardHTML: html, clipboardText: text };
}
