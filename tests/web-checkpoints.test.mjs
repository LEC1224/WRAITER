import assert from 'node:assert/strict';
import test from 'node:test';
import { newProject, paragraph, snapshot } from '../src/document.js';
import { browserHistory, browserMerge, checkoutCheckpoint, readCheckpoint, saveCheckpoint } from '../src/web/checkpoints.js';
import { mergeDrafts } from '../src/branch-merge.js';

test('legacy snapshots open in the map, and a restored branch can be merged after reload', () => {
  const draft = newProject();
  draft.chapters[0].content.content = [paragraph('Mara opens the gate.')];
  const base = snapshot(draft, 'At the gate');
  const fork = saveCheckpoint({ ...draft, notes: 'Bring an umbrella.', snapshots: [base] }, 'Prepare for travel');
  const source = browserHistory(fork).headRevision;
  const restored = checkoutCheckpoint(fork, base.id);
  const current = saveCheckpoint({ ...readCheckpoint(restored, base.id), subtitle: 'An autumn story' }, 'Set subtitle');
  const resumed = JSON.parse(JSON.stringify(current));
  const head = browserHistory(resumed).headRevision;
  const context = browserMerge(resumed, source);
  assert.equal(context.base.chapters[0].id, draft.chapters[0].id);
  assert.equal(context.source.notes, 'Bring an umbrella.');
  const merged = mergeDrafts(context.base, resumed, context.source);
  assert.equal(merged.conflicts.length, 0);
  const committed = saveCheckpoint(merged.project, 'Merge travel notes', source);
  const history = browserHistory(committed);
  assert.deepEqual(history.entries[0].parentRevisions, [head, source]);
  assert.equal(readCheckpoint(committed, history.headRevision).subtitle, 'An autumn story');
  assert.equal(readCheckpoint(committed, history.headRevision).notes, 'Bring an umbrella.');
  assert.throws(() => browserMerge(committed, source), /already part/);
});

test('creating a safety checkpoint keeps the requested restore target at the snapshot limit', () => {
  let draft = newProject();
  for (let i = 0; i < 20; i++) draft = saveCheckpoint(draft, `Saved version ${i + 1}`);
  const target = draft.snapshots[0].id;
  draft = saveCheckpoint(draft, 'Before restoring a version', null, target);
  assert.equal(draft.snapshots.length, 20);
  assert.equal(browserHistory(checkoutCheckpoint(draft, target)).headRevision, target);
});
