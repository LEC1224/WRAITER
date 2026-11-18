const fs = require('node:fs/promises');
const path = require('node:path');
const { gunzip } = require('node:zlib');
const { promisify } = require('node:util');
const unzip = promisify(gunzip);

const dictionaries = {
  en: ['dict-en', 'th_en_US_v2'], de: ['dict-de', 'th_de_DE_v2'], sv: ['dict-sv', 'th_sv_SE']
};
const cache = new Map(), pending = new Map();
async function load(language, root = process.env.ProgramFiles) {
  const spec = dictionaries[String(language || '').toLowerCase().split('-')[0]];
  if (!spec || !root) return null;
  const dir = path.join(root, 'LibreOffice', 'share', 'extensions', spec[0]);
  const key = path.join(dir, spec[1]);
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);
  const work = (async () => { try {
    let idx, data, bundled = false;
    try { [idx, data] = await Promise.all([fs.readFile(key + '.idx'), fs.readFile(key + '.dat')]); }
    catch (error) {
      if (spec[0] !== 'dict-en' || root !== process.env.ProgramFiles) throw error;
      const base = path.join(__dirname, '..', 'assets', 'thesaurus', spec[1]);
      const compressed = await Promise.all([fs.readFile(base + '.idx.gz'), fs.readFile(base + '.dat.gz')]);
      [idx, data] = await Promise.all([unzip(compressed[0], { maxOutputLength: 30_000_000 }), unzip(compressed[1], { maxOutputLength: 100_000_000 })]);
      bundled = true;
    }
    if (idx.length > 30_000_000 || data.length > 100_000_000) throw new Error('Dictionary too large');
    const index = idx.toString('utf8');
    const headerEnd = index.indexOf('\n');
    if (!/^utf-?8$/i.test((headerEnd < 0 ? index : index.slice(0, headerEnd)).trim()) || !/^utf-?8$/i.test(data.subarray(0, 16).toString('utf8').split(/\r?\n/)[0])) throw new Error('Unsupported dictionary encoding');
    if (bundled) {
      // The bundled WordNet index is sorted, unique and lowercase ASCII. Search
      // its lines directly instead of eagerly allocating 145,000 Map entries.
      const start = index.indexOf('\n', index.indexOf('\n') + 1) + 1;
      if (!start) throw new Error('Invalid bundled dictionary index');
      return { index, start, data };
    }
    const lines = index.split(/\r?\n/);
    const entries = new Map();
    for (const line of lines.slice(2)) { const split = line.lastIndexOf('|'), offset = Number(line.slice(split + 1)); if (split > 0 && Number.isSafeInteger(offset) && offset >= 0 && offset < data.length) entries.set(line.slice(0, split).toLocaleLowerCase(), offset); }
    return { entries, data };
  } catch { return null; } })();
  pending.set(key, work);
  try { const value = await work; if (value) cache.set(key, value); return value; }
  finally { pending.delete(key); }
}

function bundledOffset(dictionary, word) {
  const index = dictionary.index; let low = dictionary.start, high = index.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const start = index.lastIndexOf('\n', middle - 1) + 1;
    let end = index.indexOf('\n', start); if (end < 0) end = index.length;
    const divider = index.lastIndexOf('|', end - 1);
    if (divider < start) return null;
    const candidate = index.slice(start, divider);
    if (candidate === word) {
      const offset = Number(index.slice(divider + 1, end).trim());
      return Number.isSafeInteger(offset) && offset >= 0 && offset < dictionary.data.length ? offset : null;
    }
    if (candidate < word) low = end + 1; else high = start;
  }
  return null;
}
async function lookup(word, language, root) {
  if (typeof word !== 'string' || !word.trim() || word.length > 120 || /[\r\n|]/.test(word)) return { available: true, senses: [] };
  const dict = await load(language, root); if (!dict) return { available: false, senses: [] };
  const key = word.trim().toLocaleLowerCase();
  const offset = dict.entries ? dict.entries.get(key) : bundledOffset(dict, key); if (offset == null) return { available: true, senses: [] };
  const text = dict.data.subarray(offset, Math.min(dict.data.length, offset + 32768)).toString('utf8').split(/\r?\n/);
  const count = Math.min(50, Number(text[0].split('|').at(-1)) || 0);
  return { available: true, senses: text.slice(1, count + 1).map(line => { const [meaning, ...words] = line.split('|'); return { meaning, words: words.filter(Boolean).slice(0, 60) }; }).filter(sense => sense.words.length) };
}
module.exports = { lookup };
