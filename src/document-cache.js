// Read-only analysis can share the editor's already validated immutable tree.
// Weak keys release both the JSON snapshot and tree when a revision is retired.
const documents = new WeakMap();
export function rememberParsedDocument(content, doc) {
  documents.set(content, doc);
  return content;
}
export function readParsedDocument(content, schema) {
  let doc = documents.get(content);
  if (!doc) { doc = schema.nodeFromJSON(content); documents.set(content, doc); }
  return doc;
}
