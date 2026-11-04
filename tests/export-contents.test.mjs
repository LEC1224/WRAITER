import test from 'node:test';
import assert from 'node:assert/strict';
import { withExportContents } from '../src/formats/contents.js';

test('contents list uses chapter titles and nested headings without changing manuscript', () => {
  const project = { chapters: [{ id: 'one', title: 'Chapter One', content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The ' }, { type: 'text', text: 'Beginning' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Private story wording' }] }
  ] } }] };
  const original = structuredClone(project), result = withExportContents(project);
  assert.deepEqual(project, original);
  assert.equal(result.chapters.length, 2);
  assert.deepEqual(result.chapters[0].content.content.map(block => block.content[0].text), ['Chapter One', 'The Beginning']);
  assert.equal(result.chapters[0].title, 'Contents');
  assert.equal(result.chapters[1], project.chapters[0]);
  const noChapterTitles = withExportContents(project, { includeChapterTitles: false });
  assert.deepEqual(noChapterTitles.chapters[0].content.content.map(block => block.content[0].text), ['Contents', 'The Beginning']);
});
