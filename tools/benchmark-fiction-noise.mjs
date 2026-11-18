// Inspect grammar suggestions in a local, externally sourced prose file.
// This is a noise diagnostic, not a gold-standard false-positive score.
// Example source: Project Gutenberg eBook 11, public-domain text in the USA.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { LocalLinter, Dialect } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { configureHarper, analyzeHarper } from '../src/offline-grammar-analysis.js';
import { grammarHints } from '../src/local-grammar-rules.js';

const require = createRequire(import.meta.url), nspell = require('nspell');
const { OfflineGrammar } = require('../electron/offline-grammar.cjs');
const input = process.argv[2] || 'tmp/alice-public-domain.txt', output = process.argv[3] || 'tmp/fiction-grammar-noise.json', language = process.argv[4] || 'en-GB';
const raw = await readFile(input, 'utf8');
const chapter = raw.search(/\nCHAPTER I\.\s*\r?\n/i), startMarker = raw.search(/\*\*\* START OF THE PROJECT GUTENBERG/i), finish = raw.search(/\*\*\* END OF THE PROJECT GUTENBERG/i);
const start = chapter >= 0 && chapter < finish ? chapter : startMarker;
if (start < 0 || finish <= start) throw new Error('Expected a Project Gutenberg novel with start and end markers.');
const paragraphs = raw.slice(start, finish).split(/\r?\n\s*\r?\n/).map(text => text.replace(/\s+/gu, ' ').trim())
  .filter(text => text.length >= 40 && text.length <= 3000 && !/^CHAPTER\b/i.test(text) && !/^\*{3}/.test(text) && !text.includes('_'));
const dictionary = nspell(await readFile('node_modules/dictionary-en-gb/index.aff'), await readFile('node_modules/dictionary-en-gb/index.dic'));
const linter = new LocalLinter({ binary: binaryInlined, dialect: /^en-US/i.test(language) ? Dialect.American : Dialect.British });
const deep = new OfflineGrammar(path.resolve('build/offline-grammar/payload'));
await linter.setup(); await configureHarper(linter);
const counts = {}, findings = [];
try {
  for (let offset = 0; offset < paragraphs.length;) {
    const batch = []; let length = 0;
    while (offset < paragraphs.length && batch.length < 16 && length + paragraphs[offset].length <= 12000) { const text = paragraphs[offset++]; batch.push(text); length += text.length; }
    const additional = await deep.check({ language, texts: batch });
    for (let index = 0; index < batch.length; index++) {
      const text = batch[index], basic = grammarHints(text, language).map(hint => ({ ...hint, rule: 'wraiter' }));
      const harper = (await analyzeHarper(linter, text, dictionary)).filter(hint => hint.category === 'grammar');
      for (const hint of [...basic, ...harper, ...additional[index]]) {
        counts[hint.rule] = (counts[hint.rule] || 0) + 1;
        findings.push({ text, rule: hint.rule, original: hint.original, replacement: hint.replacement, from: hint.from, to: hint.to });
      }
    }
    if (offset % 160 === 0) console.log(`Checked ${offset} of ${paragraphs.length} prose paragraphs.`);
  }
} finally { deep.stop(); await linter.dispose?.(); }
await writeFile(output, JSON.stringify({ note: 'Published fiction is not guaranteed error-free; individual suggestions require human review. Overlapping engine suggestions are counted separately.', paragraphs: paragraphs.length, words: paragraphs.join(' ').split(/\s+/u).length, counts, findings }, null, 2));
console.log(JSON.stringify({ paragraphs: paragraphs.length, words: paragraphs.join(' ').split(/\s+/u).length, suggestions: findings.length, topRules: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15), output }, null, 2));
