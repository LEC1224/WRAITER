import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { appendedDuringRequest, shortcutFromEvent, shortcutConflicts, DEFAULT_HOTKEYS } from '../src/hotkeys.js';
import { GhostText, ghostKey } from '../src/extensions.js';
import { revisionTransaction } from '../src/revisions.js';
const require = createRequire(import.meta.url);
const { buildPrompt, validateRequest } = require('../electron/core.cjs');
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' }, hardBreak: { group: 'inline', inline: true } }, marks: { bold: {}, italic: {} } });
const text = (value, mark) => schema.text(value, mark ? [schema.marks[mark].create()] : []);
const para = (...nodes) => schema.node('paragraph', null, nodes);
function editorFor(...paragraphs) {
  return { isDestroyed: false, state: EditorState.create({ doc: schema.node('doc', null, paragraphs), plugins: [...GhostText.config.addProseMirrorPlugins.call(GhostText), history()] }) };
}
function requestAt(editor, from) {
  editor.state = editor.state.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from)));
  return { mode: 'continue', from, originalNode: editor.state.doc };
}
function apply(editor, transaction) { editor.state = editor.state.apply(transaction); }

test('pending completion accepts only a pure insertion at its original cursor, keeping suffix and formatting intact', () => {
  const editor = editorFor(para(text('Before. '), text('Suffix', 'bold')));
  const request = requestAt(editor, 9);
  assert.equal(appendedDuringRequest(request, editor), '');
  const tr = editor.state.tr.insertText('A new thought. ', 9);
  tr.setSelection(TextSelection.create(tr.doc, 24)); apply(editor, tr);
  assert.equal(appendedDuringRequest(request, editor), 'A new thought. ');
  assert.equal(editor.state.doc.textContent, 'Before. A new thought. Suffix');
  assert.equal(editor.state.doc.lastChild.lastChild.marks[0].type.name, 'bold');
});

test('pending completion is invalidated by edits elsewhere even if the cursor and nearby text look unchanged', () => {
  for (const change of ['earlier', 'suffix', 'formatting']) {
    const editor = editorFor(para(text('Before. Suffix'))); const request = requestAt(editor, 9);
    let tr = editor.state.tr;
    if (change === 'earlier') tr.insertText('X', 1, 2);
    else if (change === 'suffix') tr.insertText('X', 9, 10);
    else tr.addMark(1, 2, schema.marks.italic.create());
    tr.setSelection(TextSelection.create(tr.doc, 9)); apply(editor, tr);
    assert.equal(appendedDuringRequest(request, editor), null, change);
  }
});

test('pending completion rejects cursor navigation, selected ranges, revisions, and destroyed editors', () => {
  const editor = editorFor(para(text('Before. Suffix'))); const request = requestAt(editor, 9);
  apply(editor, editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 10)));
  assert.equal(appendedDuringRequest(request, editor), null);
  apply(editor, editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8)));
  assert.equal(appendedDuringRequest(request, editor), null);
  apply(editor, editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 9, 10)));
  assert.equal(appendedDuringRequest(request, editor), null);
  assert.equal(appendedDuringRequest({ ...request, mode: 'rewrite' }, editor), null);
  editor.isDestroyed = true; assert.equal(appendedDuringRequest(request, editor), null);
});

test('a paragraph inserted during generation is represented as a newline without confusing document positions', () => {
  const editor = editorFor(para(text('Before after'))); const request = requestAt(editor, 7);
  const tr = editor.state.tr.split(7); tr.setSelection(TextSelection.create(tr.doc, 9)); apply(editor, tr);
  assert.equal(appendedDuringRequest(request, editor), '\n');
  assert.equal(editor.state.doc.childCount, 2);
});

test('loading indicators and revision previews never enter the manuscript or undo history', () => {
  const editor = editorFor(para(text('Original words.'))); const original = editor.state.doc;
  apply(editor, editor.state.tr.setMeta(ghostKey, { kind: 'loading', pos: 4 }));
  assert.ok(editor.state.doc.eq(original)); assert.equal(ghostKey.getState(editor.state).kind, 'loading');
  apply(editor, editor.state.tr.setMeta(ghostKey, { kind: 'revision', pos: 9, from: 1, to: 9, text: 'Replacement' }));
  assert.ok(editor.state.doc.eq(original)); assert.equal(undo(editor.state), false);
  apply(editor, editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
  assert.equal(ghostKey.getState(editor.state), null); assert.ok(editor.state.doc.eq(original));
});

test('typing after a revision preview preserves the selected original and collapses the caret after new input', () => {
  const editor = editorFor(para(text('Before. '), text('rädd', 'italic'), text(' After.')));
  const from = 9, to = 13;
  apply(editor, editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)).setMeta(ghostKey, { kind: 'revision', pos: to, from, to, text: 'afraid' }));
  apply(editor, editor.state.tr.insertText('!', to, to).setMeta(ghostKey, null));
  assert.equal(editor.state.doc.textContent, 'Before. rädd! After.');
  assert.equal(editor.state.selection.empty, true); assert.equal(editor.state.selection.from, to + 1);
  apply(editor, editor.state.tr.insertText('?'));
  assert.equal(editor.state.doc.textContent, 'Before. rädd!? After.');
});

test('accepting a translated selected word retains its style and all surrounding text and undoes atomically', () => {
  const editor = editorFor(para(text('Before. ', 'bold'), text('rädd', 'italic'), text(' After.')));
  const original = editor.state.doc;
  apply(editor, revisionTransaction(editor.state, 9, 13, 'afraid'));
  assert.equal(editor.state.doc.textContent, 'Before. afraid After.');
  assert.equal(editor.state.doc.child(0).child(0).marks[0].type.name, 'bold');
  assert.equal(editor.state.doc.child(0).child(1).marks[0].type.name, 'italic');
  assert.equal(undo(editor.state, transaction => apply(editor, transaction)), true);
  assert.ok(editor.state.doc.eq(original));
});

test('shortcut capture ignores IME composition and bare modifiers; only shared Tab actions may overlap', () => {
  for (const key of ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'Dead', 'Process']) assert.equal(shortcutFromEvent({ key }), '');
  assert.equal(shortcutFromEvent({ key: 'a', isComposing: true }), '');
  assert.equal(shortcutFromEvent({ key: 'ArrowRight', ctrlKey: true }), 'Ctrl+ArrowRight');
  assert.equal(shortcutFromEvent({ key: ' ', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Space');
  assert.deepEqual(shortcutConflicts(DEFAULT_HOTKEYS), []);
  assert.ok(shortcutConflicts({ ...DEFAULT_HOTKEYS, rewrite: 'Tab' }).length);
  assert.deepEqual(shortcutConflicts({ ...DEFAULT_HOTKEYS, correct: '', rewrite: '' }), []);
});

test('selection prompts separate native translation, bracketed editing instructions, and bounded nearby context', () => {
  const before = Array.from({ length: 25 }, (_, index) => `before${index}`).join(' ');
  const after = Array.from({ length: 25 }, (_, index) => `after${index}`).join(' ');
  const prompt = buildPrompt({ mode: 'rewrite', before, after, selection: 'rädd [keep it natural]', language: 'en-GB', nativeLanguage: 'sv', instruction: '' });
  assert.match(prompt.user, /native language is sv/); assert.match(prompt.user, /translate ONLY that selected text naturally into en-GB/);
  assert.match(prompt.user, /SELECTED TEXT:\n[r]ädd\n/); assert.match(prompt.user, /bracketed editing instructions: keep it natural/);
  assert.match(prompt.user, /before15/); assert.doesNotMatch(prompt.user, /before14\b/);
  assert.match(prompt.user, /after9\b/); assert.doesNotMatch(prompt.user, /after10\b/);
});

test('continuation keeps its opening and recent words, excludes later text, and limits rejected alternatives', () => {
  const before = Array.from({ length: 500 }, (_, index) => `word${index}`).join(' ');
  const prompt = buildPrompt({ mode: 'continue', before, after: 'FORBIDDEN_AFTER', selection: 'FORBIDDEN_SELECTION', words: 80, contextWords: 100, language: 'en-GB', history: ['REJECT_OLD', 'REJECT_ONE', 'REJECT_TWO', 'REJECT_THREE'] });
  assert.match(prompt.user, /word0\b/); assert.match(prompt.user, /word499\b/); assert.doesNotMatch(prompt.user, /word200\b/);
  assert.doesNotMatch(prompt.user, /FORBIDDEN_AFTER|FORBIDDEN_SELECTION|REJECT_OLD/);
  assert.match(prompt.user, /REJECT_ONE[\s\S]*REJECT_TWO[\s\S]*REJECT_THREE/); assert.match(prompt.user, /never exceed 80 words/);
  const normalized = validateRequest({ id: 'synthetic', mode: 'continue', words: 10000, contextWords: 100000 });
  assert.equal(normalized.words, 500); assert.equal(normalized.contextWords, 16000);
});
