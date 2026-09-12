import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { createRequire } from 'node:module';
import { applyAgentResult } from '../src/agent-edits.js';
import { createHistory, recordProjectChange, applyHistory } from '../src/history.js';
const { createDocumentTools, projectFingerprint } = createRequire(import.meta.url)('../electron/writing-agent.cjs');
const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block', attrs: { textAlign: { default: null } } }, blockquote: { content: 'block+', group: 'block' }, text: { group: 'inline' }, hardBreak: { inline: true, group: 'inline' } }, marks: { bold: {}, italic: {}, link: { attrs: { href: {} } } } });
const text = (value, mark) => schema.text(value, mark ? [schema.marks[mark].create()] : []);
const paragraph = (...children) => schema.node('paragraph', { textAlign: 'center' }, children);
const source = () => ({ format: 'wraiter', version: 1, id: 'atomic', title: 'Synthetic', chapters: [{ id: 'one', title: 'First', content: schema.node('doc', null, [paragraph(text('A  '), text('careful', 'italic'), text('  writer.')), paragraph(text('Second  line.'))]).toJSON() }, { id: 'two', title: 'Second', content: schema.node('doc', null, [paragraph(text('Other  chapter.', 'bold'))]).toJSON() }] });
const resultFor = (project, tools) => ({ projectId: project.id, baseFingerprint: projectFingerprint(project), ...tools.changes() });

test('empty-paragraph cleanup removes real blocks across chapters and remains one persistent undo action', async () => {
  const original = source();
  original.chapters[0].content = schema.node('doc', null, [paragraph(), paragraph(text('Keep bold', 'bold')), paragraph(text(' \t ')), schema.node('blockquote', null, [paragraph(), paragraph(text('Keep quote', 'italic')), paragraph()]), paragraph()]).toJSON();
  original.chapters[1].content = schema.node('doc', null, [paragraph(), paragraph()]).toJSON();
  const tools = createDocumentTools(original);
  assert.equal(tools.execute('remove_empty_paragraphs', {}).count, 6);
  assert.equal(tools.execute('remove_empty_paragraphs', {}).count, 0);
  const applied = await applyAgentResult(original, resultFor(original, tools), schema);
  const doc = schema.nodeFromJSON(applied.project.chapters[0].content);
  assert.equal(doc.childCount, 2); assert.equal(doc.child(0).firstChild.marks[0].type.name, 'bold');
  assert.equal(doc.child(1).childCount, 1); assert.equal(doc.child(1).firstChild.firstChild.marks[0].type.name, 'italic');
  assert.equal(schema.nodeFromJSON(applied.project.chapters[1].content).childCount, 1);
  const journal = recordProjectChange(createHistory(original), original, applied.project, { label: 'Remove empty lines' });
  const undone = applyHistory(applied.project, journal, 'undo', schema);
  assert.equal(JSON.stringify(undone.project.chapters), JSON.stringify(original.chapters));
  const resumed = createHistory(undone.project, JSON.parse(JSON.stringify(undone.journal)));
  assert.equal(JSON.stringify(applyHistory(undone.project, resumed, 'redo', schema).project.chapters), JSON.stringify(applied.project.chapters));
});

test('agent can combine paragraph removal with prose edits and cannot escape a selection', async () => {
  const original = source(); original.chapters[0].content = schema.node('doc', null, [paragraph(text('Left')), paragraph(), paragraph(text('Right'))]).toJSON();
  const tools = createDocumentTools(original);
  tools.execute('remove_empty_paragraphs', {});
  tools.execute('replace_all', { find: 'Right', replace: 'Right!', expectedCount: 1 });
  const applied = await applyAgentResult(original, resultFor(original, tools), schema);
  assert.equal(schema.nodeFromJSON(applied.project.chapters[0].content).textContent, 'LeftRight!');
  const limited = createDocumentTools(original, { selection: { chapterId: 'one', from: 6, to: 8 } });
  assert.equal(limited.execute('remove_empty_paragraphs', { scope: 'all' }).count, 1);
  assert.throws(() => limited.execute('replace_all', { scope: 'all', find: 'Other', replace: 'Changed', expectedCount: 1 }), /Found 0/);
  assert.throws(() => limited.execute('rename_chapter', { chapterId: 'two', before: 'Second', title: 'Changed' }), /outside the selected/);
  assert.equal(limited.changes().edits.length, 1);
});

test('required list and table paragraphs survive empty cleanup; nonempty deletion needs an exact original', async () => {
  const { Schema } = await import('@tiptap/pm/model');
  const nestedSchema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' }, bulletList: { content: 'listItem+', group: 'block' }, listItem: { content: 'paragraph block*' }, table: { content: 'tableRow+', group: 'block' }, tableRow: { content: 'tableCell+' }, tableCell: { content: 'block+' } } });
  const empty = { type: 'paragraph' }, source = { ...originalBase(), chapters: [{ id: 'one', title: 'First', content: { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [empty, empty] }] }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [empty, empty] }] }] }] } }] };
  const tools = createDocumentTools(source); const cleaned = tools.execute('remove_empty_paragraphs', {});
  assert.equal(cleaned.count, 2); assert.equal(cleaned.retained, 2);
  const applied = await applyAgentResult(source, resultFor(source, tools), nestedSchema); nestedSchema.nodeFromJSON(applied.project.chapters[0].content).check();
  const regular = sourceWithText(); const exact = createDocumentTools(regular);
  assert.throws(() => exact.execute('delete_paragraph', { blockId: 'c0.b0', before: 'wrong' }), /exact original/);
  exact.execute('delete_paragraph', { blockId: 'c0.b0', before: 'A  careful  writer.' });
  const removed = await applyAgentResult(regular, resultFor(regular, exact), schema);
  assert.equal(schema.nodeFromJSON(removed.project.chapters[0].content).childCount, 1);
  function originalBase() { return { format: 'wraiter', version: 1, id: 'nested', title: 'Nested test' }; }
  function sourceWithText() { return { ...originalBase(), chapters: [{ id: 'one', title: 'First', content: schema.node('doc', null, [paragraph(text('A  careful  writer.')), paragraph(text('Keep'))]).toJSON() }] }; }
});

test('agent changes multiple chapters while preserving paragraph attributes and unchanged inline marks', async () => {
  const original = source(); const tools = createDocumentTools(original); tools.execute('normalize_spaces', {});
  const result = await applyAgentResult(original, resultFor(original, tools), schema);
  assert.deepEqual(result.changedChapters, ['one', 'two']); assert.equal(result.changeCount, 3);
  const doc = schema.nodeFromJSON(result.project.chapters[0].content);
  assert.equal(doc.textContent, 'A careful writer.Second line.');
  assert.equal(doc.child(0).attrs.textAlign, 'center');
  let styled = ''; doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === 'italic')) styled += node.text; }); assert.equal(styled, 'careful');
  assert.equal(schema.nodeFromJSON(result.project.chapters[1].content).firstChild.firstChild.marks[0].type.name, 'bold');
  assert.equal(schema.nodeFromJSON(original.chapters[0].content).textContent, 'A  careful  writer.Second  line.');
});

test('stale results reject the entire batch before any active or inactive chapter changes', async () => {
  const original = source(); const tools = createDocumentTools(original); tools.execute('normalize_spaces', {}); const result = resultFor(original, tools);
  const edited = structuredClone(original); edited.chapters[1].title = 'Changed while thinking';
  await assert.rejects(applyAgentResult(edited, result, schema), /document changed/);
  assert.equal(schema.nodeFromJSON(edited.chapters[0].content).textContent, 'A  careful  writer.Second  line.');
});

test('agent handles hard breaks, empty paragraphs, and title edits without replacing surrounding structure', async () => {
  const original = source(); original.chapters = [{ id: 'one', title: 'First', content: schema.node('doc', null, [paragraph(), schema.node('blockquote', null, [paragraph(text('A  line'), schema.node('hardBreak'), text('with  spaces.'))])]).toJSON() }];
  const tools = createDocumentTools(original); tools.execute('normalize_spaces', {}); tools.execute('rename_chapter', { chapterId: 'one', before: 'First', title: 'Opening' });
  const result = await applyAgentResult(original, resultFor(original, tools), schema);
  assert.equal(result.project.chapters[0].title, 'Opening');
  const doc = schema.nodeFromJSON(result.project.chapters[0].content); assert.equal(doc.firstChild.content.size, 0); assert.equal(doc.child(1).type.name, 'blockquote');
  assert.equal(doc.child(1).firstChild.textBetween(0, doc.child(1).firstChild.content.size, '', '\n'), 'A line\nwith spaces.');
  assert.equal(doc.child(1).firstChild.child(1).type.name, 'hardBreak');
});

test('rewritten passages can add soft breaks while preserving the paragraph', async () => {
  const original = source(); const tools = createDocumentTools(original); tools.execute('rewrite_passage', { blockId: 'c0.b1', before: 'Second  line.', after: 'Second\nline.' });
  const result = await applyAgentResult(original, resultFor(original, tools), schema);
  const paragraph = schema.nodeFromJSON(result.project.chapters[0].content).child(1);
  assert.equal(paragraph.type.name, 'paragraph'); assert.equal(paragraph.child(1).type.name, 'hardBreak'); assert.equal(paragraph.textContent, 'Secondline.');
});
