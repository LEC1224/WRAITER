const { validateProofreadRequest, buildProofreadPrompt, parseProofreadResult } = require('./proofreading.cjs');

// Background checks send a bounded batch of manuscript text and no private
// notes, voice instructions, reference files, titles, or earlier conversations.
function validateInlineRequest(input) {
  if (!input || input.scope !== 'selection' || !Array.isArray(input.passages) || input.passages.length < 1 || input.passages.length > 6) throw new Error('Inline grammar needs between one and six passages.');
  let characters = 0;
  const passages = input.passages.map((passage, index) => {
    if (!passage || typeof passage.text !== 'string' || passage.text.length > 4000) throw new Error('Inline grammar passages are limited to 4,000 characters.');
    characters += passage.text.length;
    return { id: passage.id, chapterTitle: '', paragraph: index + 1, text: passage.text };
  });
  if (characters > 12000) throw new Error('Inline grammar batches are limited to 12,000 characters.');
  return validateProofreadRequest({ id: input.id, projectId: input.projectId, scope: 'selection', language: input.language, style: '', passages });
}

async function runInlineProofread(providers, settings, key, input, signal) {
  const request = validateInlineRequest(input), prompt = buildProofreadPrompt(request);
  prompt.system += ` These findings will appear as inline error underlines, so precision matters more than the number of findings. Report only definite or likely errors supported by the supplied sentence; omit optional style, phrasing and consistency advice. Do not infer an error from a passage boundary or incomplete final sentence while the author may still be typing. Repeated words are not automatically wrong: “She had had enough” and “I knew that that was true” are grammatical. Preserve intentional emphasis, dialogue, and regional spelling. Use the smallest complete correction, not a rewritten sentence. Return at most 48 findings across the entire batch; do not invent findings to fill a quota.`;
  // Proofreading JSON needs a different budget from short writing suggestions.
  const raw = await providers.generateStructured({ ...settings, agentTokenCap: 8192, temperature: Math.min(settings.temperature ?? 0.2, 0.2) }, key, prompt, signal);
  signal?.throwIfAborted();
  // Never guess which repeated occurrence should acquire an underline.
  const result = parseProofreadResult(raw, request, { strictLocation: true, errorsOnly: true });
  return { findings: result.findings.slice(0, 48) };
}
function canReserveInline(requests, foregroundPending) { return !foregroundPending && requests.size === 0; }
async function cancelInline(requests, id) {
  if (typeof id !== 'string' || !id || id.length > 200) return false;
  const controller = requests.get(id);
  if (!controller || controller.kind !== 'inline-grammar') return false;
  controller.abort(); await controller.finished; return true;
}
module.exports = { validateInlineRequest, runInlineProofread, canReserveInline, cancelInline };
