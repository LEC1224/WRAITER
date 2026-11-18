// Synthetic, local-only measurements. Run: node tools/benchmark-performance.mjs
// Timings depend on the machine and are not pass/fail thresholds.
import { performance } from 'node:perf_hooks';
import { EditorState } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { findTextMatches, findManuscriptMatches, replaceManuscriptMatches } from '../src/search.js';
import { documentSnapshot } from '../src/document-snapshot.js';
import { documentWordCount, updateWordCount } from '../src/word-count.js';
import { createHistory, recordProjectChange, historyStatus, timelineEntries } from '../src/history.js';
import { outsideCheckedPassages } from '../src/ai-grammar.js';

const summarize = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3), p95Ms: +sorted[Math.floor(sorted.length * .95)].toFixed(3) };
};
const paragraph = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const content = { type: 'doc', content: Array.from({ length: 6000 }, (_, index) => paragraph(`Paragraph ${index + 1}. The needle rests beside another needle near the river.`)) };
const project = { id: 'benchmark', chapters: [{ id: 'one', title: 'One', content }] };
const doc = schema.nodeFromJSON(content), report = {};

let samples = [];
for (const query of ['river', 'needle', 'river', 'needle', 'river', 'needle']) {
  const start = performance.now(), result = findManuscriptMatches(project, query, { chapterId: 'one', activeDoc: doc });
  if (result.length !== (query === 'river' ? 6000 : 12000)) throw new Error('Search returned an unexpected result count');
  if (query === 'needle') samples.push(performance.now() - start);
}
report.search12000Matches = summarize(samples);

const formattedDoc = schema.nodeFromJSON({ type: 'doc', content: Array.from({ length: 6000 }, (_, index) => ({ type: 'paragraph', content: [
  { type: 'text', text: `Paragraph ${index + 1}. ` }, { type: 'text', text: 'needle and needle', marks: [{ type: 'bold' }] }
] })) });
samples = [];
for (let i = 0; i < 6; i++) {
  const start = performance.now(), result = findTextMatches(formattedDoc, 'needle', Infinity, { format: 'bold' });
  if (result.length !== 12000) throw new Error('Formatted search returned an unexpected result count');
  samples.push(performance.now() - start);
}
report.formattedSearch12000Matches = summarize(samples);

let state = EditorState.create({ schema, doc });
findManuscriptMatches(project, '(needle)', { chapterId: 'one', activeDoc: state.doc, regex: true });
samples = [];
for (let i = 0; i < 50; i++) {
  state = state.apply(state.tr.insertText('a', state.doc.content.size - 1));
  const start = performance.now(), result = findManuscriptMatches(project, '(needle)', { chapterId: 'one', activeDoc: state.doc, regex: true });
  if (result.length !== 12000) throw new Error('Regex search returned an unexpected result count');
  samples.push(performance.now() - start);
}
report.regexSearchAfterEdit = summarize(samples);

const matches = findManuscriptMatches(project, 'needle', { chapterId: 'one', activeDoc: doc });
let start = performance.now();
const replaced = replaceManuscriptMatches(project, matches, 'target', { schema });
report.replace12000MatchesMs = +(performance.now() - start).toFixed(3);
if (replaced.count !== 12000 || !replaced.project.chapters[0].content.content[0].content[0].text.includes('target')) throw new Error('Replacement did not apply');

state = EditorState.create({ schema, doc }); documentSnapshot(doc); samples = [];
for (let i = 0; i < 100; i++) {
  state = state.apply(state.tr.insertText('a', state.doc.content.size - 1));
  start = performance.now(); documentSnapshot(state.doc); samples.push(performance.now() - start);
}
report.snapshotAfterEdit = summarize(samples);

state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: [paragraph('river '.repeat(60000))] }) });
let words = documentWordCount(state.doc); samples = [];
for (let i = 0; i < 100; i++) {
  const transaction = state.tr.insertText('a', state.doc.content.size - 1);
  start = performance.now(); words = updateWordCount(words, transaction); samples.push(performance.now() - start); state = state.apply(transaction);
}
if (words !== documentWordCount(state.doc)) throw new Error('Word count differs from a full recount');
report.wordCountIn60000WordParagraph = summarize(samples);

let historyProject = { id: 'history-benchmark', title: 'Synthetic', chapters: [{ id: 'one', title: 'One', content: { type: 'doc', content: [paragraph('')] } }] };
let journal = createHistory(historyProject);
const entries = Array.from({ length: 10000 }, (_, index) => ({ id: `old-${index}`, kind: 'steps', label: 'Type text', chapterId: 'one', groupId: `group-${Math.floor(index / 5)}`, forward: [{ stepType: 'replace', slice: { content: [{ type: 'text', text: 'a' }] } }], inverse: [{ stepType: 'replace' }], timestamp: new Date(0).toISOString() }));
journal = { ...journal, entries, activeIds: entries.map(entry => entry.id), cursor: entries.length, sequence: entries.length + 1 };
historyStatus(journal); timelineEntries(journal); samples = [];
for (let i = 0; i < 75; i++) {
  const next = { ...historyProject, title: `Synthetic ${i}` };
  start = performance.now(); journal = recordProjectChange(journal, historyProject, next, { label: 'Rename' }); historyStatus(journal); timelineEntries(journal); samples.push(performance.now() - start);
  historyProject = next;
}
report.historyWith10000Events = summarize(samples);

const passages = Array.from({ length: 6000 }, (_, index) => ({ from: index * 80, to: index * 80 + 60 }));
const hints = passages.map(passage => ({ from: passage.from + 8, to: passage.from + 16 }));
samples = [];
for (let i = 0; i < 30; i++) { start = performance.now(); if (outsideCheckedPassages(hints, passages).length) throw new Error('Unexpected grammar hints'); samples.push(performance.now() - start); }
report.grammarFilter6000Hints = summarize(samples);

console.log(JSON.stringify({ note: 'Synthetic local measurements; compare runs on the same machine.', report }, null, 2));
