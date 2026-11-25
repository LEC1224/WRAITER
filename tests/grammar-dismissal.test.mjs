import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { grammarKey, LocalGrammar } from '../src/local-grammar.js';
import { grammarDismissal, mapGrammarDismissal } from '../src/grammar-dismissal.js';

function open(text) {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]);
  const plugins = LocalGrammar.config.addProseMirrorPlugins.call({ options: { enabled: true, language: 'en-US' } });
  const state = EditorState.create({ schema, doc, plugins });
  return state.apply(state.tr.setMeta(grammarKey, { refresh: true }));
}

const hints = state => grammarKey.getState(state).allHints;
const ignore = (state, hint, all = false) => state.apply(state.tr.setMeta(grammarKey, { ignore: { ...hint, all } }));

test('Ignore follows only its occurrence through edits, rechecks, formatting and splits', () => {
  let state = open('🙂 The the road. The the river.');
  const [first, second] = hints(state);
  assert.equal(first.original, 'The the');
  assert.equal(second.original, 'The the');
  state = ignore(state, first);
  state = state.apply(state.tr.insertText('Across town. ', first.from));
  state = state.apply(state.tr.insertText(' quietly', state.doc.textContent.indexOf('road') + 5));
  const position = state.doc.textContent.indexOf('The the') + 1;
  state = state.apply(state.tr.addMark(position, position + 3, schema.marks.bold.create()));
  state = state.apply(state.tr.split(position));
  state = state.apply(state.tr.setMeta(grammarKey, { refresh: true }));
  const remaining = hints(state);
  assert.equal(remaining.length, 1);
  assert.match(state.doc.textBetween(remaining[0].to, remaining[0].to + 6), / river/);

  // Removing and retyping the occurrence creates a new suggestion.
  const dismissed = grammarKey.getState(state).ignoredOnce[0];
  state = state.apply(state.tr.delete(dismissed.from, dismissed.to));
  state = state.apply(state.tr.insertText(dismissed.original, dismissed.from));
  assert.equal(hints(state).length, 2);
});

test('Ignore matching keeps repeated occurrences suppressed as the paragraph changes', () => {
  let state = open('The the road led to the the river.');
  assert.deepEqual(hints(state).map(h => h.replacement), ['The', 'the']);
  state = ignore(state, hints(state)[0], true);
  state = state.apply(state.tr.insertText(' The the valley.', state.doc.content.size - 1));
  assert.deepEqual(hints(state), []);
});

test('chapter matching distinguishes corrections that propose different capitalization', () => {
  const key = (original, replacement) => grammarDismissal({ from: 1, to: 1 + original.length, original, replacement, category: 'grammar' }).key;
  assert.equal(key('The the', 'The'), key('the the', 'the'));
  assert.equal(key('THE THE', 'THE'), key('the the', 'the'));
  assert.notEqual(key('THE THE', 'The'), key('THE THE', 'THE'));
  assert.notEqual(key('The the', 'The'), key('The the', 'the'));
});

test('an ignored deletion survives adjacent whitespace changes and equivalent engine results', () => {
  const state = open('They had stumbled.');
  const dismissed = grammarDismissal({ from: 6, to: 10, original: 'had ', replacement: '', category: 'grammar', rule: 'neural:$DELETE' });
  const transaction = state.tr.insertText('already ', 10);
  const mapped = mapGrammarDismissal(dismissed, transaction);
  assert.deepEqual(mapped, grammarDismissal({ from: 5, to: 9, original: ' had', replacement: '', category: 'grammar', rule: 'other' }));
  assert.deepEqual(mapped, grammarDismissal({ from: 6, to: 9, original: 'had', replacement: '', category: 'grammar', rule: 'other' }));
  assert.notEqual(mapped.key, grammarDismissal({ from: 6, to: 9, original: 'had', replacement: 'has', category: 'grammar', rule: 'other' }).key);
  assert.equal(mapGrammarDismissal(dismissed, state.tr.insertText('has', 6, 9)), null);
});
