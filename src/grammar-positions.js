export function paragraphPositions(doc) {
  const blocks = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    blocks.push({ node, start: pos + 1, end: pos + 1 + node.content.size });
    return false;
  });
  return blocks;
}

export function paragraphCovering(blocks, from, to) {
  let low = 0, high = blocks.length;
  while (low < high) { const middle = (low + high) >>> 1; if (blocks[middle].start <= from) low = middle + 1; else high = middle; }
  const block = blocks[low - 1];
  return block && to <= block.end ? block : null;
}
