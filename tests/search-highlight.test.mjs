import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { SearchHighlight, searchKey } from '../src/extensions.js';
import { findTextMatches } from '../src/search.js';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
function create(text = 'River river rivers RIVER.') {
  const plugin = SearchHighlight.config.addProseMirrorPlugins.call(SearchHighlight)[0];
  const doc = schema.node('doc', null, schema.node('paragraph', null, schema.text(text)));
  return { plugin, state: EditorState.create({ schema, doc, plugins: [plugin] }) };
}
const ranges = decorations => decorations?.find().map(({ from, to }) => ({ from, to })) || [];

test('search highlights reuse the unchanged chapter when the cursor or unrelated metadata changes', () => {
  let { plugin, state } = create();
  state = state.apply(state.tr.setMeta(searchKey, { query: 'river' }));
  const first = plugin.props.decorations(state);
  assert.deepEqual(ranges(first), findTextMatches(state.doc, 'river'));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8)));
  assert.equal(plugin.props.decorations(state), first);
  state = state.apply(state.tr.setMeta('toolbar', true));
  assert.equal(plugin.props.decorations(state), first);
  state = state.apply(state.tr.setMeta(searchKey, { query: 'river', caseSensitive: false, wholeWord: false }));
  assert.equal(plugin.props.decorations(state), first, 'equivalent options do not restart a search');
});

test('search highlights update for typing, deletion and fresh matches in the same chapter', () => {
  let { plugin, state } = create('river and another passage.');
  state = state.apply(state.tr.setMeta(searchKey, { query: 'river' }));
  const first = plugin.props.decorations(state);
  state = state.apply(state.tr.insertText('New river ', 1));
  assert.notEqual(plugin.props.decorations(state), first);
  assert.deepEqual(ranges(plugin.props.decorations(state)), findTextMatches(state.doc, 'river'));
  assert.equal(ranges(plugin.props.decorations(state)).length, 2);
  state = state.apply(state.tr.delete(1, 16));
  assert.deepEqual(ranges(plugin.props.decorations(state)), []);
});

test('search highlight options and clearing Find never retain stale matches', () => {
  let { plugin, state } = create();
  state = state.apply(state.tr.setMeta(searchKey, 'river'));
  assert.equal(ranges(plugin.props.decorations(state)).length, 4, 'legacy string queries still work');
  for (const options of [
    { query: 'river', wholeWord: true },
    { query: 'river', wholeWord: true, caseSensitive: true },
    { query: 'rivers', caseSensitive: true }
  ]) {
    state = state.apply(state.tr.setMeta(searchKey, options));
    assert.deepEqual(ranges(plugin.props.decorations(state)), findTextMatches(state.doc, options.query, 2000, options));
  }
  state = state.apply(state.tr.setMeta(searchKey, { query: '' }));
  assert.equal(plugin.props.decorations(state), null);
  state = state.apply(state.tr.insertText('River ', 1).setMeta(searchKey, { query: 'River', caseSensitive: true }));
  assert.equal(ranges(plugin.props.decorations(state)).length, 2);
});

test('search highlight caches belong to their editor and respect the highlight limit', () => {
  const first = create('river river'), second = create('quiet hours');
  const firstState = first.state.apply(first.state.tr.setMeta(searchKey, { query: 'river' }));
  const secondState = second.state.apply(second.state.tr.setMeta(searchKey, { query: 'quiet' }));
  assert.equal(ranges(first.plugin.props.decorations(firstState)).length, 2);
  assert.equal(ranges(second.plugin.props.decorations(secondState)).length, 1);
  assert.equal(ranges(first.plugin.props.decorations(firstState)).length, 2);
  const many = create('river '.repeat(2001));
  const manyState = many.state.apply(many.state.tr.setMeta(searchKey, { query: 'river' }));
  assert.equal(ranges(many.plugin.props.decorations(manyState)).length, 2000);
});
