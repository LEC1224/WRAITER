const paragraphCache = new WeakMap();

// Use the same text-block order as margin paragraph numbering, including
// headings, list items, quoted paragraphs, table cells and empty paragraphs.
export function paragraphLocations(doc) {
  if (!doc) return [];
  let paragraphs = paragraphCache.get(doc);
  if (!paragraphs) {
    paragraphs = [];
    doc.descendants((node, position) => {
      if (!node.isTextblock) return;
      paragraphs.push({ from: position + 1, to: position + node.nodeSize - 1, node });
      return false;
    });
    paragraphCache.set(doc, paragraphs);
  }
  return paragraphs;
}

export function currentParagraphNumber(doc, position = 0) {
  const paragraphs = paragraphLocations(doc);
  if (!paragraphs.length) return 0;
  const index = paragraphs.findLastIndex(paragraph => paragraph.from <= position);
  return Math.max(0, index) + 1;
}

export function paragraphPreview(paragraph, maximum = 160) {
  if (!paragraph) return '';
  const node = paragraph.node;
  const text = node.textBetween(0, node.content.size, ' ', leaf => leaf.type.name === 'hardBreak' ? ' ' : '[Image]').replace(/\s+/gu, ' ').trim();
  if (!text) return '(Empty paragraph)';
  const characters = Array.from(text);
  return characters.length > maximum ? characters.slice(0, maximum).join('') + '…' : text;
}
