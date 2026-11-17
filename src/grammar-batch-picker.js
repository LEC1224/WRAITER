// Prioritize the caret and skip completed blocks on later background batches.
export function createGrammarBatchPicker(blocks, readChunks) {
  const cursors = { basicIndex: 0, deepIndex: 0 };
  return function nextBatch(selection, deep = false) {
    const cursor = deep ? 'deepIndex' : 'basicIndex', status = deep ? 'deepStatus' : 'status';
    const countLimit = deep ? 2 : 16, lengthLimit = deep ? 3500 : 12000;
    const tasks = new Set();
    let length = 0, full = false;

    function take({ node, pos }, atCaret = false) {
      let chunks = readChunks(node, deep);
      if (!chunks) return false;
      if (atCaret && chunks.length > 1) {
        const caret = selection - pos - 1;
        const distance = chunk => Math.max(0, chunk.from - caret, caret - chunk.from - chunk.text.length);
        chunks = [...chunks].sort((a, b) => distance(a) - distance(b) || a.from - b.from);
      }
      let done = true;
      for (const chunk of chunks) {
        if (chunk[status] === 'done') continue;
        done = false;
        if (chunk[status] !== 'waiting' || (deep && chunk.status !== 'done') || tasks.has(chunk)) continue;
        if (tasks.size && length + chunk.text.length > lengthLimit) { full = true; break; }
        tasks.add(chunk); length += chunk.text.length;
        if (tasks.size === countLimit) { full = true; break; }
      }
      return done;
    }

    // Both adjacent textblocks can touch a boundary selection. Preserve their
    // document order before filling the batch from the earliest unfinished one.
    let low = 0, high = blocks.length;
    while (low < high) {
      const middle = (low + high) >>> 1, block = blocks[middle];
      if (block.pos + block.node.nodeSize < selection) low = middle + 1; else high = middle;
    }
    for (let i = low; !full && i < blocks.length && blocks[i].pos <= selection; i++) take(blocks[i], true);
    for (let i = cursors[cursor]; !full && i < blocks.length; i++) {
      if (take(blocks[i]) && i === cursors[cursor]) cursors[cursor]++;
    }
    return [...tasks];
  };
}
