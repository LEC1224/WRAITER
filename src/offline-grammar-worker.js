import { LocalLinter, Dialect } from 'harper.js';
import { binary } from 'harper.js/binary';
import nspell from 'nspell';
import usAffix from '../node_modules/dictionary-en/index.aff?raw';
import usWords from '../node_modules/dictionary-en/index.dic?raw';
import gbAffix from '../node_modules/dictionary-en-gb/index.aff?raw';
import gbWords from '../node_modules/dictionary-en-gb/index.dic?raw';
import auAffix from '../node_modules/dictionary-en-au/index.aff?raw';
import auWords from '../node_modules/dictionary-en-au/index.dic?raw';
import caAffix from '../node_modules/dictionary-en-ca/index.aff?raw';
import caWords from '../node_modules/dictionary-en-ca/index.dic?raw';
import { configureHarper, analyzeHarper } from './offline-grammar-analysis.js';
import { grammarHints } from './local-grammar-rules.js';
import { learnedGrammarHints } from './learned-grammar.js';

// There is one worker for all open editors. Each dialect keeps its own linter
// so changing tabs cannot reset another editor's dictionary or rule settings.
const engines = new Map();
async function engine(language) {
  const british = /^en-(?:gb|ie|za|nz)(?:-|$)/i.test(language);
  const key = british ? 'gb' : /^en-au(?:-|$)/i.test(language) ? 'au' : /^en-ca(?:-|$)/i.test(language) ? 'ca' : 'us';
  let value = engines.get(key);
  if (!value) {
    const dialect = { us: Dialect.American, gb: Dialect.British, au: Dialect.Australian, ca: Dialect.Canadian }[key];
    const linter = new LocalLinter({ binary, dialect });
    await linter.setup();
    await configureHarper(linter);
    const [affix, words] = { us: [usAffix, usWords], gb: [gbAffix, gbWords], au: [auAffix, auWords], ca: [caAffix, caWords] }[key];
    const dictionary = nspell(affix, words);
    value = { linter, dictionary }; engines.set(key, value);
  }
  return value;
}

// Serialize jobs: importing custom words or switching dialect must never race
// a check belonging to another editor. The renderer sends bounded batches.
let previous = Promise.resolve();
const jobs = new Map();
self.onmessage = event => {
  const request = event.data;
  if (request.cancel !== undefined) {
    const job = jobs.get(request.cancel);
    if (job) job.cancelled = true;
    return;
  }
  const job = { cancelled: false };
  jobs.set(request.id, job);
  previous = previous.catch(() => {}).then(async () => {
    try {
      // Swedish spelling uses Chromium's bundled dictionary; only the deeper
      // local grammar process checks Swedish. Do not run an English linter on it.
      if (/^sv(?:-|$)/i.test(request.language)) {
        self.postMessage({ id: request.id, results: request.texts.map(() => []) });
        return;
      }
      const { linter, dictionary } = await engine(request.language);
      const results = [];
      let yieldAt = performance.now() + 16;
      for (const text of request.texts) {
        // WASM promises can resolve in the same event-loop turn. Give the
        // worker a chance to receive cancellation between long passages.
        if (performance.now() >= yieldAt) {
          await new Promise(resolve => setTimeout(resolve, 0));
          yieldAt = performance.now() + 16;
        }
        if (job.cancelled) break;
        // A pasted identifier thousands of characters long is not a useful
        // dictionary lookup. Mask it without changing offsets or joining text.
        const safe = text.replace(/[\p{L}\p{N}_]{128,}/gu, word => '\ufffc'.repeat(word.length));
        const local = grammarHints(safe, request.language).map(hint => ({ ...hint, category: 'grammar', rule: 'wraiter' }));
        results.push([...local, ...await analyzeHarper(linter, safe, dictionary, request.words), ...learnedGrammarHints(safe, request.language)]);
      }
      self.postMessage(job.cancelled ? { id: request.id, cancelled: true } : { id: request.id, results });
    } catch (error) {
      self.postMessage({ id: request.id, error: String(error?.message || error) });
    } finally { jobs.delete(request.id); }
  });
};
