import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@tiptap/pm/state';
import { editorialSchema } from '../electron/editor-schema.mjs';
import { findTextMatches, findManuscriptMatches, replaceManuscriptMatches, searchPatternError, replacementForMatch } from '../src/search.js';
const project = text => ({ chapters: [{ id:'one', title:'One', content:{ type:'doc', content:[{ type:'paragraph', content:[{ type:'text', text }] }] } }] });
test('RE2 search uses correct Unicode positions and capture replacement previews', () => {
  const p = project('😀 blue door; red door.');
  const matches = findManuscriptMatches(p, '(blue|red) (door)', { regex:true });
  assert.equal(matches.length, 2); assert.equal(matches[0].from, 4);
  assert.equal(replacementForMatch(matches[0], '$2: $1 $$'), 'door: blue $');
  const result = replaceManuscriptMatches(p, matches, '$2: $1');
  assert.equal(result.project.chapters[0].content.content[0].content[0].text, '😀 door: blue; door: red.');
});
test('invalid and empty regexes do not hang the editor and literal search is unchanged', () => {
  assert(searchPatternError('(', { regex:true }));
  assert.equal(findManuscriptMatches(project('abc'), '(', { regex:true }).length, 0);
  assert.equal(findManuscriptMatches(project('abc'), '^|$', { regex:true }).length, 0);
  assert.equal(findManuscriptMatches(project('a+b'), 'a+b').length, 1);
});

test('cached regex results follow shifted and edited blocks, options, and formatting', () => {
  const content = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Opening. ' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'needle', marks: [{ type: 'bold' }] }, { type: 'text', text: ' needlessly needle' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'NEEDLE', marks: [{ type: 'bold' }] }] }
  ] };
  const source = { chapters: [{ id: 'one', title: 'One', content }] };
  let state = EditorState.create({ schema: editorialSchema, doc: editorialSchema.nodeFromJSON(content) });
  const search = (options = {}) => findManuscriptMatches(source, '(needle)', { chapterId: 'one', activeDoc: state.doc, regex: true, ...options });
  let matches = search({ wholeWord: true, format: 'bold' });
  assert.deepEqual(matches.map(match => match.text), ['needle', 'NEEDLE']);
  const before = matches.map(match => match.from);
  state = state.apply(state.tr.insertText('Added ', 1));
  matches = search({ wholeWord: true, format: 'bold' });
  assert.deepEqual(matches.map(match => match.from), before.map(position => position + 6));
  assert.deepEqual(matches.map(match => match.captures[1]), ['needle', 'NEEDLE']);
  assert.equal(search({ wholeWord: true, format: 'bold', caseSensitive: true }).length, 1);
  assert.equal(search({ wholeWord: true }).length, 3);
  const first = matches[0];
  state = state.apply(state.tr.removeMark(first.from, first.to, editorialSchema.marks.bold));
  assert.deepEqual(search({ wholeWord: true, format: 'bold' }).map(match => match.text), ['NEEDLE']);
  assert.deepEqual(search().map(match => match.text), ['needle', 'needle', 'needle', 'NEEDLE']);
});

test('a bounded regex highlight never caches an incomplete paragraph as a complete search', () => {
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'needle '.repeat(2100) }] }] };
  const activeDoc = editorialSchema.nodeFromJSON(content);
  assert.equal(findTextMatches(activeDoc, '(needle)', 3, { regex: true }).length, 3);
  const matches = findManuscriptMatches({ chapters: [{ id: 'one', title: 'One', content }] }, '(needle)', { regex: true, chapterId: 'one', activeDoc });
  assert.equal(matches.length, 2100);
  assert.equal(matches.at(-1).captures[1], 'needle');
});

test('literal and regex formatting filters both recognize highlight and imported backgrounds across runs', () => {
  const doc = editorialSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'red ', marks: [{ type: 'highlight', attrs: { color: '#ff0000' } }] },
    { type: 'text', text: 'blue ', marks: [{ type: 'textStyle', attrs: { backgroundColor: '#aabbcc' } }] },
    { type: 'text', text: 'plain' }
  ] }] });
  for (const [literal, regex, count] of [['red', '(red)', 1], ['blue', '(blue)', 1], ['plain', '(plain)', 0], ['red blue', '(red blue)', 1], ['blue plain', '(blue plain)', 0]]) {
    const plainMatches = findTextMatches(doc, literal, Infinity, { format: 'highlight' });
    const regexMatches = findTextMatches(doc, regex, Infinity, { format: 'highlight', regex: true });
    assert.equal(plainMatches.length, count, literal);
    assert.deepEqual(regexMatches.map(({ from, to }) => ({ from, to })), plainMatches, literal);
  }
});
