// Evaluate labeled local examples. LanguageTool's own examples are not an
// independent benchmark for LanguageTool, Word, Google Docs, or fiction.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { LocalLinter, Dialect } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { configureHarper, analyzeHarper } from '../src/offline-grammar-analysis.js';
import { grammarHints } from '../src/local-grammar-rules.js';

const require = createRequire(import.meta.url), nspell = require('nspell');
const { OfflineGrammar } = require('../electron/offline-grammar.cjs');
const source = process.argv[2] || 'test-output/grammar-examples.json';
const output = process.argv[3] || 'test-output/grammar-corpus-results.json';
const detailOutput = process.argv[4];
const includeSpelling = process.argv.includes('--include-spelling');
const data = JSON.parse(await readFile(source, 'utf8'));
const dictionary = nspell(await readFile('node_modules/dictionary-en/index.aff'), await readFile('node_modules/dictionary-en/index.dic'));
const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
const deep = new OfflineGrammar(path.resolve('build/offline-grammar/payload'));
await linter.setup(); await configureHarper(linter);
const counts = { positive: data.positive.length, negative: data.negative.length, basicDetected: 0, harperDetected: 0, combinedDetected: 0, exactCorrection: 0, negativeFlagged: 0 };
const byCategory = {};
const details = { negativeFlagged: [], positiveMissed: [] };
const examples = [...data.positive.map(item => ({ ...item, positive: true })), ...data.negative.map(item => ({ ...item, positive: false }))];
const overlaps = (hint, item) => hint.from < item.to && hint.to > item.from;
const started = Date.now();
try {
  for (let offset = 0; offset < examples.length; offset += 16) {
    const batch = examples.slice(offset, offset + 16), texts = batch.map(item => item.text);
    const deepPromise = deep.check({ language: 'en-US', texts });
    const local = [];
    for (const item of batch) {
      const basic = grammarHints(item.text), harper = (await analyzeHarper(linter, item.text, dictionary)).filter(hint => includeSpelling || hint.category !== 'spelling');
      local.push({ basic, harper });
    }
    const additional = await deepPromise;
    for (let index = 0; index < batch.length; index++) {
      const item = batch[index], { basic, harper } = local[index], all = [...basic, ...harper, ...additional[index]];
      const category = byCategory[item.category || 'unspecified'] ||= { positive: 0, combinedDetected: 0, exactCorrection: 0, negative: 0, negativeFlagged: 0 };
      if (item.positive) {
        category.positive++;
        const gold = item.correction.split('|').map(replacement => item.text.slice(0, item.from) + replacement + item.text.slice(item.to));
        // A fix that changes the same sentence to the gold text counts even
        // when its range only touches the annotated edit (e.g. an insertion).
        const fixes = hint => (hint.alternatives || [hint.replacement]).some(replacement => typeof replacement === 'string' && gold.includes(item.text.slice(0, hint.from) + replacement + item.text.slice(hint.to)));
        const detects = hint => overlaps(hint, item) || fixes(hint);
        if (basic.some(detects)) counts.basicDetected++;
        if ([...basic, ...harper].some(detects)) counts.harperDetected++;
        if (all.some(detects)) { counts.combinedDetected++; category.combinedDetected++; }
        else if (detailOutput) details.positiveMissed.push({ ...item, hints: all });
        if (all.some(fixes)) { counts.exactCorrection++; category.exactCorrection++; }
      } else { category.negative++; if (all.length) { counts.negativeFlagged++; category.negativeFlagged++; if (detailOutput) details.negativeFlagged.push({ ...item, hints: all }); } }
    }
    if ((offset + 16) % 160 === 0) console.log(`Checked ${Math.min(offset + 16, examples.length)} of ${examples.length} examples.`);
  }
} finally { deep.stop(); await linter.dispose?.(); }
const result = { source: data.source, note: data.note || 'LanguageTool-authored rule examples are not independent of LanguageTool. A flagged correct example may contain a different issue.', includesSpelling: includeSpelling, elapsedSeconds: (Date.now() - started) / 1000, ...counts, byCategory };
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
if (detailOutput) await writeFile(detailOutput, JSON.stringify(details, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
