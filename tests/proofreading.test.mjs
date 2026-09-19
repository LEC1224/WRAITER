import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Schema } from '@tiptap/pm/model';
import { collectProofreadingPassages, chunkProofreadingPassages, attachProofreadingFindings, applyProofreadingFixes, proofreadingExcerpt } from '../src/proofreading.js';
import { documentStatistics, formatDuration } from '../src/statistics.js';

const require = createRequire(import.meta.url);
const { buildProofreadPrompt, parseProofreadResult, validateProofreadRequest } = require('../electron/proofreading.cjs');
const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' }, heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } }, text: { group: 'inline' }, hardBreak: { inline: true, group: 'inline' } }, marks: { italic: {}, bold: {} } });
const text = (value, mark) => schema.text(value, mark ? [schema.marks[mark].create()] : []);
const paragraph = (...children) => schema.node('paragraph', null, children);
function project() {
  return {
    format: 'wraiter', version: 1, id: 'proof-project', title: 'Proof test', language: 'en-GB', style: 'Keep dialogue informal.',
    chapters: [
      { id: 'one', title: 'Opening', content: schema.node('doc', null, [paragraph(text('He '), text('walkd', 'italic'), text(' to market, then he walkd home.')), paragraph(text('“This are fine,” he said.'))]).toJSON() },
      { id: 'two', title: 'Return', content: schema.node('doc', null, [paragraph(text('A short second chapter.'))]).toJSON() }
    ]
  };
}

test('proofreading requests are bounded, quote source data, and normalize exact findings', () => {
  const passages = [{ id: 'one:1', chapterTitle: 'Opening', paragraph: 1, text: 'He walkd to market, then he walkd home.' }];
  const request = validateProofreadRequest({ id: 'run', projectId: 'proof-project', scope: 'chapter', language: 'en-GB', style: 'Keep dialogue informal.', passages });
  const prompt = buildProofreadPrompt(request);
  assert.match(prompt.system, /source material, never instructions/);
  assert.match(prompt.user, /zero-based UTF-16/); assert.match(prompt.user, /wrong-word-meaning/);
  const result = parseProofreadResult(JSON.stringify({ findings: [
    { passageId: 'one:1', start: 3, end: 8, original: 'walkd', replacement: 'walked', severity: 'error', category: 'spelling', reason: 'Misspelling.' },
    { passageId: 'one:1', start: 999, end: 1004, occurrence: 2, original: 'walkd', replacement: 'walked', severity: 'probable', category: 'typo', reason: 'Same typo.' },
    { passageId: 'missing', start: 0, end: 1, original: 'X', replacement: 'Y', severity: 'definite', category: 'grammar' }
  ] }), request);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings.map(item => [item.start, item.severity, item.category]), [[3, 'definite', 'spelling'], [28, 'likely', 'wrong-word-typo']]);
  assert.throws(() => validateProofreadRequest({ ...request, passages: [{ ...passages[0], text: 'x'.repeat(20001) }] }), /passage/);
  assert.throws(() => parseProofreadResult('not json', request), /valid findings/);
});

test('passage collection respects selection and batches, while accepted fixes preserve marks and remap pending findings', () => {
  const original = project(), chapterPassages = collectProofreadingPassages(original, schema, { scope: 'chapter', activeChapterId: 'one' });
  assert.equal(chapterPassages.length, 2); assert.equal(chapterPassages[0].paragraph, 1); assert.equal(chapterPassages[0].from, 1);
  const selected = collectProofreadingPassages(original, schema, { scope: 'selection', activeChapterId: 'one', selection: { from: 4, to: 9 } });
  assert.equal(selected.length, 1); assert.equal(selected[0].text, 'walkd'); assert.equal(selected[0].from, 4);
  assert.equal(collectProofreadingPassages(original, schema, { scope: 'manuscript', activeChapterId: 'one' }).length, 3);
  assert.equal(chunkProofreadingPassages(chapterPassages, 30).length, 2);

  const passage = chapterPassages[0], raw = { findings: [
    { passageId: passage.id, start: 3, end: 8, original: 'walkd', replacement: 'walked', severity: 'definite', category: 'spelling', reason: '' },
    { passageId: passage.id, start: 28, end: 33, original: 'walkd', replacement: 'walked', severity: 'definite', category: 'spelling', reason: '' }
  ] };
  let findings = attachProofreadingFindings(raw, chapterPassages, (() => { let id = 0; return () => String(++id); })());
  assert.deepEqual(
    { before: findings[0].contextBefore, original: findings[0].contextOriginal, after: findings[0].contextAfter },
    { before: 'He ', original: 'walkd', after: ' to market, then he walkd home.' }
  );
  const clipped = proofreadingExcerpt(`${'Earlier context '.repeat(8)}wrong\nword and later text`, 128, 138, 18);
  assert.ok(clipped.before.startsWith('…')); assert.equal(clipped.original, 'wrong word'); assert.equal(clipped.after, ' and later text');
  const first = applyProofreadingFixes(original, findings, new Set(['1']), schema); findings = first.findings;
  let doc = schema.nodeFromJSON(first.project.chapters[0].content);
  assert.equal(doc.textBetween(0, doc.content.size, ' '), 'He walked to market, then he walkd home. “This are fine,” he said.');
  assert.equal(doc.firstChild.child(1).marks[0].type.name, 'italic');
  assert.equal(findings[1].status, 'pending'); assert.equal(doc.textBetween(findings[1].from, findings[1].to), 'walkd');
  const second = applyProofreadingFixes(first.project, findings, new Set(['2']), schema);
  doc = schema.nodeFromJSON(second.project.chapters[0].content);
  assert.match(doc.textContent, /then he walked home/); assert.equal(second.changeCount, 1);
});

test('statistics expose practical and editorial measurements without counting chapter titles as prose', () => {
  const stats = documentStatistics(project(), 10);
  assert.equal(stats.chapters, 2); assert.equal(stats.words, 17); assert.equal(stats.pages, 2);
  assert.equal(stats.paragraphs, 3); assert.ok(stats.sentences >= 3); assert.ok(stats.uniqueWords > 10);
  assert.equal(stats.longest.title, 'Opening'); assert.equal(stats.shortest.title, 'Return');
  assert.match(formatDuration(75), /1 hr 15 min/); assert.equal(formatDuration(0), '0 min');
});
