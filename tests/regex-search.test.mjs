import test from 'node:test';
import assert from 'node:assert/strict';
import { findManuscriptMatches, replaceManuscriptMatches, searchPatternError, replacementForMatch } from '../src/search.js';
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
