import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { createImageImportPlugin, imageImportKey, imageMime, transferFiles } from '../src/image-import.js';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {},
  image: { group: 'block', atom: true, attrs: { src: {}, alt: { default: '' } } }
} });
const attrs = name => ({ src: `data:image/png;base64,${name}`, alt: name });
const file = name => ({ name });
const files = (...names) => ({ types: ['Files'], files: names.map(file) });
const event = transfer => ({ dataTransfer: transfer, clipboardData: { ...transfer, getData: () => '' }, clientX: 20, clientY: 20, preventDefault() { this.prevented = true; } });
function fixture(options = {}) {
  const notices = [], attributes = {}, transactions = [];
  const plugin = createImageImportPlugin({ readFile: async file => attrs(file.name), onNotice: text => notices.push(text), ...options });
  const view = {
    editable: true, state: EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('Alpha Omega'))]), plugins: [plugin] }),
    dom: { setAttribute(key, value) { attributes[key] = value; }, removeAttribute(key) { delete attributes[key]; }, contains: () => false, getBoundingClientRect: () => ({ top: 10 }) },
    posAtCoords: () => ({ pos: 6 }), focus() { this.focused = true; },
    dispatch(tr) { transactions.push(tr); this.state = this.state.apply(tr); }
  };
  return { view, plugin, notices, attributes, transactions };
}
const settled = async view => { for (let i = 0; i < 30 && imageImportKey.getState(view.state)?.pending; i++) await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(imageImportKey.getState(view.state).pending, null); };
const images = view => view.state.doc.content.content.filter(node => node.type.name === 'image');

test('recognises supported byte signatures without trusting a filename or MIME type', () => {
  assert.equal(imageMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(imageMime(Uint8Array.from([255, 216, 255])), 'image/jpeg');
  assert.equal(imageMime(new TextEncoder().encode('GIF89a')), 'image/gif');
  assert.equal(imageMime(new TextEncoder().encode('RIFFxxxxWEBP')), 'image/webp');
  assert.equal(imageMime(new TextEncoder().encode('<svg>')), null);
  assert.equal(imageMime(new Uint8Array()), null);
  assert.equal(imageMime(new TextEncoder().encode('not a PNG')), null);
});

test('falls back to clipboard items without importing the same file twice', () => {
  const value = file('one');
  assert.deepEqual(transferFiles({ files: [value], items: [{ kind: 'file', getAsFile: () => value }] }), [value]);
  assert.deepEqual(transferFiles({ items: [{ kind: 'string' }, { kind: 'file', getAsFile: () => value }, { kind: 'file', getAsFile: () => null }] }), [value]);
});

test('drop uses the pointer location, keeps an unrelated selection and imports the batch in file order', async () => {
  const { view, plugin, transactions } = fixture({ readFile: async value => { if (value.name === 'first') await new Promise(resolve => setTimeout(resolve, 5)); return attrs(value.name); } });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)));
  const drop = event(files('first', 'second'));
  assert.equal(plugin.props.handleDrop(view, drop, null, false), true);
  assert.equal(drop.prevented, true);
  await settled(view);
  assert.deepEqual(images(view).map(node => node.attrs.alt), ['first', 'second']);
  assert.equal(view.state.doc.textContent, 'Alpha Omega');
  assert.equal(view.state.doc.child(0).textContent, 'Alpha');
  const changed = transactions.filter(tr => tr.docChanged);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].getMeta('historyLabel'), 'Insert 2 images');
});

test('clipboard image replaces the selected passage in one edit', async () => {
  const { view, plugin, transactions } = fixture();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)));
  const paste = event(files('screenshot'));
  assert.equal(plugin.props.handlePaste(view, paste), true);
  await settled(view);
  assert.equal(view.state.doc.textContent, 'Alpha ');
  assert.equal(images(view).length, 1);
  assert.equal(transactions.filter(tr => tr.docChanged).length, 1);
});

test('normal rich text and internal drag/copy remain with ProseMirror', () => {
  const { view, plugin } = fixture();
  assert.equal(plugin.props.handleDrop(view, event(files('image')), null, true), false);
  view.dragging = { slice: {} };
  assert.equal(plugin.props.handleDrop(view, event(files('image')), null, false), false);
  const paste = event(files('office-preview')); paste.clipboardData.getData = () => 'A rich passage';
  assert.equal(plugin.props.handlePaste(view, paste), false);
  assert.equal(plugin.props.handlePaste(view, event({ files: [] })), false);
});

test('pending imports track edits at the original target and retain a moved caret', async () => {
  let resolve;
  const { view, plugin } = fixture({ readFile: () => new Promise(done => { resolve = done; }) });
  plugin.props.handleDrop(view, event(files('slow')), null, false);
  const typing = view.state.tr.insertText('New ', 1);
  view.dispatch(typing.setSelection(TextSelection.create(typing.doc, 16)));
  resolve(attrs('slow')); await settled(view);
  assert.equal(view.state.doc.child(0).textContent, 'New Alpha');
  assert.equal(view.state.doc.textContent, 'New Alpha Omega');
  assert.equal(view.state.selection.$from.parent.textContent, ' Omega');
  assert.equal(view.state.selection.$from.parentOffset, 6);
});

test('a busy document or a second import cannot start reading files', async () => {
  let reads = 0, resolve;
  const blocked = fixture({ canInsert: () => false, readFile: () => { reads++; } });
  assert.equal(blocked.plugin.props.handleDrop(blocked.view, event(files('one')), null, false), true);
  await settled(blocked.view); assert.equal(reads, 0); assert.match(blocked.notices.at(-1), /Finish the current operation/);
  const ready = fixture({ readFile: () => { reads++; return new Promise(done => { resolve = done; }); } });
  ready.plugin.props.handleDrop(ready.view, event(files('one')), null, false);
  ready.plugin.props.handleDrop(ready.view, event(files('two')), null, false);
  assert.equal(reads, 1); assert.match(ready.notices.at(-1), /already in progress/);
  resolve(attrs('one')); await settled(ready.view); assert.equal(images(ready.view).length, 1);
});

test('read failures produce feedback and valid files in a mixed batch still import', async () => {
  const { view, plugin, notices } = fixture({ readFile: async value => { if (value.name === 'broken') throw new Error('broken could not be read.'); return attrs(value.name); } });
  plugin.props.handleDrop(view, event(files('good', 'broken')), null, false); await settled(view);
  assert.equal(images(view).length, 1); assert.match(notices.at(-1), /broken could not be read/);
  const previous = view.state.doc;
  plugin.props.handleDrop(view, event(files('broken')), null, false); await settled(view);
  assert.equal(view.state.doc, previous); assert.equal(notices.at(-1), 'broken could not be read.');
});

test('imports finishing after the document becomes busy do not edit it', async () => {
  let resolve, allowed = true;
  const { view, plugin, notices } = fixture({ canInsert: () => allowed, readFile: () => new Promise(done => { resolve = done; }) });
  plugin.props.handleDrop(view, event(files('one')), null, false); allowed = false;
  resolve(attrs('one')); await settled(view);
  assert.equal(images(view).length, 0); assert.match(notices.at(-1), /document is busy/);
});

test('leaving a chapter cancels the pending import without editing a destroyed view', async () => {
  let resolve;
  const { view, plugin, notices, transactions } = fixture({ readFile: () => new Promise(done => { resolve = done; }) });
  plugin.props.handleDrop(view, event(files('one')), null, false);
  plugin.spec.view(view).destroy(); const count = transactions.length;
  resolve(attrs('one')); await new Promise(done => setTimeout(done, 0));
  assert.equal(transactions.length, count); assert.equal(images(view).length, 0); assert.match(notices.at(-1), /cancelled because you left this chapter/);
});

test('picker cancellation and errors clear progress without changing the manuscript', async () => {
  const { view, plugin, notices } = fixture(); const previous = view.state.doc;
  assert.equal(await plugin.spec.pick(view, async () => null), false);
  assert.equal(imageImportKey.getState(view.state).pending, null); assert.equal(view.state.doc, previous);
  assert.equal(await plugin.spec.pick(view, async () => { throw new Error('Picker unavailable'); }), false);
  assert.equal(imageImportKey.getState(view.state).pending, null); assert.equal(notices.at(-1), 'Picker unavailable');
});

test('file hover is visible and cleared on leave or drop, including page margins', async () => {
  const { view, plugin, attributes } = fixture(); const hover = event(files('one'));
  plugin.props.handleDOMEvents.dragover(view, hover);
  assert.equal(attributes['data-image-drop'], 'ready'); assert.equal(hover.dataTransfer.dropEffect, 'copy'); assert.equal(hover.prevented, true);
  plugin.props.handleDOMEvents.dragleave(view, { relatedTarget: null }); assert.equal(attributes['data-image-drop'], undefined);
  view.posAtCoords = () => null;
  plugin.props.handleDrop(view, { ...event(files('one')), clientY: 100 }, null, false); await settled(view);
  assert.equal(view.state.doc.lastChild.type.name, 'image');
});
