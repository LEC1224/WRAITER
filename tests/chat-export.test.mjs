import test from 'node:test';
import assert from 'node:assert/strict';
import { chatMarkup, chatDocument } from '../src/formats/chat.js';
import { exportScope, titleOptions } from '../src/formats/scope.js';
const text = (value, ...marks) => ({ type: 'text', text: value, marks: marks.map(type => ({ type })) });
const paragraph = (...content) => ({ type: 'paragraph', content });

test('chat exports escape literal markup without HTML-encoding Discord prose', () => {
  assert.equal(chatMarkup(text('A & B <test> *word*'), 'discord'), 'A & B <test\\> \\*word\\*');
  assert.equal(chatMarkup(text('Hello.world! (yes)_'), 'telegram-md'), 'Hello\\.world\\! \\(yes\\)\\_');
  assert.equal(chatMarkup(text('<a> & "b"'), 'telegram-html'), '&lt;a&gt; &amp; &quot;b&quot;');
});
test('emphasis, whitespace and Telegram italic/underline ambiguity', () => {
  assert.equal(chatMarkup(text(' strong ', 'bold'), 'discord'), ' **strong** ');
  assert.equal(chatMarkup(text('strong', 'bold'), 'telegram-md'), '*strong*');
  assert.equal(chatMarkup(text('both', 'italic', 'underline'), 'telegram-md'), '___both_**__');
  assert.equal(chatMarkup(text('both', 'bold', 'italic'), 'telegram-html'), '<b><i>both</i></b>');
  assert.equal(chatMarkup(paragraph(text('a', 'italic'), text('b', 'underline')), 'telegram-md'), '_a_**__b__\n\n');
});
test('links and code cannot escape into chat markup', () => {
  const link = text('link'); link.marks.push({ type: 'link', attrs: { href: 'https://example.com/a)b' } });
  assert.equal(chatMarkup(link, 'telegram-md'), '[link](https://example.com/a\\)b)');
  link.marks[0].attrs.href = 'javascript:alert(1)';
  assert.equal(chatMarkup(link, 'telegram-html'), 'link');
  assert.equal(chatMarkup(text('a`b\\c', 'code', 'bold'), 'telegram-md'), '`a\\`b\\\\c`');
  assert.equal(chatMarkup(text('a`b', 'code'), 'discord'), 'a\\`b');
});
test('structure retains list starts, quotations, tables and image labels', () => {
  const list = { type: 'orderedList', attrs: { start: 7 }, content: [{ type: 'listItem', content: [paragraph(text('Seven'))] }] };
  assert.equal(chatMarkup(list, 'discord'), '7. Seven\n\n');
  assert.equal(chatMarkup(list, 'telegram-md'), '7\\. Seven\n\n');
  assert.equal(chatMarkup({ type: 'blockquote', content: [paragraph(text('Quoted'))] }, 'telegram-html'), '<blockquote>Quoted</blockquote>\n\n');
  assert.equal(chatMarkup({ type: 'table', content: [{ type: 'tableRow', content: ['A', 'B'].map(t => ({ type: 'tableCell', content: [paragraph(text(t))] })) }] }, 'discord'), 'A\tB\n\n');
  assert.match(chatMarkup({ type: 'image', attrs: { alt: 'Aurora' } }, 'telegram-html'), /Image: Aurora/);
});
test('scope and headings omit private content and never truncate long text', () => {
  const project = { title: 'Title', notes: 'PRIVATE', chapters: [{ id: 'a', title: 'First', content: { type: 'doc', content: [paragraph(text('x'.repeat(5000)))] } }, { id: 'b', title: 'Second', content: { type: 'doc', content: [paragraph(text('Other'))] } }] };
  const options = { scope: 'chapter', chapterId: 'a', includeChapterTitles: false };
  const result = chatDocument(exportScope(project, options), 'discord', titleOptions(options));
  assert.equal(result, 'x'.repeat(5000) + '\n\n');
  assert.equal(chatDocument(project, 'telegram-md', { includeTitle: true, includeChapterTitles: true }).startsWith('*Title*\n\n*First*'), true);
});
