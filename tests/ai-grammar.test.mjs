import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { AIGrammar, aiGrammarKey, inlineGrammarPassage, inlineGrammarPassages, inlineGrammarFindings, grammarContext, mapGrammarHint, grammarHintForMenu, grammarMenuPreview, aiGrammarTransaction, outsideCheckedPassages } from '../src/ai-grammar.js';
import { trackedEditor, trackModeKey } from '../src/tracked-editor.js';

const plugins = () => [...AIGrammar.config.addProseMirrorPlugins(), ...trackedEditor(() => {}).config.addProseMirrorPlugins(), history()];
const stateFor = content => EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content }), plugins: plugins() });
const paragraph = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const finding = (original = 'walkd', replacement = 'walked') => ({ passageId: 'active-paragraph', start: 4, end: 4 + original.length, original, replacement, category: 'grammar', severity: 'definite', reason: 'Check the verb.' });

test('checked-passage filtering keeps exactly the hints outside their original passages', () => {
  const passages = [{ from: 3, to: 8 }, { from: 8, to: 15 }, { from: 20, to: 30 }];
  const hints = [{ from: 0, to: 2 }, { from: 3, to: 8 }, { from: 7, to: 9 }, { from: 8, to: 9 }, { from: 15, to: 20 }, { from: 21, to: 29 }, { from: 29, to: 31 }];
  assert.deepEqual(outsideCheckedPassages(hints, passages), [hints[0], hints[2], hints[4], hints[6]]);
  const manyPassages = Array.from({ length: 1000 }, (_, index) => ({ from: index * 12, to: index * 12 + 8 }));
  const manyHints = Array.from({ length: 3000 }, (_, index) => ({ from: index * 4, to: index * 4 + 3 }));
  assert.deepEqual(outsideCheckedPassages(manyHints, manyPassages), manyHints.filter(hint => !manyPassages.some(passage => hint.from >= passage.from && hint.to <= passage.to)));
});

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

test('AI decorations do not alter manuscript and clear when their sentence punctuation changes', () => {
  let state = stateFor([paragraph('She walkd home.')]);
  const hints = inlineGrammarFindings({ findings: [finding()] }, inlineGrammarPassage(state)), before = state.doc.toJSON();
  state = state.apply(state.tr.setMeta(aiGrammarKey, hints));
  assert.deepEqual(state.doc.toJSON(), before); assert.equal(aiGrammarKey.getState(state).decorations.find().length, 1);
  state = state.apply(state.tr.insertText('!', 16));
  assert.equal(aiGrammarKey.getState(state).hints.length, 0);
  assert.throws(() => aiGrammarTransaction(state, hints[0]), /changed/);
});

function publishFinding(state, paragraphIndex = 0, original = 'walkd', replacement = 'walked') {
  const passage = inlineGrammarPassages(state)[paragraphIndex], start = passage.text.indexOf(original);
  const [hint] = inlineGrammarFindings({ findings: [{ ...finding(original, replacement), passageId: passage.id, start, end: start + original.length }] }, passage);
  return { state: state.apply(state.tr.setMeta(aiGrammarKey, [hint])), hint, passage };
}

test('chapter collection checks existing short paragraphs and sentence chunks without moving the selection', () => {
  const long = 'A useful sentence in a long paragraph. '.repeat(180), giant = 'x'.repeat(4100) + '. A short valid sentence.';
  const state = stateFor([paragraph('He go.'), paragraph(long), paragraph(giant), { type: 'codeBlock', content: [{ type: 'text', text: 'She walkd home.' }] }, paragraph('She walkd home.', [{ type: 'trackedChange', attrs: { id: 'pending', kind: 'delete' } }]), { type: 'paragraph', content: [{ type: 'text', text: 'Has a footnote ' }, { type: 'note', attrs: { kind: 'footnote', text: 'Private note body' } }] }]);
  const selection = state.selection, passages = inlineGrammarPassages({ doc: state.doc });
  assert.equal(inlineGrammarPassages({ doc: state.doc }), passages, 'Unchanged chapters reuse their collected passage list');
  assert.equal(passages[0].text, 'He go.'); assert.equal(state.selection, selection);
  assert.equal(passages.filter(passage => passage.paragraph === 2).map(passage => passage.text).join(''), long);
  assert.equal(passages.at(-1).text, 'A short valid sentence.');
  assert.equal(new Set(passages.map(passage => passage.id)).size, passages.length);
  for (const passage of passages) {
    assert.ok(passage.text.length <= 4000); assert.equal(state.doc.textBetween(passage.from, passage.to, '', '\n'), passage.text);
    assert.ok(!passage.text.includes('Private') && !passage.text.includes('walkd'));
  }
});

test('editing another paragraph preserves hints and moving their positions retains their original identity', () => {
  let { state, hint } = publishFinding(stateFor([paragraph('She walkd home.'), paragraph('A quiet morning.')]));
  const untouched = state.tr.insertText('Very ', 18); state = state.apply(untouched);
  assert.equal(aiGrammarKey.getState(state).hints[0], hint, 'Unshifted hint object stays usable by an open review');
  ({ state, hint } = publishFinding(stateFor([paragraph('A quiet morning.'), paragraph('She walkd home.')]), 1));
  const moved = state.tr.insertText('Very ', 1); state = state.apply(moved);
  const next = aiGrammarKey.getState(state).hints[0]; assert.equal(next.id, hint.id); assert.equal(next.from, hint.from + 5);
  assert.equal(next.context.from, hint.context.from + 5); assert.equal(next.context.text, hint.context.text);
  state = state.apply(aiGrammarTransaction(state, next)); assert.match(state.doc.textContent, /She walked home/);
});

test('another sentence can change while a hint stays, but its own subject or word boundary invalidates it', () => {
  const original = publishFinding(stateFor([paragraph('She walkd home. The sun shone.')]));
  const other = original.state.tr.insertText('bright ', 25);
  assert.equal(mapGrammarHint(original.hint, other), original.hint);
  for (const tr of [original.state.tr.insertText('They', 1, 4), original.state.tr.insertText('x', original.hint.from), original.state.tr.insertText('x', original.hint.to), original.state.tr.delete(15, 17)]) {
    assert.equal(mapGrammarHint(original.hint, tr), null, 'Changes to sentence grammar or its boundary must be rechecked');
  }
  const moved = publishFinding(stateFor([paragraph('The sun shone. She walkd home.')]));
  const next = mapGrammarHint(moved.hint, moved.state.tr.insertText('bright ', 5));
  assert.equal(next.from, moved.hint.from + 7); assert.equal(next.context.text, 'She walkd home.');
});

test('new complete sentences can be appended without hiding an earlier hint; extending its sentence invalidates it', () => {
  const complete = publishFinding(stateFor([paragraph('She walkd home.')]));
  assert.equal(mapGrammarHint(complete.hint, complete.state.tr.insertText(' The sun shone.', 16)), complete.hint);
  assert.equal(mapGrammarHint(complete.hint, complete.state.tr.insertText('!', 16)), null);
  const unfinished = publishFinding(stateFor([paragraph('She walkd home')]));
  assert.equal(mapGrammarHint(unfinished.hint, unfinished.state.tr.insertText(' today', 15)), null);
});

test('late findings map through edits but never jump to a duplicate passage after deletion', () => {
  let state = stateFor([paragraph('A quiet morning.'), paragraph('She walkd home.'), paragraph('She walkd home.')]);
  const passage = inlineGrammarPassages(state)[1], input = { findings: [{ ...finding(), passageId: passage.id }] };
  const tr = state.tr.insertText('Very ', 1); state = state.apply(tr);
  const [late] = inlineGrammarFindings(input, passage), mapped = mapGrammarHint(late, tr);
  assert.equal(state.doc.textBetween(mapped.from, mapped.to), 'walkd'); assert.equal(mapped.from, late.from + 5);
  const deletion = state.tr.delete(state.doc.child(0).nodeSize, state.doc.child(0).nodeSize + state.doc.child(1).nodeSize);
  assert.equal(mapGrammarHint(mapped, deletion), null, 'An identical surviving paragraph is a different occurrence');
  assert.equal(mapGrammarHint(mapped, state.tr.insertText('We', mapped.context.from, mapped.context.from + 3)), null);
  assert.notEqual(inlineGrammarFindings(input, passage)[0].id, late.id, 'A fresh finding at a reused position cannot steal a moved finding’s identity');
});

test('sentence context keeps abbreviations and hard line breaks together', () => {
  const title = publishFinding(stateFor([paragraph('Dr. Smith walkd home. The sun shone.')]));
  assert.equal(title.hint.context.text, 'Dr. Smith walkd home.');
  assert.equal(mapGrammarHint(title.hint, title.state.tr.insertText('Mrs.', 1, 4)), null);
  const state = stateFor([{ type: 'paragraph', content: [{ type: 'text', text: 'She' }, { type: 'hardBreak' }, { type: 'text', text: 'walkd home. The sun shone.' }] }]);
  const { hint } = publishFinding(state);
  assert.equal(hint.context.text, 'She\nwalkd home.');
  assert.deepEqual(grammarContext(state.doc, hint.from, hint.to), hint.context);
  assert.equal(mapGrammarHint(hint, state.tr.insertText('They', 1, 4)), null);
});

test('paragraph splits, joins and unsupported nodes discard only grammatically affected hints', () => {
  const original = publishFinding(stateFor([paragraph('She walkd home. The sun shone.')]));
  assert.equal(mapGrammarHint(original.hint, original.state.tr.split(10)), null, 'Splitting its sentence needs another check');
  assert.equal(mapGrammarHint(original.hint, original.state.tr.split(17)), original.hint, 'Splitting after the complete sentence is harmless');
  const fragments = publishFinding(stateFor([paragraph('She walkd'), paragraph('home yesterday.')]));
  assert.equal(mapGrammarHint(fragments.hint, fragments.state.tr.join(fragments.state.doc.child(0).nodeSize)), null);
  assert.equal(mapGrammarHint(original.hint, original.state.tr.setBlockType(1, 1, schema.nodes.codeBlock)), null);
  assert.equal(mapGrammarHint(original.hint, original.state.tr.addMark(original.hint.from, original.hint.to, schema.marks.trackedChange.create({ id: 'new', kind: 'delete' }))), null);
  assert.equal(mapGrammarHint(original.hint, original.state.tr.addMark(original.hint.from, original.hint.to, schema.marks.italic.create())), original.hint, 'Formatting alone does not change grammar');
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

test('many active AI hints map identically through nested blocks, mark-only edits and whole-document replacements', () => {
  const items = Array.from({ length: 100 }, (_, i) => paragraph('She walkd home. The house was quiet ' + i + '.'));
  let state = stateFor([{ type: 'blockquote', content: items.slice(0, 50) }, ...items.slice(50)]);
  const initial = inlineGrammarPassages(state).flatMap(passage =>
    inlineGrammarFindings({ findings: [{ ...finding(), passageId: passage.id }] }, passage));
  state = state.apply(state.tr.setMeta(aiGrammarKey, initial));
  function apply(tr) {
    const expected = aiGrammarKey.getState(state).hints.map(hint => mapGrammarHint(hint, tr)).filter(Boolean);
    state = state.apply(tr);
    const current = aiGrammarKey.getState(state);
    assert.deepEqual(current.hints, expected);
    const marks = current.decorations.find().map(mark => [mark.spec.hint.id, mark.from, mark.to]).sort((a, b) => a[1] - b[1]);
    assert.deepEqual(marks, expected.map(hint => [hint.id, hint.from, hint.to]));
  }
  apply(state.tr.insertText('The wind blew. ', 2));
  const marked = aiGrammarKey.getState(state).hints[38];
  apply(state.tr.addMark(marked.from, marked.to, schema.marks.trackedChange.create({ id: 'pending-correction', kind: 'delete' })));
  assert.equal(aiGrammarKey.getState(state).hints.length, 99);
  const split = aiGrammarKey.getState(state).hints[60];
  apply(state.tr.split(split.from + 1));
  assert.equal(aiGrammarKey.getState(state).hints.length, 98);
  apply(state.tr.replaceWith(0, state.doc.content.size, state.doc.content));
});
