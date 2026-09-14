import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tutorialProject, TUTORIAL_OPENING, newTutorialSession, tutorialEvent } from '../src/tutorial.js';
const require = createRequire(import.meta.url);
const { validateTutorial } = require('../electron/tutorial-state.cjs');
const { validateProject } = require('../electron/core.cjs');
test('tutorial creates a separate short manuscript with inert sample references and exact opening', () => {
  const first = tutorialProject(), second = tutorialProject();
  assert.notEqual(first.id, second.id); assert.equal(first.chapters.length, 1); assert.ok(validateProject(first));
  assert.ok(first.references.every(item => !item.sourcePath));
  assert.equal(TUTORIAL_OPENING, "There was once a software called Wraiter, that was used to integrate AI in authors' workflows. One day");
});
test('tutorial progress depends on completed operations in its own document', () => {
  const session = { ...newTutorialSession('tab', 'practice', 'original'), step: 'complete' };
  assert.equal(tutorialEvent(session, { type: 'suggestion', mode: 'continue', projectId: 'original' }), session);
  assert.equal(tutorialEvent(session, { type: 'requested', mode: 'continue', projectId: 'practice' }), session);
  const preview = tutorialEvent(session, { type: 'suggestion', mode: 'continue', projectId: 'practice' }); assert.equal(preview.step, 'preview');
  const word = tutorialEvent(preview, { type: 'accepted', mode: 'continue', part: 'word', projectId: 'practice' }); assert.equal(word.step, 'preview'); assert.equal(word.flags.word, true);
  const dismissed = tutorialEvent(word, { type: 'dismissed', projectId: 'practice' }); assert.equal(dismissed.step, 'preview');
  const accepted = tutorialEvent(dismissed, { type: 'accepted', mode: 'continue', part: 'all', projectId: 'practice' }); assert.equal(accepted.step, 'practice');
  const paused = { ...session, paused: true }; assert.equal(tutorialEvent(paused, { type: 'suggestion', mode: 'continue', projectId: 'practice' }), paused);
});
test('undo lesson requires an actual undo before redo, progress contains no document text', () => {
  const session = { ...newTutorialSession('tab', 'practice', 'original'), step: 'undo' };
  assert.equal(tutorialEvent(session, { type: 'redo', projectId: 'practice' }), session);
  const undone = tutorialEvent(session, { type: 'undo', projectId: 'practice' });
  const redone = tutorialEvent(undone, { type: 'redo', projectId: 'practice' }); assert.equal(redone.flags.redone, true);
  assert.deepEqual(validateTutorial(redone), redone);
  assert.throws(() => validateTutorial({ ...redone, step: 'unknown' }));
  assert.throws(() => validateTutorial({ ...redone, flags: { prose: 'private text' } }));
  assert.equal(validateTutorial(null), null);
});
