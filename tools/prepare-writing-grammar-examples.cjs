// Turn paired, locally authored diagnostic sentences into exact source ranges.
// This development set is not an independent accuracy or product comparison.
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const pairs = JSON.parse(await fs.readFile(path.join(root, 'tests', 'fixtures', 'offline-grammar-writing-pairs.json'), 'utf8'));
  const data = { source: 'WRAITER-authored writing diagnostics', note: 'A small, hand-authored development set; not independent of WRAITER development or representative of all fiction.', positive: [], negative: [] };
  for (const { category, wrong, right } of pairs) {
    if (typeof wrong !== 'string' || typeof right !== 'string' || wrong === right) throw new Error('Invalid writing diagnostic pair.');
    let from = 0, to = wrong.length, end = right.length;
    while (from < to && from < end && wrong[from] === right[from]) from++;
    while (to > from && end > from && wrong[to - 1] === right[end - 1]) { to--; end--; }
    let correction = right.slice(from, end);
    if (from === to) {
      if (from) { from--; correction = wrong[from] + correction; }
      else if (to < wrong.length) { correction += wrong[to]; to++; }
      else throw new Error('Cannot anchor an empty diagnostic.');
    }
    if (wrong.slice(0, from) + correction + wrong.slice(to) !== right) throw new Error('Invalid diagnostic range.');
    data.positive.push({ category, text: wrong, from, to, correction });
    data.negative.push({ category, text: right });
  }
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  await fs.writeFile(path.join(root, 'test-output', 'writing-grammar-examples.json'), JSON.stringify(data));
  console.log(`Prepared ${pairs.length} paired writing diagnostics.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
