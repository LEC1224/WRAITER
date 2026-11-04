const { buildPrompt } = require('./core.cjs');

const MARGIN_TOKENS = 512;
const DEFAULT_CONTEXT_LENGTH = 32768;
const GUIDED_COMPLETION_INSTRUCTION = 'Return JSON with exactly one string field named completion containing the requested prose, with no commentary.';
const OMITTED_PASSAGE = '\n[Earlier passage omitted to fit context]\n';

class ContinuationContextError extends Error {
  constructor(contextLength, requiredTokens, outputTokens) {
    super(`The local context window is too small for the writing instructions, nearby story text, and ${outputTokens} output tokens (estimated ${requiredTokens} tokens needed; window ${contextLength}). Increase the local context window or reduce the output limit.`);
    this.name = 'ContinuationContextError';
    this.code = 'CONTINUATION_CONTEXT_TOO_SMALL';
    this.contextLength = contextLength;
    this.estimatedRequiredTokens = requiredTokens;
  }
}

// This is a conservative planning estimate, not the selected model's tokenizer.
// Reserve additional space separately for chat framing and tokenizer variation.
function estimatePromptTokens(text) {
  let ascii = 0, nonAscii = 0;
  for (const character of String(text)) {
    if (character.codePointAt(0) < 128) ascii++;
    else nonAscii += character.length;
  }
  return Math.ceil(ascii / 3 + nonAscii * 1.5);
}

const wordsOf = text => String(text || '').match(/\S+\s*/gu) || [];
const integer = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;

function manuscriptContext(text, words, budget) {
  if (words.length <= budget) return text;
  // Opening context is useful only after the immediate scene has enough room.
  const opening = budget >= 128 ? Math.min(150, Math.floor(budget / 5), budget - 64) : 0;
  if (!opening) return words.slice(-budget).join('');
  return `${words.slice(0, opening).join('').trimEnd()}${OMITTED_PASSAGE}${words.slice(-(budget - opening)).join('')}`;
}

function prefix(text, limit) {
  if (text.length <= limit) return text;
  let end = Math.max(0, limit);
  if (end && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
  const candidate = text.slice(0, end);
  const boundary = candidate.search(/\s+\S*$/u);
  return (boundary > end / 2 ? candidate.slice(0, boundary) : candidate).trimEnd();
}

// Water-fill the shared budget: a large first sheet cannot crowd every later
// reference out of buildPrompt's 48,000-character reference allowance.
function fairPrefixes(items, budget, getText, replaceText) {
  const allocations = items.map(() => 0);
  let remaining = Math.max(0, Math.floor(budget));
  let active = items.map((item, index) => index).filter(index => getText(items[index]).length);
  while (remaining && active.length) {
    const share = Math.max(1, Math.floor(remaining / active.length));
    const next = [];
    for (const index of active) {
      const available = getText(items[index]).length - allocations[index];
      const grant = Math.min(share, available, remaining);
      allocations[index] += grant;
      remaining -= grant;
      if (available > grant) next.push(index);
    }
    active = next;
  }
  return items.map((item, index) => replaceText(item, prefix(getText(item), allocations[index]))).filter(item => getText(item).length);
}

function prepareContinuationContext(settings, request, { outputTokens = 256, forceReduced = false, extraSystem = '', guided = true } = {}) {
  if (request?.mode !== 'continue') throw new TypeError('Continuation context preparation requires a continuation request.');
  const prepared = structuredClone(request);
  const contextLength = integer(settings?.localContextLength, DEFAULT_CONTEXT_LENGTH);
  const reservedOutput = integer(outputTokens, 256);
  const originalBefore = String(prepared.before || '');
  const manuscriptWords = wordsOf(originalBefore);
  const requestedWords = integer(prepared.contextWords, 2000);
  let manuscriptBudget = Math.min(manuscriptWords.length, requestedWords);
  const initialManuscriptBudget = manuscriptBudget;
  const minimumManuscriptWords = Math.min(64, manuscriptBudget);
  const originalReferences = Array.isArray(prepared.references) ? prepared.references : [];
  const availableReferences = originalReferences.slice(0, 20);
  const referenceHeaders = availableReferences.reduce((sum, reference) => sum + Math.min(200, String(reference.name || '').length) + 3, 0) + Math.max(0, availableReferences.length - 1) * 2;
  const referenceLength = availableReferences.reduce((sum, reference) => sum + String(reference.text || '').length, 0);
  let referenceBudget = Math.min(referenceLength, Math.max(0, 48000 - referenceHeaders));
  const originalHistory = Array.isArray(prepared.history) ? prepared.history : [];
  const availableHistory = originalHistory.slice(-3).map(text => String(text).slice(0, 1500));
  const historyLength = availableHistory.reduce((sum, text) => sum + text.length, 0);
  let historyBudget = historyLength;

  if (forceReduced) {
    referenceBudget = Math.floor(referenceBudget / 2);
    historyBudget = Math.floor(historyBudget / 2);
    manuscriptBudget = Math.max(minimumManuscriptWords, Math.floor(manuscriptBudget / 2));
  }

  let prompt, estimatedPromptTokens, estimatedTotalTokens;
  function measure() {
    prepared.references = fairPrefixes(availableReferences, referenceBudget, reference => String(reference.text || ''), (reference, text) => ({ ...reference, text }));
    prepared.history = fairPrefixes(availableHistory, historyBudget, text => text, (_text, value) => value);
    prepared.before = manuscriptContext(originalBefore, manuscriptWords, manuscriptBudget);
    // Context has already been selected here; do not let buildPrompt perform a
    // second opening/tail split that could discard words nearest the cursor.
    prepared.contextWords = Math.max(requestedWords, 1, wordsOf(prepared.before).length);
    prompt = buildPrompt(prepared);
    // buildPrompt's general-purpose style cap must not silently remove author
    // guidance from this path. Full guidance is irreducible context here.
    if (typeof prepared.style === 'string' && prepared.style.length > 6000) prompt.system += prepared.style.slice(6000);
    if (extraSystem) prompt.system += `\n${extraSystem}`;
    const wireText = `${prompt.system}${guided ? `\n${GUIDED_COMPLETION_INSTRUCTION}` : ''}\n\n${prompt.user}`;
    estimatedPromptTokens = estimatePromptTokens(wireText) + 32;
    estimatedTotalTokens = estimatedPromptTokens + reservedOutput + MARGIN_TOKENS;
    return estimatedTotalTokens <= contextLength;
  }

  // Try to retain as much of each category as the estimate permits. A failed
  // minimum is left in place while the next, lower-priority category is reduced.
  function fitBudget(current, minimum, setBudget) {
    setBudget(minimum);
    if (!measure()) return;
    let low = minimum, high = current;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      setBudget(middle);
      if (measure()) low = middle;
      else high = middle - 1;
    }
    setBudget(low);
    measure();
  }

  if (!measure()) fitBudget(referenceBudget, 0, value => { referenceBudget = value; });
  if (estimatedTotalTokens > contextLength) fitBudget(manuscriptBudget, minimumManuscriptWords, value => { manuscriptBudget = value; });
  if (estimatedTotalTokens > contextLength) fitBudget(historyBudget, 0, value => { historyBudget = value; });
  if (estimatedTotalTokens > contextLength) throw new ContinuationContextError(contextLength, estimatedTotalTokens, reservedOutput);

  const notices = [];
  const referencesChanged = prepared.references.length !== originalReferences.length || prepared.references.some((reference, index) => reference.text !== originalReferences[index]?.text);
  if (referencesChanged) notices.push(prepared.references.length ? 'Reference material was shortened or omitted to fit the estimated local context budget for this suggestion only.' : 'Reference material was omitted to fit the estimated local context budget for this suggestion only.');
  if (manuscriptBudget < initialManuscriptBudget) notices.push('Older story text was reduced to fit the estimated local context budget for this suggestion only; the text nearest the cursor was kept.');
  if (prepared.history.length !== originalHistory.length || prepared.history.some((text, index) => text !== originalHistory[index])) notices.push('Rejected suggestions were shortened or omitted to fit the estimated local context budget for this suggestion only.');
  return { request: prepared, prompt, notices, contextLength, estimatedPromptTokens, estimatedTotalTokens, outputTokens: reservedOutput, marginTokens: MARGIN_TOKENS };
}

module.exports = { prepareContinuationContext, estimatePromptTokens, estimateTokens: estimatePromptTokens, ContinuationContextError, GUIDED_COMPLETION_INSTRUCTION, MARGIN_TOKENS };
