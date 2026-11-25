import test from 'node:test';
import assert from 'node:assert/strict';
import { historyStatus, timelinePage, timelineEntries } from '../src/history.js';

const step = text => ({ stepType: 'replace', slice: { content: [{ type: 'text', text }] } });
function entry(id, groupId, index) {
  return { id, kind: 'steps', groupId, timestamp: `2026-11-01T12:00:0${index}Z`, label: 'Type text', summary: id,
    forward: [step(id)], inverse: [step(`undo-${id}`)], beforeFingerprint: `before${id}`, afterFingerprint: `after${id}`,
    beforeDocFingerprint: `doc-before${id}`, afterDocFingerprint: `doc-after${id}`, selectionAfter: { anchor: index, head: index } };
}

test('history pages include whole groups with their correct branch status and matching counts', () => {
  const entries = ['a','b','c','d','e','f','g','h'].map((id, i) => entry(id, i < 4 ? 'first' : 'second', i));
  const journal = { entries, activeIds: ['a','b','e','f','g','h'], cursor: 4, sequence: 11 };
  const newest = timelinePage(journal, 1);
  assert.equal(newest.total, 4);
  assert.deepEqual(newest.rows.map(row => [row.id, row.summary, row.editCount, row.status]), [['g','gh',2,'undone']]);
  const all = timelinePage(journal, 10);
  assert.deepEqual(all.rows.map(row => [row.id,row.status,row.current]), [['g','undone',false],['e','applied',true],['c','branched',false],['a','applied',false]]);
  assert.deepEqual(all.rows[1].inverse, [step('undo-f'), step('undo-e')]);
  assert.equal(all.rows[1].afterFingerprint, 'afterf'); assert.equal(all.rows[1].beforeDocFingerprint, 'doc-beforee');
  assert.deepEqual(all.rows[1].selectionAfter, entries[5].selectionAfter);
  assert.equal(historyStatus(journal).totalEdits, all.total);
  const match = timelinePage(journal, 1, row => row.status === 'applied');
  assert.equal(match.total, 2); assert.deepEqual(match.rows, [all.rows[1]]);
  assert.equal(timelinePage(journal, 5, row => row.id === 'a').rows[0].summary, 'ab');
  assert.deepEqual(timelineEntries(journal), all.rows);
  newest.rows[0].forward.pop(); assert.equal(timelinePage(journal, 1).rows[0].forward.length, 2);
});
