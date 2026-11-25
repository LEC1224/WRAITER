import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { documentWordCount, updateWordCount } from '../src/word-count.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    hardBreak: { inline: true, group: 'inline' },
    image: { inline: true, group: 'inline', attrs: { src: {} } },
    text: { group: 'inline' }
  }
});
const paragraph = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const state = (...blocks) => EditorState.create({ schema, doc: schema.node('doc', null, blocks) });
function check(before, transaction) {
  assert.equal(updateWordCount(documentWordCount(before.doc), transaction), documentWordCount(transaction.doc));
}

test('incremental word counts stay exact for typing, deleting, splitting and joining blocks', () => {
  let current = state(paragraph('One careful sentence.'), paragraph('A second line.'));
  for (const make of [
    value => value.tr.insertText('ly', 4),
    value => value.tr.insertText(' new words ', 5),
    value => value.tr.delete(2, 8),
    value => value.tr.split(6),
    value => value.tr.join(value.doc.child(0).nodeSize)
  ]) {
    const transaction = make(current); check(current, transaction); current = current.apply(transaction);
  }
});

test('incremental word counts handle multi-step and nested replacements', () => {
  const before = state(paragraph('Alpha beta'), schema.node('blockquote', null, [paragraph('Nested words here')]), paragraph('Omega'));
  const transaction = before.tr.insertText(' bright', 6).insertText(' ending', before.doc.content.size - 1).delete(1, 3);
  check(before, transaction);
});

test('short edits keep exact word counts across Unicode and punctuation boundaries', () => {
  let seed = 0x5eed1234;
  const random = limit => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  const pieces = ['a', 'Å', '猫', '𝔄', '1', '-', "'", '’', ' ', '.', '🐈', '\u0301', 'end'];
  let current = state(paragraph(pieces.join('')));
  let count = documentWordCount(current.doc);
  for (let iteration = 0; iteration < 5000; iteration++) {
    const size = current.doc.firstChild.content.size, from = random(size + 1), to = Math.min(size, from + random(5));
    const replacement = pieces[random(pieces.length)];
    const transaction = current.tr.insertText(replacement, from + 1, to + 1);
    count = updateWordCount(count, transaction); current = current.apply(transaction);
    assert.equal(count, documentWordCount(current.doc), `Mismatch after edit ${iteration}`);
  }
});

test('edits inside a long nested block agree with a complete recount', () => {
  let current = state(paragraph('Before'), schema.node('blockquote', null, [paragraph('One '.repeat(3000)), paragraph('After')]), paragraph('End'));
  const inside = current.doc.child(0).nodeSize + 2;
  for (const make of [
    value => value.tr.insertText("can't ", inside + 20),
    value => value.tr.delete(inside + 19, inside + 24),
    value => value.tr.insertText(' space ', inside + 100),
    value => value.tr.split(inside + 150)
  ]) {
    const transaction = make(current); check(current, transaction); current = current.apply(transaction);
  }
});

test('word counts stay exact when inline breaks and objects are inserted or removed', () => {
  let current = state(schema.node('paragraph', null, [schema.text('alpha'), schema.node('hardBreak'), schema.text('beta'), schema.node('image', { src: 'sample.png' }), schema.text('gamma')]));
  for (const make of [
    value => value.tr.insertText('more', 6),
    value => value.tr.delete(10, 11),
    value => value.tr.insert(3, schema.node('hardBreak')),
    value => value.tr.insert(6, schema.node('image', { src: 'another.png' })),
    value => value.tr.insertText("'", 4)
  ]) {
    const transaction = make(current); check(current, transaction); current = current.apply(transaction);
  }
});

test('mixed inline edits continue to agree with a full recount', () => {
  let seed = 0xbadc0ffe;
  const random = limit => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  const text = ['a', '猫', '𝔄', '🐈', '-', '’', ' ', '.', 'two'];
  let current = state(paragraph('Starting text'));
  let count = documentWordCount(current.doc);
  for (let iteration = 0; iteration < 3000; iteration++) {
    const size = current.doc.firstChild.content.size, from = random(size + 1), choice = random(4);
    let transaction;
    if (choice === 0) transaction = current.tr.insert(from + 1, schema.node('hardBreak'));
    else if (choice === 1) transaction = current.tr.insert(from + 1, schema.node('image', { src: 'sample.png' }));
    else {
      const to = Math.min(size, from + random(4));
      transaction = current.tr.insertText(choice === 2 ? text[random(text.length)] : '', from + 1, to + 1);
    }
    count = updateWordCount(count, transaction); current = current.apply(transaction);
    assert.equal(count, documentWordCount(current.doc), `Mismatch after mixed edit ${iteration}`);
  }
});

test('generated inline edits agree with full recounts in flat and nested paragraphs', () => {
  let seed = 0xa91f0273;
  const random = limit => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % limit; };
  const tokens = ['a', 'Å', '猫', '𝔄', '1', '-', "'", '’', ' ', '.', '🐈', '\u0301', '\u200d', 'words', '\ud83d', '\udc08'];
  const node = choice => choice === 0 ? schema.node('hardBreak') : choice === 1 ? schema.node('image', { src: 'synthetic' }) : schema.text(tokens[random(tokens.length)]);
  for (let iteration = 0; iteration < 60000; iteration++) {
    const content = Array.from({ length: random(24) }, () => node(random(7)));
    const target = schema.node('paragraph', null, content), prefix = paragraph('Before word.'), nested = random(2) === 0;
    const document = nested ? schema.node('doc', null, [prefix, schema.node('blockquote', null, [target, paragraph('Nested after.')]), paragraph('Following.')]) : schema.node('doc', null, [target, paragraph('Following.')]);
    const before = EditorState.create({ schema, doc: document }), offset = nested ? prefix.nodeSize + 2 : 1;
    const start = random(target.content.size + 1), end = Math.min(target.content.size, start + random(7));
    let tr;
    switch (random(4)) {
      case 0: tr = before.tr.insertText(tokens[random(tokens.length)], offset + start, offset + end); break;
      case 1: tr = before.tr.replaceWith(offset + start, offset + end, schema.node('hardBreak')); break;
      case 2: tr = before.tr.replaceWith(offset + start, offset + end, schema.node('image', { src: 'synthetic' })); break;
      default: tr = before.tr.delete(offset + start, offset + end);
    }
    assert.equal(updateWordCount(documentWordCount(document), tr), documentWordCount(tr.doc), `Mismatch at generated edit ${iteration}`);
  }
});
