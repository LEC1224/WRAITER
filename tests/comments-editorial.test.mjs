import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createEditorialTools } from '../electron/editorial-tools.mjs';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { collectCommentRanges } from '../electron/comments.mjs';
import { applyAgentResult } from '../src/agent-edits.js';
import { normalizeHistoryProject } from '../src/history.js';

const { projectFingerprint, runWritingAgent } = createRequire(import.meta.url)('../electron/writing-agent.cjs');
const privateIds = ['private-comment-original-42', 'private-overlap-original-73'];
const privateBodies = ['PRIVATE_REVISION_NOTE_42', 'PRIVATE_OTHER_NOTE_73'];
const p = content => ({ type: 'paragraph', content });
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const anchor = index => ({ type: 'commentAnchor', attrs: { id: privateIds[index] } });
const createdAt = '2026-10-01T12:00:00.000Z';
function fixture() {
  return structuredClone(normalizeHistoryProject({ format: 'wraiter', version: 1, id: 'editorial-comments', title: 'Synthetic comment test', snapshots: [],
    comments: privateIds.map((id, index) => ({ id, chapterId: 'one', text: privateBodies[index], quote: 'quiet passage', resolved: false, createdAt, updatedAt: createdAt })),
    chapters: [
      { id: 'one', title: 'Opening', content: { type: 'doc', content: [
        p([t('A '), t('quiet', [{ type: 'bold' }, anchor(0)]), t(' passage', [anchor(0), anchor(1)]), t('. Another phrase.')]),
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p([t('Nested private passage', [{ type: 'italic' }, anchor(1)])])] }] }] },
        { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'Synthetic image' } }
      ] } },
      { id: 'two', title: 'Ending', content: { type: 'doc', content: [p([t('Untouched ending.')])] } }
    ] }, schema));
}
function resultFor(source, tools) { return { projectId: source.id, baseFingerprint: projectFingerprint(source), ...tools.changes() }; }
function assertPrivateAbsent(value) {
  const serialized = JSON.stringify(value);
  assert.ok(!serialized.includes('commentAnchor'));
  for (const secret of [...privateIds, ...privateBodies]) assert.ok(!serialized.includes(secret), `Provider-facing output exposed ${secret}`);
}

test('provider passage and recursive structure reads omit private anchor IDs while retaining useful formatting', () => {
  const source = fixture(), original = JSON.stringify(source), tools = createEditorialTools(source);
  const passage = tools.execute('read_document', { scope: 'all' });
  const structure = tools.execute('read_structure', { chapterId: 'one', limit: 100 });
  const search = tools.execute('search_document', { find: 'passage', scope: 'all' });
  assertPrivateAbsent(passage); assertPrivateAbsent(structure); assertPrivateAbsent(search);
  assert.ok(passage.blocks.some(block => block.runs.some(run => run.text === 'quiet' && run.marks.some(mark => mark.type === 'bold'))));
  assert.ok(JSON.stringify(structure).includes('Nested private passage'));
  assert.ok(JSON.stringify(structure).includes('italic'));
  assert.equal(JSON.stringify(source), original);
  assert.equal(tools.changes().documentChanges.length, 0);
  // Returned public data is independent of the local anchor-bearing manuscript.
  passage.blocks[0].attrs.textAlign = 'right';
  passage.blocks[0].runs.find(run => run.marks.length).marks[0].type = 'strike';
  structure.blocks[0].node.content[1].marks[0].type = 'underline';
  assert.equal(tools.changes().documentChanges.length, 0);
  assert.equal(tools.execute('read_document', { scope: 'one' }).blocks[0].runs.find(run => run.text === 'quiet').marks[0].type, 'bold');
});

test('forged comment formatting, explicit anchor removal and nested rich insertion fail atomically', () => {
  const source = fixture(), tools = createEditorialTools(source);
  tools.execute('format_text', { scope: 'one', find: 'Another', expectedCount: 1, marks: [{ type: 'italic' }] });
  const revision = tools.revision, before = JSON.stringify(tools.changes());
  const forged = { type: 'commentAnchor', attrs: { id: 'forged-private-comment' } };
  const image = tools.execute('read_structure', { chapterId: 'one' }).blocks.find(block => block.node?.type === 'image').node;
  const attempts = [
    ['format_text', { scope: 'one', marks: [{ type: 'bold' }, forged] }],
    ['format_text', { scope: 'one', remove: ['bold', 'commentAnchor'] }],
    ['format_text', { scope: 'one', marks: [anchor(0)] }],
    ['edit_blocks', { chapterId: 'one', revision, from: 0, to: 1, blocks: [p([t('Safe first block')]), p([t('Forged passage', [forged])])] }],
    ['edit_blocks', { chapterId: 'one', revision, from: 0, to: 1, blocks: [{ type: 'blockquote', content: [p([t('Nested forged passage', [anchor(0)])])] }] }],
    ['edit_blocks', { chapterId: 'one', revision, from: 0, to: 1, blocks: [{ ...image, marks: [forged] }] }],
    ['create_chapter', { revision, title: 'Forged chapter', blocks: [p([t('Forged chapter passage', [forged])])] }]
  ];
  for (const [name, args] of attempts) {
    assert.throws(() => tools.execute(name, args), /Private comments/);
    assert.equal(tools.revision, revision);
    assert.equal(JSON.stringify(tools.changes()), before, `${name} changed local buffers after a rejected private mark`);
  }
});

test('ordinary editorial formatting and text edits preserve anchors and complete local change buffers', async () => {
  const source = fixture(), tools = createEditorialTools(source), originalRanges = collectCommentRanges(source.chapters[0].content, schema);
  tools.execute('format_text', { scope: 'one', find: 'quiet', expectedCount: 1, marks: [{ type: 'italic' }], remove: ['bold'] });
  const block = tools.execute('read_document', { scope: 'one' }).blocks[0];
  tools.execute('rewrite_passage', { blockId: block.blockId, before: block.text, after: block.text.replace('Another phrase', 'A revised phrase') });
  const changes = tools.changes();
  assert.ok(JSON.stringify(changes.documentChanges).includes(privateIds[0]), 'Local before/after buffers must retain anchors');
  assert.ok(JSON.stringify(changes.documentChanges).includes(privateIds[1]));
  const applied = await applyAgentResult(source, resultFor(source, tools), schema);
  assert.deepEqual(applied.project.comments, source.comments);
  const doc = schema.nodeFromJSON(applied.project.chapters[0].content);
  const originalDoc = schema.nodeFromJSON(source.chapters[0].content), nextRanges = collectCommentRanges(doc, schema);
  const passages = (tree, ranges) => [...ranges].map(([id, positions]) => [id, positions.map(range => tree.textBetween(range.from, range.to))]);
  assert.deepEqual(passages(doc, nextRanges), passages(originalDoc, originalRanges), 'Notes follow the same passages when preceding text changes length');
  assert.match(doc.textContent, /A revised phrase/);
  const quiet = doc.firstChild.content.content.find(node => node.text === 'quiet');
  assert.ok(quiet.marks.some(mark => mark.type.name === 'commentAnchor' && mark.attrs.id === privateIds[0]));
  assert.ok(quiet.marks.some(mark => mark.type.name === 'italic'));
  assert.ok(!quiet.marks.some(mark => mark.type.name === 'bold'));
  assertPrivateAbsent(tools.execute('read_document', {}));
  assertPrivateAbsent(tools.execute('read_structure', { chapterId: 'one' }));
});

test('provider tool exchange never exposes comment bodies or anchor IDs in agent prompts', async () => {
  const source = fixture(); let round = 0;
  const result = await runWritingAgent({ project: source, activeChapterId: 'one', instruction: 'Read the text and formatting.', settings: {} }, async (_settings, _key, prompt) => {
    assertPrivateAbsent(prompt);
    if (++round === 1) return JSON.stringify({ done: false, message: 'Reading.', tools: [
      { name: 'read_document', arguments: { scope: 'all' } },
      { name: 'read_structure', arguments: { chapterId: 'one' } }
    ] });
    assert.match(prompt.user, /Nested private passage/);
    assert.match(prompt.user, /bold/);
    return JSON.stringify({ done: true, message: 'Read the passages.', tools: [] });
  });
  assert.equal(round, 2);
  assert.equal(result.documentChanges.length, 0);
});
