const { cleanResult, getSuggestionLimit } = require('./core.cjs');

function parseRephraseOptions(raw, request) {
  let text = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  if (text.length > 200000) throw new Error('The rephrasing response was too large. Select a shorter passage.');
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    // Older/base models may still return a single replacement. Never invent a
    // rating or description for it, or offer malformed JSON as manuscript text.
    if (/^[{[]/.test(text)) throw new Error('The model returned an incomplete alternatives list. Try again.');
    parsed = { alternatives: [{ text, rating: null }] };
  }
  if (typeof parsed === 'string') parsed = { alternatives: [{ text: parsed, rating: null }] };
  if (parsed?.currentRating != null && ![1, 2, 3].includes(parsed.currentRating)) throw new Error('The model returned an invalid current phrase rating. Try again.');
  const currentRating = parsed?.currentRating;
  const allowedKinds = request.mode === 'correct' ? ['translation', 'correction'] : ['translation', 'rephrase'];
  if (parsed?.kind != null && !allowedKinds.includes(parsed.kind)) throw new Error('The model returned an invalid suggestion type. Try again.');
  const kind = parsed?.kind;
  if (!Array.isArray(parsed?.alternatives) || (!parsed.alternatives.length && currentRating == null) || parsed.alternatives.length > 8) throw new Error('The model did not return a valid rephrasing list. Try again.');
  const seen = new Set(), alternatives = [];
  for (const item of parsed.alternatives) {
    if (typeof item?.text !== 'string' || !item.text.trim() || item.text.length > 64000 || (item.rating != null && ![1, 2, 3].includes(item.rating))) throw new Error('The model returned an invalid rephrasing option. Try again.');
    const replacement = cleanResult(item.text, request.mode === 'correct' ? 'correct' : 'rewrite', request.words, request), signature = replacement.trim().normalize('NFC').toLocaleLowerCase();
    if (!replacement.trim() || seen.has(signature)) continue;
    const description = typeof item.description === 'string' ? item.description.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\s+/g, ' ').trim() : '';
    const note = description.length > 280 ? `${description.slice(0, 277).trimEnd()}…` : description;
    seen.add(signature); alternatives.push({ text: replacement, rating: item.rating ?? null, ...(note ? { description: note } : {}) });
  }
  alternatives.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (!alternatives.length && currentRating == null) throw new Error('No usable alternatives were returned. Try again.');
  return { ...(currentRating != null ? { currentRating } : {}), ...(kind != null ? { kind } : {}), alternatives: alternatives.slice(0, getSuggestionLimit(request, kind ?? (request.mode === 'correct' ? 'correction' : undefined))) };
}
module.exports = { parseRephraseOptions };
