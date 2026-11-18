import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { learnedGrammarHints } from '../../src/learned-grammar.js';

const source = new URL('./eval-terra.jsonl', import.meta.url);
const texts = (await readFile(source, 'utf8')).trim().split(/\r?\n/u).map(line => JSON.parse(line).text);
const longer = Array.from({ length: 12 }, (_, index) => texts.slice(index, index + 48).join(' ').slice(0, 3500));
const time = (samples, repeats) => {
  for (let i = 0; i < 8; i++) for (const text of samples) learnedGrammarHints(text, 'en-US');
  const ms = [];
  for (let i = 0; i < repeats; i++) for (const text of samples) {
    const start = performance.now();
    learnedGrammarHints(text, 'en-US');
    ms.push(performance.now() - start);
  }
  ms.sort((a, b) => a - b);
  return { samples: ms.length, p50: +ms[Math.floor(ms.length * .5)].toFixed(3), p95: +ms[Math.floor(ms.length * .95)].toFixed(3) };
};
const modelBytes = (await readFile(new URL('../../src/grammar-model-weights.js', import.meta.url))).length;
console.log(JSON.stringify({ modelBytes, units: 'milliseconds (added model only, Node CPU)', passage: time(texts, 15), longBlock: time(longer, 100) }, null, 2));
