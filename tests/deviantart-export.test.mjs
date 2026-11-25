import test from 'node:test';
import assert from 'node:assert/strict';
import { deviantArtDocument } from '../src/formats/deviantart.js';
import { exportScope, titleOptions } from '../src/formats/scope.js';
const text = (text, ...marks) => ({ type: 'text', text, marks: marks.map(type => typeof type === 'string' ? { type } : type) });
const p = (...content) => ({ type: 'paragraph', content });
const project = (...content) => ({ title: 'Manuscript', notes: 'PRIVATE', chapters: [{ id: 'a', title: 'Chapter', content: { type: 'doc', content } }] });
const exportBody = value => deviantArtDocument(value, { includeTitle: false, includeChapterTitles: false });

test('Literature paragraphs contain one real blank line, with no edge or duplicate spacer paragraphs', () => {
  const input = project(p(), p(text('  “First,” she said.  ')), p(), p(), p(text('Second'), { type: 'hardBreak' }, text('continued')), p());
  const before = structuredClone(input);
  assert.deepEqual(exportBody(input), { clipboardHTML: '<p>  “First,” she said.  </p><p><br></p><p>Second<br>continued</p>', clipboardText: '  “First,” she said.  \n\nSecond\ncontinued' });
  assert.deepEqual(input, before, 'Export must not change the editable manuscript');
  assert.deepEqual(exportBody(project(p(), p())), { clipboardHTML: '', clipboardText: '' });
});
test('Literature keeps semantic emphasis and safe links without copying CSS fonts or colours', () => {
  const input = project(p(text('<b> & [i]', 'bold', 'italic', 'underline', 'strike', { type: 'textStyle', attrs: { color: '#ffffff' } }), text(' link', { type: 'link', attrs: { href: 'https://example.com/?a=1&b="2"' } }), text(' unsafe', { type: 'link', attrs: { href: 'javascript:alert(1)' } })));
  const result = exportBody(input);
  assert.equal(result.clipboardText, '<b> & [i] link unsafe');
  assert.equal(result.clipboardHTML, '<p><s><u><em><strong>&lt;b&gt; &amp; [i]</strong></em></u></s><a href="https://example.com/?a=1&amp;b=&quot;2&quot;"> link</a> unsafe</p>');
});
test('named styles carry emphasis and paragraph alignment to Literature', () => {
  const input = project({ ...p(text('Thought', { type: 'namedStyle', attrs: { id: 'thought' } })), attrs: { namedStyle: 'body' } });
  input.namedStyles = [{ id: 'body', attrs: { bold: true, textAlign: 'center', spaceAfter: 20 } }, { id: 'thought', attrs: { italic: true, color: '#ffffff' } }];
  assert.equal(exportBody(input).clipboardHTML, '<p style="text-align:center"><em><strong>Thought</strong></em></p>');
});
test('Literature retains headings, list starts, quotes, notes and scene breaks; tables and images stay readable', () => {
  const input = project({ type: 'heading', attrs: { level: 6 }, content: [text('Heading')] }, { type: 'orderedList', attrs: { start: 7 }, content: [{ type: 'listItem', content: [p(text('Seven')), p(text('continued'))] }] }, { type: 'blockquote', content: [p(text('Quote')), p(text('More'))] }, { type: 'horizontalRule' }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(text('A', 'bold')), p(text('continued'))] }, { type: 'tableCell', content: [p(text('B'))] }] }] }, { type: 'image', attrs: { alt: '<Portrait>' } }, p({ type: 'note', attrs: { kind: 'endnote', text: 'Note wording' } }));
  const result = exportBody(input);
  assert.match(result.clipboardHTML, /<h3>Heading<\/h3><p><br><\/p><ol start="7"><li><p>Seven<\/p><p><br><\/p><p>continued<\/p><\/li><\/ol>/);
  assert.match(result.clipboardHTML, /<blockquote><p>Quote<\/p><p><br><\/p><p>More<\/p><\/blockquote>/);
  assert.match(result.clipboardHTML, /<hr><p><br><\/p><p><strong>A<\/strong><br>continued \| B<\/p>/);
  assert.match(result.clipboardHTML, /\[Image: &lt;Portrait&gt;\]/);
  assert.match(result.clipboardText, /7\. Seven\n\ncontinued/);
  assert.match(result.clipboardText, /A\ncontinued \| B/);
  assert.match(result.clipboardText, /\[Endnote: Note wording\]/);
  assert.doesNotMatch(result.clipboardHTML, /<table|<img|PRIVATE/);
});
test('Literature scope, title options and long manuscripts retain all requested text', () => {
  const input = project(p(text('x'.repeat(100000))));
  input.chapters.push({ id: 'b', title: 'Other', content: { type: 'doc', content: [p(text('Not selected'))] } });
  const options = { scope: 'chapter', chapterId: 'a', includeChapterTitles: false };
  assert.equal(deviantArtDocument(exportScope(input, options), titleOptions(options)).clipboardText, 'x'.repeat(100000));
  const selection = { scope: 'selection', selectionDoc: { type: 'doc', content: [p(text('Selected', 'italic'))] } };
  assert.equal(deviantArtDocument(exportScope(input, selection), titleOptions(selection)).clipboardHTML, '<p><em>Selected</em></p>');
  assert.equal(deviantArtDocument(project(p(text('Body'))), { includeTitle: true, includeChapterTitles: true }).clipboardText, 'Manuscript\n\nChapter\n\nBody');
});
