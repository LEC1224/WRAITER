const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeCheckpoint, checkpointChanges } = require('../electron/checkpoint-summary.cjs');
const { defaults, mergeSettings, resolveTask } = require('../electron/preferences.cjs');

function manuscript(text = 'The first sentence.', chapters = []) {
  return { format: 'wraiter', version: 1, id: 'checkpoint-test', title: 'A story', chapters: [
    { id: 'opening', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } },
    ...chapters
  ], references: [], notes: '', snapshots: [] };
}

test('checkpoint model is selected independently from writing models', () => {
  const settings = mergeSettings(defaults, { taskProfiles: { continue: { provider: 'codex', model: 'writing-model' }, checkpoint: { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'summary-model' } } });
  assert.equal(resolveTask(settings, 'continue').model, 'writing-model');
  assert.equal(resolveTask(settings, 'checkpoint').model, 'summary-model');
  assert.equal(resolveTask(settings, 'checkpoint').provider, 'ollama');
});

test('checkpoint summaries use changed excerpts and preserve verified chapter navigation', async () => {
  const unchanged = 'A scene already written. '.repeat(5000);
  const before = manuscript(unchanged);
  const after = manuscript(`${unchanged} A silver fox entered the orchard.`);
  let supplied;
  const result = await summarizeCheckpoint({ before, after }, {}, '', {
    generateCheckpoint: async (_settings, _key, prompt) => {
      supplied = prompt;
      return JSON.stringify({ title: 'Introduced a silver fox', summary: 'Added a fox entering the orchard in Opening.', location: 'Wrong chapter', chapterId: 'wrong' });
    }
  });
  assert.equal(result.title, 'Introduced a silver fox');
  assert.equal(result.location, 'Opening');
  assert.equal(result.chapterId, 'opening');
  assert.equal(result.ai, true);
  assert.match(supplied.user, /silver fox entered the orchard/);
  assert.ok(supplied.user.length < 10000, 'the complete unchanged chapter must not be sent to the model');
});

test('failed or malformed AI replies leave a factual checkpoint label', async () => {
  const before = manuscript(), after = manuscript('The first sentence. A new line.');
  const failure = await summarizeCheckpoint({ before, after }, {}, '', { generateCheckpoint: async () => { throw new Error('offline'); } });
  assert.equal(failure.title, 'Added writing in Opening');
  assert.equal(failure.ai, false);
  const malformed = await summarizeCheckpoint({ before, after }, {}, '', { generateCheckpoint: async () => 'not JSON' });
  assert.deepEqual(malformed, failure);
});

test('chapter creation is located and manuscript identity is checked', () => {
  const before = manuscript();
  const after = manuscript('The first sentence.', [{ id: 'four', title: 'Chapter 4', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A new beginning.' }] }] } }]);
  const details = checkpointChanges(before, after);
  assert.equal(details.fallback.title, 'Created Chapter 4');
  assert.equal(details.fallback.chapterId, 'four');
  assert.throws(() => checkpointChanges({ ...before, id: 'another' }, after), /different manuscripts/);
});
