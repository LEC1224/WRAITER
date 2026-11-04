const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInlineRequest, canReserveInline, cancelInline } = require('../electron/inline-grammar.cjs');
const { defaults, validateSettings, mergeSettings } = require('../electron/preferences.cjs');

const request = () => ({ id: 'hint-1', projectId: 'project', scope: 'selection', language: 'en-US', style: 'SECRET VOICE', references: ['SECRET'], passages: [{ id: 'passage-1', chapterTitle: 'SECRET TITLE', paragraph: 42, text: 'A sample sentence.' }] });

test('AI grammar is off by default, validated, and persists through settings merge', () => {
  assert.equal(defaults.aiGrammar, false);
  assert.equal(mergeSettings(defaults, { aiGrammar: true }).aiGrammar, true);
  assert.throws(() => validateSettings({ aiGrammar: 'true' }), /Invalid aiGrammar/);
});

test('inline requests are one bounded passage and discard unrelated context', () => {
  const normalized = validateInlineRequest(request());
  assert.equal(normalized.scope, 'selection'); assert.equal(normalized.style, '');
  assert.equal(normalized.passages[0].chapterTitle, ''); assert.equal(normalized.passages[0].paragraph, 1);
  assert.ok(!JSON.stringify(normalized).includes('SECRET'));
  assert.throws(() => validateInlineRequest({ ...request(), scope: 'chapter' }), /one selected/);
  assert.throws(() => validateInlineRequest({ ...request(), passages: [{ id: 'a', text: 'a'.repeat(4001) }] }), /4,000/);
  assert.throws(() => validateInlineRequest({ ...request(), passages: [request().passages[0], request().passages[0]] }), /one selected/);
});

test('inline reservation never preempts another request, and cancellation is scoped', async () => {
  let resolve, didAbort = false, foregroundAborted = false;
  const finished = new Promise(done => { resolve = done; });
  const inline = { kind: 'inline-grammar', finished, abort() { didAbort = true; resolve(); } };
  const foreground = { kind: 'generate', finished: Promise.resolve(), abort() { foregroundAborted = true; } };
  const requests = new Map();
  assert.equal(canReserveInline(requests, 0), true); assert.equal(canReserveInline(requests, 1), false);
  requests.set('fg', foreground); assert.equal(canReserveInline(requests, 0), false);
  assert.equal(await cancelInline(requests, 'fg'), false); assert.equal(foregroundAborted, false);
  requests.set('hint-1', inline); assert.equal(await cancelInline(requests, 'hint-1'), true); assert.equal(didAbort, true);
  assert.equal(await cancelInline(requests, 'missing'), false);
});
