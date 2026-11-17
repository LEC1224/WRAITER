import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@tiptap/pm/state';
import { canJoin, canSplit } from '@tiptap/pm/transform';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { FormattingMarks, formattingMarksKey } from '../src/extensions.js';

const paragraph = text => schema.node('paragraph', null, text ? schema.text(text) : null);
const create = blocks => EditorState.create({ schema, doc: schema.node('doc', null, blocks), plugins: FormattingMarks.config.addProseMirrorPlugins() });
const enable = state => state.apply(state.tr.setMeta(formattingMarksKey, true));
const visibleMarks = state => formattingMarksKey.get(state).props.decorations(state);

function verify(state) {
  const expected = [];
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const end = pos + node.nodeSize - 1;
      expected.push([end, end, 'paragraph']);
    } else if (node.isText) {
      for (let index = 0; index < node.text.length; index++) {
        const kind = { ' ': 'format-mark-space', '\t': 'format-mark-tab' }[node.text[index]];
        if (kind) expected.push([pos + index, pos + index + 1, kind]);
      }
    }
  });
  const found = visibleMarks(state).find().map(mark =>
    [mark.from, mark.to, mark.from === mark.to ? 'paragraph' : mark.type.attrs.class]);
  const order = (a, b) => a[0] - b[0] || a[1] - b[1];
  assert.deepEqual(found.sort(order), expected.sort(order));
}

test('formatting marks follow whitespace replacements, block boundaries, wrapping and compound edits', () => {
  let state = create([paragraph('A B'), paragraph(''), schema.node('blockquote', null, [paragraph('  C\tD')]), paragraph('E F')]);
  assert.equal(visibleMarks(state), null);
  state = enable(state);
  const apply = tr => { state = state.apply(tr); verify(state); };
  const clean = visibleMarks(state);
  apply(state.tr.setMeta('background', true));
  assert.equal(visibleMarks(state), clean);
  const first = clean.forChild(0, state.doc.firstChild);
  apply(state.tr.insertText('tail', state.doc.content.size - 1));
  assert.equal(visibleMarks(state).forChild(0, state.doc.firstChild), first, 'Editing another block retains the first paragraph’s decorations');
  apply(state.tr.insertText('XYZ', 2, 3));
  apply(state.tr.insertText(' ', 3, 4));
  apply(state.tr.split(3));
  apply(state.tr.join(state.doc.firstChild.nodeSize));
  apply(state.tr.addMark(1, 4, schema.marks.bold.create()));
  apply(state.tr.insertText(' \t', 1).insertText('  ', state.doc.content.size));
  apply(state.tr.replaceWith(0, state.doc.firstChild.nodeSize, schema.node('bulletList', null,
    [schema.node('listItem', null, [paragraph('\tOne'), paragraph(' Two ')])])));
  apply(state.tr.replaceWith(0, state.doc.content.size, [paragraph(''), paragraph(' New ')]));
  apply(state.tr.delete(0, state.doc.firstChild.nodeSize));
  state = state.apply(state.tr.setMeta(formattingMarksKey, false));
  assert.equal(visibleMarks(state), null);
  state = state.apply(state.tr.insertText('\t', 1));
  assert.equal(visibleMarks(state), null);
  verify(enable(state));
});

test('incremental formatting marks match a full character scan through generated paragraph edits', () => {
  let state = enable(create([paragraph('One two'), paragraph(''), paragraph('\tThree four')]));
  let seed = 17;
  const random = limit => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  for (let edit = 0; edit < 800; edit++) {
    const blocks = [];
    state.doc.forEach((node, pos) => blocks.push({ node, pos }));
    const { node, pos } = blocks[random(blocks.length)];
    const at = pos + 1 + random(node.content.size + 1);
    const end = at + random(pos + node.nodeSize - at);
    const tr = state.tr;
    switch (random(7)) {
      case 0: if (canSplit(tr.doc, at)) tr.split(at); break;
      case 1: if (canJoin(tr.doc, pos)) tr.join(pos); break;
      case 2: tr.insert(pos, paragraph(' new\t')); break;
      case 3: if (blocks.length > 1) tr.delete(pos, pos + node.nodeSize); break;
      case 4: tr.insertText('', at, end); break;
      case 5: tr.addMark(at, end, schema.marks.italic.create()); break;
      default: tr.insertText([' a ', '\t', 'ab', '  ', '🌳'][random(5)], at, end); break;
    }
    state = state.apply(tr);
    verify(state);
  }
});
