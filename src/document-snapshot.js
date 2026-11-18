// ProseMirror documents are immutable and reuse unchanged nodes between edits.
// Keep their plain JSON counterparts so a keystroke only serializes the changed
// branch, while preserving exactly the same representation as Node.toJSON().
const snapshots = new WeakMap();

export function documentSnapshot(node) {
  const previous = snapshots.get(node);
  if (previous) return previous;
  const result = { type: node.type.name };
  for (const key in node.attrs) { result.attrs = node.attrs; break; }
  if (node.content.size) {
    result.content = [];
    node.forEach(child => result.content.push(documentSnapshot(child)));
  }
  if (node.marks.length) result.marks = node.marks.map(mark => mark.toJSON());
  if (node.isText) result.text = node.text;
  snapshots.set(node, result);
  return result;
}
