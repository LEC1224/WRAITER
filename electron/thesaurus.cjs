const fs = require('node:fs/promises');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');

const dictionaries = {
  en: ['dict-en', 'th_en_US_v2'], de: ['dict-de', 'th_de_DE_v2'], sv: ['dict-sv', 'th_sv_SE']
};
const cache = new Map();
async function load(language, root = process.env.ProgramFiles) {
  const spec = dictionaries[String(language || '').toLowerCase().split('-')[0]];
  if (!spec || !root) return null;
  const dir = path.join(root, 'LibreOffice', 'share', 'extensions', spec[0]);
  const key = path.join(dir, spec[1]);
  if (cache.has(key)) return cache.get(key);
  try {
    let idx, data;
    try { [idx, data] = await Promise.all([fs.readFile(key + '.idx'), fs.readFile(key + '.dat')]); }
    catch (error) {
      if (spec[0] !== 'dict-en' || root !== process.env.ProgramFiles) throw error;
      const bundled = path.join(__dirname, '..', 'assets', 'thesaurus', spec[1]);
      [idx, data] = (await Promise.all([fs.readFile(bundled + '.idx.gz'), fs.readFile(bundled + '.dat.gz')])).map(buffer => gunzipSync(buffer, { maxOutputLength: 100_000_000 }));
    }
    if (idx.length > 30_000_000 || data.length > 100_000_000) throw new Error('Dictionary too large');
    const lines = idx.toString('utf8').split(/\r?\n/);
    if (!/^utf-?8$/i.test(lines[0].trim()) || !/^utf-?8$/i.test(data.subarray(0, 16).toString('utf8').split(/\r?\n/)[0])) throw new Error('Unsupported dictionary encoding');
    const entries = new Map();
    for (const line of lines.slice(2)) { const split = line.lastIndexOf('|'), offset = Number(line.slice(split + 1)); if (split > 0 && Number.isSafeInteger(offset) && offset >= 0 && offset < data.length) entries.set(line.slice(0, split).toLocaleLowerCase(), offset); }
    const value = { entries, data }; cache.set(key, value); return value;
  } catch { return null; }
}
async function lookup(word, language, root) {
  if (typeof word !== 'string' || !word.trim() || word.length > 120 || /[\r\n|]/.test(word)) return { available: true, senses: [] };
  const dict = await load(language, root); if (!dict) return { available: false, senses: [] };
  const offset = dict.entries.get(word.trim().toLocaleLowerCase()); if (offset == null) return { available: true, senses: [] };
  const text = dict.data.subarray(offset, Math.min(dict.data.length, offset + 32768)).toString('utf8').split(/\r?\n/);
  const count = Math.min(50, Number(text[0].split('|').at(-1)) || 0);
  return { available: true, senses: text.slice(1, count + 1).map(line => { const [meaning, ...words] = line.split('|'); return { meaning, words: words.filter(Boolean).slice(0, 60) }; }).filter(sense => sense.words.length) };
}
module.exports = { lookup };
