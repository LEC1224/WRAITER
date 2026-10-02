const inlineAttributes = {
  bold: [], italic: [], underline: [], strike: [],
  textStyle: ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'lineHeight'],
  highlight: ['color']
};
const paragraphAttributes = ['textAlign', 'lineHeight', 'spaceAfter', 'firstLineIndent'];
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function textblockAtSelection(selection, doc) {
  if (selection.node && !selection.node.isTextblock) return null;
  if (selection.$from.parent.isTextblock) return { node: selection.$from.parent, start: selection.$from.start() };
  let result = null;
  doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if (result) return false;
    if (node.isTextblock) { result = { node, start: position + 1 }; return false; }
  });
  return result;
}

function copiedMarks(marks) {
  return marks.filter(mark => owns(inlineAttributes, mark.type.name)).map(mark => ({
    type: mark.type.name,
    attrs: Object.fromEntries(inlineAttributes[mark.type.name].filter(name => mark.attrs[name] != null).map(name => [name, mark.attrs[name]]))
  }));
}

// A mixed selection deliberately uses its first character. IDs, links, comment
// anchors, page breaks and source text never enter the session's format buffer.
export function captureFormatting(state, documentStyle = {}) {
  if (!state?.selection || !state.doc) return null;
  const source = textblockAtSelection(state.selection, state.doc);
  if (!source || !['paragraph', 'heading'].includes(source.node.type.name)) return null;
  const { selection } = state;
  const position = Math.max(selection.from, source.start), resolved = state.doc.resolve(position);
  const marks = selection.empty ? state.storedMarks || resolved.marks() : resolved.nodeAfter?.isInline ? resolved.nodeAfter.marks : resolved.marks();
  const inline = copiedMarks(marks);
  const textStyle = inline.find(mark => mark.type === 'textStyle') || { type: 'textStyle', attrs: {} };
  if (!textStyle.attrs.fontFamily && documentStyle.fontFamily) textStyle.attrs.fontFamily = documentStyle.fontFamily;
  // Headings inherit their own size and line spacing from the paragraph style;
  // inserting the body's defaults would shrink an otherwise unstyled heading.
  if (source.node.type.name === 'paragraph' && !textStyle.attrs.fontSize && documentStyle.fontSize) textStyle.attrs.fontSize = typeof documentStyle.fontSize === 'number' ? `${documentStyle.fontSize}pt` : documentStyle.fontSize;
  if (Object.keys(textStyle.attrs).length && !inline.includes(textStyle)) inline.push(textStyle);
  const attrs = Object.fromEntries(paragraphAttributes.map(name => [name, source.node.attrs[name] ?? null]));
  if (source.node.type.name === 'paragraph' && attrs.lineHeight == null && documentStyle.lineHeight != null) attrs.lineHeight = documentStyle.lineHeight;
  if (source.node.type.name === 'heading') attrs.level = source.node.attrs.level;
  return { marks: inline, paragraph: { type: source.node.type.name, attrs }, sample: 'Formatting at selection start' };
}

function marksForSchema(formatting, schema) {
  return formatting.marks.filter(mark => mark && owns(inlineAttributes, mark.type) && schema.marks[mark.type]).map(mark => {
    const attrs = Object.fromEntries(inlineAttributes[mark.type].filter(name => mark.attrs?.[name] != null).map(name => [name, mark.attrs[name]]));
    return schema.marks[mark.type].create(attrs);
  });
}

function applyToTransaction(tr, formatting) {
  if (!Array.isArray(formatting?.marks) || !['paragraph', 'heading'].includes(formatting.paragraph?.type)) return false;
  const { selection } = tr, source = textblockAtSelection(selection, tr.doc);
  if (!source) return false;
  const schema = tr.doc.type.schema;
  const from = selection.empty ? source.start : selection.from;
  const to = selection.empty ? source.start + source.node.content.size : selection.to;
  const originalCaretMarks = selection.empty ? tr.storedMarks || selection.$from.marks() : null;
  const paragraphs = [];
  tr.doc.nodesBetween(from, to, (node, position) => {
    if (['paragraph', 'heading'].includes(node.type.name)) paragraphs.push({ node, position });
  });
  // An empty paragraph has no interval for nodesBetween to visit.
  if (selection.empty && !source.node.content.size && ['paragraph', 'heading'].includes(source.node.type.name) && !paragraphs.some(item => item.position === source.start - 1)) paragraphs.push({ node: source.node, position: source.start - 1 });
  const marks = marksForSchema(formatting, schema);
  for (const name of Object.keys(inlineAttributes)) if (schema.marks[name]) tr.removeMark(from, to, schema.marks[name]);
  for (const mark of marks) tr.addMark(from, to, mark);
  for (const { node, position } of paragraphs) {
    const current = tr.doc.nodeAt(position), resolved = tr.doc.resolve(position), parent = resolved.parent, index = resolved.index();
    let type = schema.nodes[formatting.paragraph.type];
    // A list item's first child must remain a paragraph. Preserve that list
    // (and table/blockquote containers) while applying its visual attributes.
    if (!type || !parent.canReplaceWith(index, index + 1, type)) type = current.type;
    const attrs = { ...node.attrs };
    for (const name of paragraphAttributes) if (owns(formatting.paragraph.attrs || {}, name)) attrs[name] = formatting.paragraph.attrs[name];
    if (type.name === 'heading') attrs.level = formatting.paragraph.type === 'heading' ? formatting.paragraph.attrs?.level || 1 : node.attrs.level || 1;
    tr.setNodeMarkup(position, type, attrs, current.marks);
  }
  if (selection.empty) {
    let stored = originalCaretMarks.filter(mark => !owns(inlineAttributes, mark.type.name));
    for (const mark of marks) stored = mark.addToSet(stored);
    tr.setStoredMarks(stored.filter(mark => tr.selection.$from.parent.type.allowsMarkType(mark.type)));
  }
  return true;
}

// This pure form is also used to verify formatting and undo without a view.
export function formattingTransaction(state, formatting) {
  const transaction = state.tr;
  return applyToTransaction(transaction, formatting) ? transaction : null;
}

export function pasteFormatting(editor, formatting) {
  if (!editor || editor.isDestroyed || !formatting) return false;
  // All character and paragraph changes share one transaction and undo step.
  return editor.chain().focus().command(({ tr }) => applyToTransaction(tr, formatting)).run();
}
