import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createEditorialTools } from '../electron/editorial-tools.mjs';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { applyAgentResult, rebaseAgentResult } from '../src/agent-edits.js';
import { revertAssistantEntry, assistantEditState, assistantChangeSummary } from '../src/editorial-report.js';
import { createHistory, recordProjectChange, applyHistory, normalizeHistoryProject } from '../src/history.js';
const { projectFingerprint, runWritingAgent } = createRequire(import.meta.url)('../electron/writing-agent.cjs');
const p = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const fixture = () => structuredClone(normalizeHistoryProject({ format: 'wraiter', version: 1, id: 'editorial', title: 'Synthetic editorial manuscript', notes: 'PRIVATE', style: 'Preserve the voice.', references: [], snapshots: [], chapters: [{ id: 'one', title: 'Opening', content: { type: 'doc', content: [p('Before [i]quiet [b]words[/b][/i] after.'), p('Second paragraph.'), p('Third paragraph.')] } }, { id: 'two', title: 'Ending', content: { type: 'doc', content: [p('Unrelated text.')] } }] }, schema));
const resultFor = (source, tools) => ({ projectId: source.id, baseFingerprint: projectFingerprint(source), ...tools.changes() });
const firstBlock = (tools, scope = 'one') => tools.execute('read_document', { scope }).blocks[0];
const textOf = doc => schema.nodeFromJSON(doc).textBetween(0, schema.nodeFromJSON(doc).content.size, '\n', '\n');

test('nested BBCode becomes actual rich formatting with exactly preserved prose, and can be undone after reload', async () => {
  const source = fixture(), tools = createEditorialTools(source);
  assert.equal(tools.execute('convert_bbcode', { scope: 'one' }).count, 2);
  const read = firstBlock(tools);
  assert.equal(read.text, 'Before quiet words after.');
  assert.ok(read.runs.some(run => run.text === 'quiet ' && run.marks.some(mark => mark.type === 'italic')));
  assert.ok(read.runs.some(run => run.text === 'words' && ['bold', 'italic'].every(type => run.marks.some(mark => mark.type === type))));
  const applied = await applyAgentResult(source, resultFor(source, tools), schema);
  const journal = recordProjectChange(createHistory(source), source, applied.project, { label: 'AI: convert BBCode' });
  const restoredJournal = createHistory(applied.project, JSON.parse(JSON.stringify(journal)));
  assert.deepEqual(applyHistory(applied.project, restoredJournal, 'undo', schema).project.chapters, source.chapters);
  assert.equal(assistantChangeSummary(journal.entries[0], applied.project)[0], 'Revised text in Opening');
});

test('BBCode conversion is atomic on malformed input and supports pairs across paragraphs', () => {
  const source = fixture(); source.chapters[0].content.content = [p('[i]First'), p('Second[/i]')];
  const tools = createEditorialTools(source);
  assert.equal(tools.execute('convert_bbcode', {}).count, 1);
  assert.ok(tools.execute('read_document', {}).blocks.slice(0, 2).every(block => block.runs[0].marks.some(mark => mark.type === 'italic')));
  const malformed = fixture(); malformed.chapters[0].content.content.push(p('[b]Unclosed'));
  const failed = createEditorialTools(malformed);
  assert.throws(() => failed.execute('convert_bbcode', {}), /unbalanced/);
  assert.equal(failed.changes().documentChanges.length, 0);
  assert.equal(failed.revision, 0);
});

test('inline formatting can target repeated text and changing colour preserves font and size', async () => {
  const source = fixture(); source.chapters[0].content.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Red word and word.', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '16pt' } }] }] }];
  const tools = createEditorialTools(source);
  tools.execute('format_text', { scope: 'one', find: 'word', expectedCount: 2, marks: [{ type: 'italic' }, { type: 'textStyle', attrs: { color: '#ff0000' } }] });
  const read = firstBlock(tools);
  const words = read.runs.filter(run => run.text === 'word');
  assert.equal(words.length, 2);
  for (const run of words) { assert.ok(run.marks.some(mark => mark.type === 'italic')); const style = run.marks.find(mark => mark.type === 'textStyle').attrs; assert.equal(style.color, '#ff0000'); assert.equal(style.fontSize, '16pt'); assert.equal(style.fontFamily, 'Georgia'); }
  const applied = await applyAgentResult(source, resultFor(source, tools), schema);
  assert.equal(textOf(applied.project.chapters[0].content), 'Red word and word.');
  assert.throws(() => tools.execute('format_text', { marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }), /Links must/);
});

test('200 distinct paragraph revisions fit in one bulk action and any bad source rolls back the entire action', () => {
  const source = fixture(); source.chapters[0].content.content = Array.from({ length: 150 }, (_, i) => p(`Sentence ${i}.`));
  const tools = createEditorialTools(source), blocks = tools.execute('read_document', { scope: 'one', limitChars: 30000 }).blocks;
  const passages = blocks.map(block => ({ blockId: block.blockId, before: block.text, after: block.text.replace('Sentence', 'Passage') }));
  assert.throws(() => tools.execute('rewrite_passages', { passages: [...passages.slice(0, 100), { ...passages[100], before: 'Wrong source' }] }), /exactly match/);
  assert.equal(tools.changes().documentChanges.length, 0);
  assert.equal(tools.execute('rewrite_passages', { passages }).count, 150);
  assert.equal(firstBlock(tools).text, 'Passage 0.');
  assert.throws(() => tools.execute('rewrite_passage', passages[0]), /stale/);
});

test('real paragraph splits, block moves and rich replacements preserve untouched formatting', async () => {
  const source = fixture(); source.chapters[0].content.content[0] = schema.node('paragraph', { pageBreakBefore: true }, [schema.text('Bold words.', [schema.marks.bold.create()])]).toJSON();
  const tools = createEditorialTools(source);
  tools.execute('split_paragraph', { blockId: firstBlock(tools).blockId, offset: 5 });
  const structure = tools.execute('read_structure', { chapterId: 'one' });
  assert.equal(structure.totalBlocks, 4);
  assert.equal(structure.blocks[1].node.attrs.pageBreakBefore, null);
  assert.equal(structure.blocks[1].node.content[0].marks[0].type, 'bold');
  tools.execute('move_blocks', { chapterId: 'one', targetChapterId: 'two', revision: tools.revision, from: 1, to: 2, index: 0 });
  tools.execute('edit_blocks', { chapterId: 'one', revision: tools.revision, from: 1, to: 2, blocks: ['New first paragraph.', { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'New heading' }] }] });
  const applied = await applyAgentResult(source, resultFor(source, tools), schema);
  assert.match(textOf(applied.project.chapters[0].content), /New first paragraph.\nNew heading\nThird/);
  assert.equal(applied.project.chapters[1].content.content[0].content[0].marks[0].type, 'bold');
  assert.equal(textOf(applied.project.chapters[1].content), 'words.\nUnrelated text.');
});

test('chapter restructuring and document metadata are reversible as one batch', async () => {
  const source = fixture(), tools = createEditorialTools(source);
  const split = tools.execute('split_chapter', { chapterId: 'one', revision: 0, index: 1, title: 'Middle' });
  tools.execute('reorder_chapters', { revision: tools.revision, chapterIds: ['one', 'two', split.chapterId] });
  tools.execute('merge_chapters', { revision: tools.revision, chapterIds: [split.chapterId, 'two'], title: 'Merged ending' });
  const created = tools.execute('create_chapter', { revision: tools.revision, title: 'Extra', blocks: ['Extra text.'] });
  tools.execute('delete_chapter', { revision: tools.revision, chapterId: created.chapterId, before: 'Extra' });
  tools.execute('set_document', { fields: { title: 'Edited title' } });
  const applied = await applyAgentResult(source, resultFor(source, tools), schema);
  assert.equal(applied.project.title, 'Edited title');
  assert.equal(applied.project.chapters[1].title, 'Merged ending');
  assert.equal(textOf(applied.project.chapters[1].content), 'Second paragraph.\nThird paragraph.\nUnrelated text.');
  let journal = recordProjectChange(createHistory(source), source, applied.project, { label: 'AI: restructure' });
  const reverted = revertAssistantEntry(applied.project, journal.entries[0], schema);
  assert.deepEqual(reverted.project.chapters, source.chapters);
  assert.equal(reverted.project.title, source.title);
  const originalId = journal.entries[0].id;
  journal = recordProjectChange(journal, applied.project, reverted.project, { label: 'Revert', revertsEntryId: originalId });
  assert.equal(assistantEditState(journal, originalId), 'reverted');
  const undo = applyHistory(reverted.project, journal, 'undo', schema);
  assert.equal(assistantEditState(undo.journal, originalId), 'applied');
  assert.deepEqual(undo.project.chapters, applied.project.chapters);
});

test('rebase and selective revert preserve unrelated later work and reject overlapping work', async () => {
  const source = fixture(), tools = createEditorialTools(source);
  tools.execute('convert_bbcode', { scope: 'one' });
  const result = resultFor(source, tools), applied = await applyAgentResult(source, result, schema);
  const concurrent = structuredClone(source); concurrent.chapters[1].content.content = [p('New writing elsewhere.')];
  assert.equal(textOf(rebaseAgentResult(source, concurrent, applied, result).project.chapters[1].content), 'New writing elsewhere.');
  const journal = recordProjectChange(createHistory(source), source, applied.project, { label: 'AI: format' });
  const later = structuredClone(applied.project); later.chapters[1].content.content = [p('Later writing.')];
  const reverted = revertAssistantEntry(later, journal.entries[0], schema);
  assert.deepEqual(reverted.project.chapters[0], source.chapters[0]);
  assert.equal(textOf(reverted.project.chapters[1].content), 'Later writing.');
  later.chapters[0].content.content.push(p('Conflicting work.'));
  assert.throws(() => revertAssistantEntry(later, journal.entries[0], schema), /Later changes overlap/);
  const changedTarget = structuredClone(source); changedTarget.chapters[0].content.content.push(p('Concurrent work.'));
  assert.throws(() => rebaseAgentResult(source, changedTarget, applied, result), /document changed/);
});

test('selected edits cannot format outside the selection or mutate chapters and stale/invalid structure rolls back', () => {
  const source = fixture(), tools = createEditorialTools(source, { selection: { chapterId: 'one', from: 1, to: 7 } });
  tools.execute('format_text', { scope: 'all', marks: [{ type: 'bold' }] });
  const formatted = tools.execute('read_document', { scope: 'one' }).blocks[0];
  assert.equal(formatted.runs.find(run => run.marks.some(mark => mark.type === 'bold')).text, 'Before');
  assert.throws(() => tools.execute('edit_blocks', { chapterId: 'one', revision: tools.revision, from: 0, to: 1, blocks: [] }), /outside the selected/);
  assert.throws(() => tools.execute('set_document', { fields: { title: 'Escape' } }), /outside the selected/);
  const full = createEditorialTools(source);
  assert.throws(() => full.execute('edit_blocks', { chapterId: 'one', revision: 99, from: 0, to: 1, blocks: [] }), /revision/);
  assert.throws(() => full.execute('edit_blocks', { chapterId: 'one', revision: 0, from: 0, to: 1, blocks: [{ type: 'table', content: [] }] }), /empty|Invalid/);
  assert.equal(full.changes().documentChanges.length, 0);
});

test('agent exposes fresh structure, full reference paging, earlier chat and truthful operations without private notes', async () => {
  const source = fixture(), references = [{ name: 'Long canon', text: 'a'.repeat(30000) + 'END_CANON' }], conversation = [{ role: 'user', text: 'Earlier editorial preference' }];
  let round = 0;
  const result = await runWritingAgent({ project: source, instruction: 'Convert the BBCode.', references, conversation, settings: {} }, async (_s, _k, prompt) => {
    assert.ok(!prompt.user.includes('PRIVATE'));
    if (++round === 1) return JSON.stringify({ done: false, message: 'Converting.', tools: [{ name: 'convert_bbcode', arguments: { scope: 'one' } }, { name: 'read_reference', arguments: { index: 0, offset: 30000 } }, { name: 'read_conversation', arguments: {} }] });
    assert.match(prompt.user, /END_CANON/); assert.match(prompt.user, /"revision":1/);
    return JSON.stringify({ done: true, message: 'Converted the formatting.', tools: [] });
  });
  assert.equal(result.version, 2);
  assert.equal(result.operations[0].label, 'Converted 2 BBCode pairs to formatting');
  assert.ok(result.documentChanges.length > 0);
});

test('removing all selected text cannot turn later operations into manuscript-wide edits', () => {
  const source = fixture(); source.chapters[0].content.content = [p('Delete me'), p('Keep  spaces.')];
  const tools = createEditorialTools(source, { selection: { chapterId: 'one', from: 1, to: 10 } });
  tools.execute('rewrite_passage', { blockId: firstBlock(tools, 'selection').blockId, before: 'Delete me', after: '' });
  assert.throws(() => tools.execute('normalize_spaces', { scope: 'all' }), /selected text has been removed/);
  assert.equal(tools.execute('read_document', { scope: 'one' }).blocks[1].text, 'Keep  spaces.');
});

test('table restructuring and image relocation preserve content, while malformed tables are atomic failures', async () => {
  const source = fixture(), image = { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'Synthetic' } };
  source.chapters[0].content.content.push(image);
  const tools = createEditorialTools(source);
  const cell = value => ({ type: 'tableCell', content: [p(value)] });
  const table = { type: 'table', content: [{ type: 'tableRow', content: [cell('Left'), cell('Right')] }] };
  tools.execute('edit_blocks', { chapterId: 'two', revision: 0, from: 1, to: 1, blocks: [table] });
  const structure = tools.execute('read_structure', { chapterId: 'one' });
  assert.ok(structure.blocks.at(-1).node.assetId); assert.ok(!JSON.stringify(structure).includes('iVBOR'));
  tools.execute('move_blocks', { chapterId: 'one', targetChapterId: 'two', revision: tools.revision, from: 3, to: 4, index: 2 });
  const before = tools.changes();
  assert.throws(() => tools.execute('edit_blocks', { chapterId: 'two', revision: tools.revision, from: 1, to: 2, blocks: [{ ...table, content: [...table.content, { type: 'tableRow', content: [cell('Uneven')] }] }] }), /inconsistent/);
  assert.deepEqual(tools.changes(), before);
  const applied = await applyAgentResult(source, resultFor(source, tools), schema);
  assert.equal(applied.project.chapters[1].content.content[2].attrs.src, image.attrs.src);
  assert.equal(applied.project.chapters[1].content.content[1].type, 'table');
});
