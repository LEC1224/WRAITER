function dialogueBoundaries(text) {
  const boundaries = [];
  let closing = null;
  for (const match of text.matchAll(/["“”‘’']/gu)) {
    const i = match.index, char = match[0];
    if (/['’]/u.test(char) && /[\p{L}\p{N}]/u.test(text[i - 1] || '') && /[\p{L}\p{N}]/u.test(text[i + 1] || '')) continue;
    if (!closing && /['’]/u.test(char) && /[\p{L}\p{N}]/u.test(text[i - 1] || '')) continue;
    if (closing && /['’]/u.test(char) && /s/iu.test(text[i - 1] || '') && /^\s+\p{Ll}/u.test(text.slice(i + 1))) continue;
    if (closing && char === closing) closing = null;
    else if (!closing && /["'“‘]/u.test(char)) closing = ({ '“': '”', '‘': '’' })[char] || char;
    else continue;
    boundaries.push(i + 1);
  }
  return boundaries;
}

export function dialogueLookup(text) {
  let boundaries;
  return position => {
    boundaries ??= dialogueBoundaries(text);
    let low = 0, high = boundaries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (boundaries[middle] <= position) low = middle + 1; else high = middle;
    }
    return low % 2 !== 0;
  };
}
