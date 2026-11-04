const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, mergeSettings, validateSettings } = require('../electron/preferences.cjs');
test('hidden models persist by connection without changing assigned models', () => {
  const prefs = mergeSettings({ ...defaults, taskProfiles: { continue: { model: 'old-model' } } }, { hiddenModels: { 'ollama|http://localhost:11434||': ['old-model', 'old-model'], 'compatible|https://example.test||': ['other'] } });
  assert.equal(prefs.taskProfiles.continue.model, 'old-model');
  assert.deepEqual(prefs.hiddenModels['ollama|http://localhost:11434||'], ['old-model']);
  assert.deepEqual(mergeSettings(prefs, { theme: 'dark' }).hiddenModels, prefs.hiddenModels);
  assert.deepEqual(mergeSettings(prefs, { hiddenModels: {} }).hiddenModels, {});
});
test('hidden model preferences reject malformed lists', () => {
  for (const hiddenModels of [[], null, { key: 'model' }, { key: [null] }, { key: [''] }, { key: Array(2001).fill('model') }]) {
    assert.throws(() => validateSettings({ hiddenModels }), /hidden model/);
  }
});
