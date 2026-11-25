import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { LocalGrammar, documentGrammar, grammarKey } from '../src/local-grammar.js';
import { dialogueLookup } from '../src/grammar-dialogue.js';

const paragraph = text => schema.node('paragraph', null, schema.text(text));
const plugin = () => LocalGrammar.config.addProseMirrorPlugins.call(LocalGrammar)[0];
const settings = { enabled: true, spelling: true, language: 'en-US' };

test('deferred local checks follow the current document and stop when the editor closes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  t.after(() => {
    if (originalFrame) globalThis.requestAnimationFrame = originalFrame;
    else delete globalThis.requestAnimationFrame;
  });
  const grammar = plugin(), doc = schema.node('doc', null, Array.from({ length: 80 }, (_, i) => paragraph('The the old road ' + i + '.')));
  let lifecycle, dispatches = 0;
  const view = {
    state: EditorState.create({ doc, plugins: [grammar] }), dom: { closest: () => null },
    dispatch(tr) {
      dispatches++;
      const previous = this.state;
      this.state = previous.apply(tr);
      lifecycle.update(this, previous);
    }
  };
  lifecycle = grammar.spec.view(view);
  try {
    view.dispatch(view.state.tr.setMeta(grammarKey, settings));
    const initial = grammarKey.getState(view.state);
    assert.ok(initial.hints.length > 0 && initial.hints.length < 80, 'Opening the chapter leaves bulk rule checking for later');
    const replacement = Array.from({ length: 64 }, (_, i) => paragraph('And and so it went ' + i + '.'));
    view.dispatch(view.state.tr.replaceWith(0, doc.content.size, replacement));
    for (let i = 0; i < 10 && grammarKey.getState(view.state).deferred.length; i++) t.mock.timers.tick(16);
    const checked = grammarKey.getState(view.state);
    assert.equal(checked.hints.length, replacement.length);
    assert.ok(checked.hints.every(hint => view.state.doc.textBetween(hint.from, hint.to) === 'And and'));
    assert.equal(checked.decorations.find().length, replacement.length);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
    assert.ok(grammarKey.getState(view.state).deferred.length);
  } finally { lifecycle.destroy(); }
  const closedAt = dispatches;
  t.mock.timers.tick(10000);
  assert.equal(dispatches, closedAt, 'A retired editor cannot publish delayed hints');
});

test('visible local underlines follow edits, replacements and selection across a window of hints', () => {
  const shared = paragraph('The the lamp was dim.');
  const doc = schema.node('doc', null, Array.from({ length: 1110 }, (_, i) => i % 9 ? paragraph('The the window number ' + i + '.') : shared));
  documentGrammar(doc, 'en-US');
  let state = EditorState.create({ doc, plugins: [plugin()] });
  function apply(tr) {
    state = state.apply(tr);
    const checked = grammarKey.getState(state);
    const all = documentGrammar(state.doc, 'en-US');
    assert.deepEqual(checked.hints.map(hint => [hint.from, hint.to]), all.map(hint => [hint.from, hint.to]));
    const expected = checked.visible;
    const actual = checked.decorations.find().map(mark => [mark.from, mark.to, mark.spec.hint.id]).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(actual, expected.map(hint => [hint.from, hint.to, hint.id]));
  }
  apply(state.tr.setMeta(grammarKey, settings));
  apply(state.tr.insertText('New ', 1));
  apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
  apply(state.tr.insertText('!', state.doc.content.size - 1));
  apply(state.tr.replaceWith(0, state.doc.firstChild.nodeSize, [shared, shared]));
  apply(state.tr.replaceWith(0, state.doc.content.size, state.doc.content));
  const decorations = grammarKey.getState(state).decorations;
  apply(state.tr.setMeta(grammarKey, { status: 'ready' }));
  assert.equal(grammarKey.getState(state).decorations, decorations);
});

test('dialogue-sensitive hints retain their context across contractions, possessives and an unmatched quote', () => {
  const line = "We was outside. “We was in the dogs’ yard. We was here.” We was tired. ‘We was waiting.";
  const inDialogue = dialogueLookup(line);
  const positions = [...line.matchAll(/was/g)].map(match => match.index);
  assert.deepEqual(positions.map(inDialogue), [false, true, true, false, true]);
  assert.deepEqual([...positions].reverse().map(inDialogue), [true, false, true, true, false]);
});
