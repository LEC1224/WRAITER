const { validateProofreadRequest } = require('./proofreading.cjs');

// Background checks send one bounded piece of manuscript text and no private
// notes, voice instructions, reference files, titles, or earlier conversations.
function validateInlineRequest(input) {
  if (!input || input.scope !== 'selection' || !Array.isArray(input.passages) || input.passages.length !== 1) throw new Error('Inline grammar needs one selected passage.');
  const passage = input.passages[0];
  if (!passage || typeof passage.text !== 'string' || passage.text.length > 4000) throw new Error('Inline grammar passages are limited to 4,000 characters.');
  return validateProofreadRequest({ id: input.id, projectId: input.projectId, scope: 'selection', language: input.language, style: '', passages: [{ id: passage.id, chapterTitle: '', paragraph: 1, text: passage.text }] });
}
function canReserveInline(requests, foregroundPending) { return !foregroundPending && requests.size === 0; }
async function cancelInline(requests, id) {
  if (typeof id !== 'string' || !id || id.length > 200) return false;
  const controller = requests.get(id);
  if (!controller || controller.kind !== 'inline-grammar') return false;
  controller.abort(); await controller.finished; return true;
}
module.exports = { validateInlineRequest, canReserveInline, cancelInline };
