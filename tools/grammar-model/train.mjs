import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { generateGrammarCandidates, scoreGrammarCandidate } from '../../src/grammar-model.js';

export async function readCases(file) {
  const lines = (await readFile(file, 'utf8')).trim().split(/\r?\n/u);
  const seen = new Set();
  return lines.map((line, index) => {
    const row = JSON.parse(line);
    const invalid = typeof row.text !== 'string' || !row.text.trim() || seen.has(row.text) ||
      !Array.isArray(row.edits) || row.edits.some(({ start, end, replacement }) =>
        !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start ||
        end > row.text.length || typeof replacement !== 'string' || row.text.slice(start, end) === replacement);
    if (invalid) throw new Error('Invalid or duplicate example at line ' + (index + 1) + ' of ' + file);
    seen.add(row.text);
    return row;
  });
}

const apply = (text, from, to, replacement) => text.slice(0, from) + replacement + text.slice(to);
export function trainingRows(cases) {
  return cases.flatMap(({ text, edits, group }) => {
    const targets = new Set(edits.map(edit => apply(text, edit.start, edit.end, edit.replacement)));
    return generateGrammarCandidates(text).map(candidate => ({
      candidate, group: group ?? text, text, label: Number(targets.has(apply(text, candidate.from, candidate.to, candidate.replacement)))
    }));
  });
}

const hash = text => {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
};

function fit(rows) {
  const counts = new Map();
  for (const { candidate } of rows) for (const feature of candidate.features)
    counts.set(feature, (counts.get(feature) ?? 0) + 1);
  const features = [...counts].filter(([, count]) => count >= 3).map(([feature]) => feature).sort();
  const ids = new Map(features.map((feature, index) => [feature, index]));
  const train = rows.map(({ candidate, label }) => ({
    indices: candidate.features.map(feature => ids.get(feature)).filter(Number.isInteger), label
  }));
  const weights = new Float64Array(features.length), gradient = new Float64Array(features.length);
  let bias = 0;
  for (let epoch = 0; epoch < 260; epoch++) {
    gradient.fill(0);
    let intercept = 0;
    for (const { indices, label } of train) {
      let logit = bias;
      for (const i of indices) logit += weights[i];
      const error = (1 / (1 + Math.exp(-logit)) - label) * (label ? 1 : 1.6);
      intercept += error;
      for (const i of indices) gradient[i] += error;
    }
    const step = 1 / Math.sqrt(1 + epoch / 50);
    bias -= step * intercept / train.length;
    for (let i = 0; i < weights.length; i++)
      weights[i] -= step * (gradient[i] / train.length + 0.003 * weights[i]);
  }
  const round = value => Math.round(value * 10000) / 10000;
  return { bias: round(bias), weights: Object.fromEntries(features.flatMap((feature, i) => Math.abs(weights[i]) >= .006 ? [[feature, round(weights[i])]] : [])) };
}

function countsAt(scores, threshold) {
  const result = { hits: 0, unsupported: 0, missed: 0 };
  for (const { label, score } of scores) {
    if (score >= threshold) result[label ? 'hits' : 'unsupported']++;
    else if (label) result.missed++;
  }
  return { ...result, penalty: result.missed + 2 * result.unsupported };
}

function isolateGroups(cases) {
  const parents = new Map(), owners = new Map(), unique = new Map();
  const find = key => {
    if (!parents.has(key)) parents.set(key, key);
    if (parents.get(key) !== key) parents.set(key, find(parents.get(key)));
    return parents.get(key);
  };
  const keyFor = text => text.normalize('NFKC').replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').toLowerCase().replace(/\s+/gu, ' ').trim();
  for (const row of cases) {
    const group = row.group ?? row.text;
    for (const variant of [row.text, ...row.edits.map(e => apply(row.text, e.start, e.end, e.replacement))]) {
      const key = keyFor(variant);
      if (owners.has(key)) parents.set(find(group), find(owners.get(key)));
      else owners.set(key, group);
    }
    const key = keyFor(row.text);
    if (unique.has(key)) {
      const earlier = unique.get(key);
      if (Boolean(earlier.edits.length) !== Boolean(row.edits.length))
        throw new Error('Conflicting labels on duplicate training passage.');
    } else unique.set(key, row);
  }
  return [...unique.values()].map(row => ({ ...row, group: find(row.group ?? row.text) }));
}

export function train(cases) {
  cases = isolateGroups(cases);
  const rows = trainingRows(cases);
  const positives = rows.filter(row => row.label).length;
  if (positives < 15 || rows.length - positives < 10 || new Set(rows.map(row => row.group)).size < 10)
    throw new Error('Training needs more independent groups with usable positive and negative candidates.');
  const categories = [...new Set(rows.filter(row => row.label).map(row => row.candidate.category))].sort().filter(category =>
    new Set(rows.filter(row => row.label && row.candidate.category === category).map(row => row.group)).size >= 4);
  const folds = 5;
  const scores = [];
  for (let fold = 0; fold < folds; fold++) {
    const model = fit(rows.filter(row => hash(row.group) % folds !== fold));
    for (const { candidate, label, group } of rows)
      if (hash(group) % folds === fold) scores.push({ label, category: candidate.category, score: categories.includes(candidate.category) ? scoreGrammarCandidate(candidate, model) : -1 });
  }
  // Apply the race's 2:1 cost on grouped validation data; prefer the quietest
  // setting on a tie. The held-out fiction benchmark never enters this step.
  const choices = Array.from({ length: 71 }, (_, i) => (30 + i) / 100)
    .map(threshold => ({ threshold, ...countsAt(scores, threshold) }))
    .sort((a, b) => a.penalty - b.penalty || a.unsupported - b.unsupported || b.threshold - a.threshold);
  const best = choices[0];
  const thresholds = {};
  const byCategory = Object.fromEntries(categories.map(category => {
    const family = scores.filter(row => row.category === category);
    const choice = choices.filter(({ threshold }) => threshold >= best.threshold)
      .map(({ threshold }) => ({ threshold, ...countsAt(family, threshold) }))
      .sort((a, b) => a.penalty - b.penalty || a.unsupported - b.unsupported || a.threshold - b.threshold)[0];
    thresholds[category] = choice.threshold;
    return [category, { accepted: choice, unfiltered: countsAt(family, 0) }];
  }));
  return {
    model: { version: 1, thresholds, ...fit(rows) },
    report: {
      examples: cases.length, groups: new Set(rows.map(row => row.group)).size, candidates: rows.length, positiveCandidates: positives,
      validation: best, unfiltered: countsAt(scores.map(row => ({ ...row, score: 1 })), 0), byCategory
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const defaultSources = ['training-terra.jsonl', 'training-terra-extra.jsonl', 'training-lookalikes.jsonl', 'training-terra-syntax.jsonl', 'training-coverage.jsonl', 'training-real-fiction-negatives.jsonl'].map(file => new URL(file, import.meta.url));
  const output = new URL('../../src/grammar-model-weights.js', import.meta.url);
  const cases = (await Promise.all((process.argv.length > 2 ? process.argv.slice(2) : defaultSources).map(readCases))).flat();
  const { model, report } = train(cases);
  await writeFile(output, '// Generated by tools/grammar-model/train.mjs. Do not edit by hand.\nexport default ' + JSON.stringify(model) + ';\n');
  console.log(JSON.stringify({ ...report, weights: Object.keys(model.weights).length }, null, 2));
}


