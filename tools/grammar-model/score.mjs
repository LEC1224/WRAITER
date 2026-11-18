import { readFile, writeFile } from 'node:fs/promises';
import { readCases } from './train.mjs';

const [suite, annotation, before, after, output] = process.argv.slice(2);
if (!['holdout', 'race'].includes(suite) || !annotation || !before || !after || !output)
  throw new Error('Usage: node score.mjs holdout|race ANNOTATION BEFORE AFTER OUTPUT');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const original = suite === 'race' ? await json(annotation) : null;
const cases = original ? original.rows.map(({ id, text, judge }) => ({
  id, text, edits: judge.issues.map(({ span }) => {
    const quote = value => value.replace(/[‘’]/gu, "'");
    const surface = quote(text), target = quote(span);
    const start = surface.indexOf(target);
    if (start < 0 || surface.lastIndexOf(target) !== start) throw new Error('Ambiguous judge span for ' + id);
    return { start, end: start + span.length };
  })
})) : (await readCases(annotation)).map((item, i) => ({ id: String(i + 1), ...item }));

const apply = (text, from, to, replacement) => text.slice(0, from) + replacement + text.slice(to);
function measure(cases, app) {
  if (cases.length !== app.length) throw new Error('Unexpected number of paragraphs');
  return cases.map((item, i) => {
    if (item.id !== app[i].id || item.text !== app[i].text) throw new Error('Text mismatch in ' + item.id);
    const grammar = app[i].underlines.filter(mark => mark.kind === 'grammar');
    const hitEdits = new Set(), marks = [];
    for (const mark of grammar) {
      const matches = item.edits.map(({ start, end, replacement }, j) => {
        const exact = typeof replacement === 'string' && typeof mark.replacement === 'string' &&
          apply(item.text, start, end, replacement) === apply(item.text, mark.from, mark.to, mark.replacement);
        const overlap = end > start ? mark.from < end && mark.to > start : mark.from <= start && mark.to >= start;
        return exact || overlap ? j : -1;
      }).filter(j => j >= 0);
      for (const j of matches) hitEdits.add(j);
      marks.push({ ...mark, matched: matches.length > 0 });
    }
    return { hits: hitEdits.size, extra: marks.filter(mark => !mark.matched).length,
      missed: item.edits.length - hitEdits.size, quiet: Number(!item.edits.length && !marks.length), marks };
  });
}
const summarize = rows => rows.reduce((a, r) => {
  a.hits += r.hits; a.unsupported += r.extra; a.missed += r.missed; a.quiet += r.quiet;
  a.penalty += r.missed + 2 * r.extra;
  return a;
}, { hits: 0, unsupported: 0, missed: 0, quiet: 0, penalty: 0 });
const beforeScores = original ? original.rows.map(row => ({
  hits: row.wraiter.hit, extra: row.wraiter.extra, missed: row.wraiter.missed,
  quiet: Number(row.judge.verdict === 'pass' && !row.wraiter.extra), marks: row.wraiter.spans
})) : measure(cases, await json(before));
const afterScores = measure(cases, await json(after));
const included = cases.map((item, i) => item.category === 'spelling' ? -1 : i).filter(i => i >= 0);
const scored = included.map(i => cases[i]);
const prior = included.map(i => beforeScores[i]);
const updated = included.map(i => afterScores[i]);
const summary = {
  cases: scored.length, excludedSpellingControls: cases.length - scored.length, labeledIssues: scored.reduce((sum, item) => sum + item.edits.length, 0),
  leaveAlone: scored.filter(item => !item.edits.length).length, previousWraiter: summarize(prior), newWraiter: summarize(updated)
};
if (original) summary.googleDocs = original.summary.google;
await writeFile(output, JSON.stringify({ summary, rows: scored.map((item, i) => ({ ...item, previousWraiter: prior[i], newWraiter: updated[i] })) }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
