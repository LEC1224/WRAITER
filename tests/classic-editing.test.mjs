import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { findTextMatches, findManuscriptMatches, replaceManuscriptMatches, matchesTextRange } from '../src/search.js';
import { smartPunctuation, textSubstitution } from '../src/typing.js';
import preferences from '../electron/preferences.cjs';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} }, marks: { bold: {}, italic: {} } });
const bold = schema.marks.bold.create();
const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('cat ', [bold]), schema.text('cot cat')])]);

test('optional wildcard and formatting searches agree with range validation', () => {
  const options = { wildcard: true, format: 'bold' };
  const matches = findTextMatches(doc, 'c?t', Infinity, options);
  assert.deepEqual(matches, [{ from: 1, to: 4 }]);
  assert.equal(matchesTextRange(doc, 1, 4, 'c?t', options), true);
  assert.equal(matchesTextRange(doc, 5, 8, 'c?t', options), false);
  assert.equal(findTextMatches(doc, 'c?t').length, 0);
  assert.equal(findTextMatches(doc, 'c?t', Infinity, { wildcard: true }).length, 3);
  const project = { chapters: [{ id: 'one', title: 'One', content: doc.toJSON() }] };
  const result = findManuscriptMatches(project, 'c?t', { ...options, schema });
  const changed = replaceManuscriptMatches(project, result, 'fox', { schema });
  assert.equal(schema.nodeFromJSON(changed.project.chapters[0].content).textContent, 'fox cot cat');
  assert.equal(findManuscriptMatches(project, 'c?t', { wildcard: true, schema }).length, 3, 'cache respects changed search options');
});

test('local text substitutions match boundaries and only fire on typed spaces', () => {
  const rules = [{ from: 'brb', to: 'be right back' }, { from: 'b', to: 'bee' }];
  assert.deepEqual(textSubstitution('say brb', ' ', rules), { remove: 3, text: 'be right back ' });
  assert.equal(textSubstitution('cyberbrb', ' ', rules), null);
  assert.equal(textSubstitution('say brb', '.', rules), null);
  assert.equal(textSubstitution('say BRB', ' ', rules), null);
  assert.equal(textSubstitution('\ufffc', ' ', [{ from: '\ufffc', to: 'oops' }]), null);
  assert.deepEqual(preferences.validateSettings({ substitutions: rules }).substitutions, rules);
  assert.throws(() => preferences.validateSettings({ substitutions: [{ from: 'two words', to: 'x' }] }));
  assert.throws(() => preferences.validateSettings({ substitutions: [rules[0], rules[0]] }));
});

test('smart punctuation is opt-in and transforms only the typed characters', () => {
  assert.deepEqual(smartPunctuation('hello-', '-'), { remove: 1, text: '—' });
  assert.deepEqual(smartPunctuation('wait..', '.'), { remove: 2, text: '…' });
  assert.deepEqual(smartPunctuation(' ', '"'), { remove: 0, text: '“' });
  assert.deepEqual(smartPunctuation('said', '"'), { remove: 0, text: '”' });
  assert.deepEqual(smartPunctuation('don', "'"), { remove: 0, text: '’' });
  assert.equal(smartPunctuation('hello', 'x'), null);
  assert.equal(preferences.defaults.smartPunctuation, false);
  assert.equal(preferences.defaults.showFormattingMarks, false);
  assert.deepEqual(preferences.validateSettings({ smartPunctuation: true, showFormattingMarks: true }), { smartPunctuation: true, showFormattingMarks: true });
  assert.throws(() => preferences.validateSettings({ smartPunctuation: 'yes' }));
});
