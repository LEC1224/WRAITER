import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@tiptap/pm/state';
import { editorialSchema as schema } from '../electron/editor-schema.mjs';
import { checkpointEvents, createHistory, recordProjectChange, recordTransaction } from '../src/history.js';

test('inspect individual characters after a fork and reject unrelated journal sequences', () => {
  const content = schema.node('doc', null, [schema.node('paragraph')]).toJSON();
  const first = { id: 'book', chapters: [{ id: 'opening', content }], historySequence: 1 };
  let project = first, journal = createHistory(first);
  function type(char) {
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(project.chapters[0].content) });
    const transaction = state.tr.insertText(char, state.doc.content.size - 1);
    const next = { ...project, chapters: [{ id: 'opening', content: transaction.doc.toJSON() }], historySequence: journal.sequence + 1 };
    journal = recordTransaction(journal, { chapterId: 'opening', transaction, beforeProject: project, afterProject: next });
    project = next;
  }
  type('x');
  journal = recordProjectChange(journal, project, first, { label: 'Restore checkpoint abcdef12' }); project = first;
  type('y'); type('z');
  const events = checkpointEvents(journal, first, project, 'abcdef123456');
  assert.deepEqual(events.map(row => row.entry.forward[0].slice.content[0].text), ['z', 'y']);
  assert.equal(checkpointEvents(journal, first, { ...project, historySequence: 2 }, 'abcdef123456'), null);
});
