import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { AIGrammar, aiGrammarKey, inlineGrammarPassage, inlineGrammarFindings, grammarHintForMenu, grammarMenuPreview, aiGrammarTransaction } from '../src/ai-grammar.js';
import { trackedEditor, trackModeKey } from '../src/tracked-editor.js';

const plugins = () => [...AIGrammar.config.addProseMirrorPlugins(), ...trackedEditor(() => {}).config.addProseMirrorPlugins(), history()];
const stateFor = content => EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content }), plugins: plugins() });
const paragraph = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const finding = (original = 'walkd', replacement = 'walked') => ({ passageId: 'active-paragraph', start: 4, end: 4 + original.length, original, replacement, category: 'grammar', severity: 'definite', reason: 'Check the verb.' });

test('inline AI collects only the caret paragraph, excluding atoms, code and pending revisions', () => {
  let state = stateFor([paragraph('She walkd home.'), paragraph('Secret other paragraph.')]);
  assert.deepEqual(inlineGrammarPassage(state), { id: 'active-paragraph', chapterTitle: '', paragraph: 1, text: 'She walkd home.', from: 1, to: 16 });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
  assert.equal(inlineGrammarPassage(state), null);
  assert.equal(inlineGrammarPassage(state, { forCache: true }).text, 'She walkd home.');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5, 20)));
  assert.equal(inlineGrammarPassage(state, { forCache: true }), null, 'A selection spanning paragraphs cannot reuse either paragraph');
  for (const block of [
    paragraph('She walkd home.', [{ type: 'trackedChange', attrs: { id: 'pending', kind: 'delete' } }]),
    { type: 'codeBlock', content: [{ type: 'text', text: 'She walkd home.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'She walkd home.' }, { type: 'note', attrs: { kind: 'footnote', text: 'Private note' } }] },
    paragraph('a'.repeat(4001))
  ]) assert.equal(inlineGrammarPassage(stateFor([block])), null);
});

test('AI hints validate UTF-16 ranges, exact originals, overlap and grammar confidence', () => {
  const passage = { id: 'active-paragraph', from: 10, text: '🙂 She walkd home.' };
  const item = { ...finding(), start: 7, end: 12 };
  const result = inlineGrammarFindings({ findings: [item, item, { ...item, original: 'stale' }, { ...item, severity: 'optional' }, { ...item, category: 'phrasing' }, { ...item, replacement: 'walked\nhome' }] }, passage);
  assert.equal(result.length, 1); assert.equal(result[0].from, 17); assert.equal(result[0].to, 22);
});

test('AI decorations do not alter manuscript and clear as soon as the document changes', () => {
  let state = stateFor([paragraph('She walkd home.')]);
  const hints = inlineGrammarFindings({ findings: [finding()] }, inlineGrammarPassage(state)), before = state.doc.toJSON();
  state = state.apply(state.tr.setMeta(aiGrammarKey, hints));
  assert.deepEqual(state.doc.toJSON(), before); assert.equal(aiGrammarKey.getState(state).decorations.find().length, 1);
  state = state.apply(state.tr.insertText('!', 16));
  assert.equal(aiGrammarKey.getState(state).hints.length, 0);
  assert.throws(() => aiGrammarTransaction(state, hints[0]), /changed/);
});

test('the pointer targets only the clicked underline; the keyboard targets a single hint at the selection', () => {
  let state = stateFor([paragraph('She walkd home..')]);
  const hints = inlineGrammarFindings({ findings: [finding(), { ...finding('.', ''), start: 15, end: 16 }] }, inlineGrammarPassage(state));
  state = state.apply(state.tr.setMeta(aiGrammarKey, hints));
  const select = (from, to) => { state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))); };
  select(6);
  assert.equal(grammarHintForMenu(state, hints[1].id, false), hints[1]);
  assert.equal(grammarHintForMenu(state, undefined, false), undefined);
  assert.equal(grammarHintForMenu(state, undefined, true), hints[0]);
  select(hints[1].from, hints[1].to); assert.equal(grammarHintForMenu(state, undefined, true), hints[1]);
  select(3, hints[1].to); assert.equal(grammarHintForMenu(state, undefined, true), undefined);
});

test('menu previews show complete short corrections and clearly identify deletions, spaces and longer edits', () => {
  const preview = (original, replacement) => grammarMenuPreview({ original, replacement });
  assert.deepEqual(preview('the slightest', 'the slightest bit'), { preview: 'the slightest → the slightest bit', reviewOnly: false });
  assert.deepEqual(preview('.', ''), { preview: 'Remove “.”', reviewOnly: false });
  assert.equal(preview('  ', ' ').preview, '2 spaces → 1 space');
  const context = 'Neither the handwritten notes in the blue folder nor the letter on the desk ';
  assert.deepEqual(preview(context + 'were legible.', context + 'was legible.'), { preview: 'were → was', reviewOnly: true });
  const long = preview('🙂'.repeat(100), '🙃'.repeat(100));
  assert.deepEqual(long, { preview: '🙂'.repeat(22) + '… → ' + '🙃'.repeat(22) + '…', reviewOnly: true });
  assert.deepEqual(preview('go', 'go\u202E'), { preview: '', reviewOnly: true });
});

test('accepting a hint retains formatting and comments and is a separate undo step', () => {
  let state = stateFor([paragraph('She walkd home.', [{ type: 'italic' }, { type: 'commentAnchor', attrs: { id: 'comment_one' } }])]);
  const hints = inlineGrammarFindings({ findings: [finding()] }, inlineGrammarPassage(state));
  state = state.apply(state.tr.setMeta(aiGrammarKey, hints));
  state = state.apply(aiGrammarTransaction(state, hints[0]));
  assert.equal(state.doc.textContent, 'She walked home.');
  assert.deepEqual(state.doc.nodeAt(5).marks.map(mark => mark.type.name), ['italic', 'commentAnchor']);
  assert(undo(state, tr => { state = state.apply(tr); })); assert.equal(state.doc.textContent, 'She walkd home.');
});

test('accepting a hint respects text tracking instead of silently rewriting it', () => {
  let state = stateFor([paragraph('She walkd home.')]);
  const hints = inlineGrammarFindings({ findings: [finding()] }, inlineGrammarPassage(state));
  state = state.apply(state.tr.setMeta(aiGrammarKey, hints).setMeta(trackModeKey, true));
  state = state.apply(aiGrammarTransaction(state, hints[0]));
  const changes = []; state.doc.descendants(node => { if (node.isText) for (const mark of node.marks) if (mark.type.name === 'trackedChange') changes.push([node.text, mark.attrs.kind]); });
  assert.deepEqual(changes, [['walkd', 'delete'], ['walked', 'insert']]);
});

test('sentence-wide corrections retain unchanged mixed formatting and exact comment boundaries', () => {
  let state = stateFor([{ type: 'paragraph', content: [{ type: 'text', text: 'She ' }, { type: 'text', text: 'walkd', marks: [{ type: 'italic' }, { type: 'commentAnchor', attrs: { id: 'comment_one' } }] }, { type: 'text', text: ' home.', marks: [{ type: 'bold' }] }] }]);
  const item = { ...finding('She walkd home.', 'She walked home.'), start: 0, end: 15 };
  const hints = inlineGrammarFindings({ findings: [item] }, inlineGrammarPassage(state));
  state = state.apply(state.tr.setMeta(aiGrammarKey, hints)); state = state.apply(aiGrammarTransaction(state, hints[0]));
  assert.deepEqual(state.doc.toJSON().content[0].content.map(run => [run.text, run.marks?.map(mark => mark.type) || []]), [['She ', []], ['walked', ['italic', 'commentAnchor']], [' home.', ['bold']]]);
});

test('ambiguous changed formatting spans are refused, including with Track changes enabled', () => {
  for (const tracked of [false, true]) {
    let state = stateFor([{ type: 'paragraph', content: [{ type: 'text', text: 'She ' }, { type: 'text', text: 'xx', marks: [{ type: 'italic' }] }, { type: 'text', text: 'yy home.' }] }]);
    const hints = inlineGrammarFindings({ findings: [{ ...finding('xxyy', 'ZZ'), start: 4, end: 8 }] }, inlineGrammarPassage(state));
    state = state.apply(state.tr.setMeta(aiGrammarKey, hints).setMeta(trackModeKey, tracked));
    assert.throws(() => aiGrammarTransaction(state, hints[0]), /boundaries/); assert.equal(state.doc.textContent, 'She xxyy home.');
  }
});

test('an appended character stays in the corrected word comment and style', () => {
  let state = stateFor([{ type: 'paragraph', content: [{ type: 'text', text: 'She ' }, { type: 'text', text: 'walk', marks: [{ type: 'italic' }, { type: 'commentAnchor', attrs: { id: 'comment_one' } }] }, { type: 'text', text: ' home.' }] }]);
  const hints = inlineGrammarFindings({ findings: [finding('walk', 'walks')] }, inlineGrammarPassage(state));
  state = state.apply(state.tr.setMeta(aiGrammarKey, hints)); state = state.apply(aiGrammarTransaction(state, hints[0]));
  assert.equal(state.doc.child(0).child(1).text, 'walks'); assert.deepEqual(state.doc.child(0).child(1).marks.map(mark => mark.type.name), ['italic', 'commentAnchor']);
});
