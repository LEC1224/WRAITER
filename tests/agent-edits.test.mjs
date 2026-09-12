import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { createRequire } from 'node:module';
import { applyAgentResult } from '../src/agent-edits.js';
const { createDocumentTools, projectFingerprint } = createRequire(import.meta.url)('../electron/writing-agent.cjs');
const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block', attrs: { textAlign: { default: null } } }, blockquote: { content: 'block+', group: 'block' }, text: { group: 'inline' }, hardBreak: { inline: true, group: 'inline' } }, marks: { bold: {}, italic: {}, link: { attrs: { href: {} } } } });
const text = (value, mark) => schema.text(value, mark ? [schema.marks[mark].create()] : []);
const paragraph = (...children) => schema.node('paragraph', { textAlign: 'center' }, children);
const source = () => ({ format: 'wraiter', version: 1, id: 'atomic', title: 'Synthetic', chapters: [{ id: 'one', title: 'First', content: schema.node('doc', null, [paragraph(text('A  '), text('careful', 'italic'), text('  writer.')), paragraph(text('Second  line.'))]).toJSON() }, { id: 'two', title: 'Second', content: schema.node('doc', null, [paragraph(text('Other  chapter.', 'bold'))]).toJSON() }] });
const resultFor = (project, tools) => ({ projectId: project.id, baseFingerprint: projectFingerprint(project), ...tools.changes() });

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
