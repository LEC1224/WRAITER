// Download the public dictionary once; selected manuscript words stay on device.
let pending;
const decoder = new TextDecoder();
async function unpack(name, limit) {
  const response = await fetch(`/assets/thesaurus/${name}.gz`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('The dictionary could not be downloaded.');
  const reader = response.body.pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) { await reader.cancel(); throw new Error('Dictionary too large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function dictionary() {
  if (!pending) pending = (async () => {
    const [indexBytes, data] = await Promise.all([unpack('th_en_US_v2.idx', 30_000_000), unpack('th_en_US_v2.dat', 100_000_000)]);
    const index = decoder.decode(indexBytes), start = index.indexOf('\n', index.indexOf('\n') + 1) + 1;
    if (!start || !/^utf-?8$/i.test(index.split('\n', 1)[0].trim()) || !/^utf-?8$/i.test(decoder.decode(data.subarray(0, 16)).split(/\r?\n/, 1)[0])) throw new Error('Unsupported dictionary encoding');
    return { index, data, start };
  })().catch(error => { pending = null; throw error; });
  return pending;
}
export async function browserThesaurus(word, language) {
  if (typeof word !== 'string' || !word.trim() || word.length > 120 || /[\r\n|]/.test(word)) return { available: true, senses: [] };
  if (String(language || '').toLowerCase().split('-')[0] !== 'en') return { available: false, senses: [] };
  let dict; try { dict = await dictionary(); } catch { return { available: false, senses: [] }; }
  const { index, data } = dict, key = word.trim().toLocaleLowerCase(); let low = dict.start, high = index.length;
  while (low < high) {
    const middle = (low + high) >>> 1, start = index.lastIndexOf('\n', middle - 1) + 1;
    let end = index.indexOf('\n', start); if (end < 0) end = index.length;
    const divider = index.lastIndexOf('|', end - 1); if (divider < start) break;
    const candidate = index.slice(start, divider);
    if (candidate === key) {
      const offset = Number(index.slice(divider + 1, end).trim());
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= data.length) break;
      const lines = decoder.decode(data.subarray(offset, Math.min(data.length, offset + 32768))).split(/\r?\n/), count = Math.min(50, Number(lines[0].split('|').at(-1)) || 0);
      return { available: true, senses: lines.slice(1, count + 1).map(line => { const [meaning, ...words] = line.split('|'); return { meaning, words: words.filter(Boolean).slice(0, 60) }; }).filter(sense => sense.words.length) };
    }
    if (candidate < key) low = end + 1; else high = start;
  }
  return { available: true, senses: [] };
}
