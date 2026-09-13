const { cleanResult } = require('./core.cjs');

function parseRephraseOptions(raw, request) {
  let text = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  if (text.length > 200000) throw new Error('The rephrasing response was too large. Select a shorter passage.');
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    // Older/base models may still return a single replacement. Never invent a
    // rating for it, or accidentally offer malformed JSON as manuscript text.
    if (/^[{[]/.test(text)) throw new Error('The model returned an incomplete alternatives list. Try again.');
    parsed = { alternatives: [{ text, rating: null }] };
  }
  if (typeof parsed === 'string') parsed = { alternatives: [{ text: parsed, rating: null }] };
  if (!Array.isArray(parsed?.alternatives) || !parsed.alternatives.length || parsed.alternatives.length > 8) throw new Error('The model did not return a valid rephrasing list. Try again.');
  const seen = new Set(), alternatives = [];
  for (const item of parsed.alternatives) {
    if (typeof item?.text !== 'string' || !item.text.trim() || item.text.length > 64000 || (item.rating != null && ![1, 2, 3].includes(item.rating))) throw new Error('The model returned an invalid rephrasing option. Try again.');
    const replacement = cleanResult(item.text, 'rewrite', request.words, request), signature = replacement.trim().normalize('NFC').toLocaleLowerCase();
    if (!replacement.trim() || seen.has(signature)) continue;
    seen.add(signature); alternatives.push({ text: replacement, rating: item.rating ?? null });
  }
  alternatives.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (!alternatives.length) throw new Error('No usable alternatives were returned. Try again.');
  return { alternatives: alternatives.slice(0, 3) };
}
module.exports = { parseRephraseOptions };
