export function findTextMatches(doc, query, maximum = 2000) {
  if (!query) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock || matches.length >= maximum) return;
    const text = node.textBetween(0, node.content.size, '', leaf => leaf.type.name === 'hardBreak' ? '\n' : '\uFFFC');
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(text)) && matches.length < maximum) matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length });
    return false;
  });
  return matches;
}
