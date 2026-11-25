const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInlineRequest, runInlineProofread, canReserveInline, cancelInline } = require('../electron/inline-grammar.cjs');
const { defaults, validateSettings, mergeSettings } = require('../electron/preferences.cjs');

const request = () => ({ id: 'hint-1', projectId: 'project', scope: 'selection', language: 'en-US', style: 'SECRET VOICE', references: ['SECRET'], passages: [{ id: 'passage-1', chapterTitle: 'SECRET TITLE', paragraph: 42, text: 'A sample sentence.' }] });

test('AI grammar is off by default, validated, and persists through settings merge', () => {
  assert.equal(defaults.aiGrammar, false);
  assert.equal(defaults.localGrammar, true);
  assert.equal(mergeSettings(defaults, { localGrammar: false }).localGrammar, false, 'An explicit local-grammar opt-out is preserved');
  assert.equal(mergeSettings(defaults, { aiGrammar: true }).aiGrammar, true);
  assert.throws(() => validateSettings({ aiGrammar: 'true' }), /Invalid aiGrammar/);
});

test('inline requests batch bounded passages and discard unrelated context from each one', () => {
  const normalized = validateInlineRequest(request());
  assert.equal(normalized.scope, 'selection'); assert.equal(normalized.style, '');
  assert.equal(normalized.passages[0].chapterTitle, ''); assert.equal(normalized.passages[0].paragraph, 1);
  assert.ok(!JSON.stringify(normalized).includes('SECRET'));
  const batch = { ...request(), passages: Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, text: 'word '.repeat(400), chapterTitle: 'SECRET', paragraph: 42, notes: 'SECRET' })) };
  assert.equal(validateInlineRequest(batch).passages.length, 6);
  assert.equal(validateInlineRequest(batch).passages[5].paragraph, 6);
  assert.ok(!JSON.stringify(validateInlineRequest(batch)).includes('SECRET'));
  assert.throws(() => validateInlineRequest({ ...request(), scope: 'chapter' }), /one and six/);
  assert.throws(() => validateInlineRequest({ ...request(), passages: [] }), /one and six/);
  assert.throws(() => validateInlineRequest({ ...batch, passages: [...batch.passages, { id: 'extra', text: 'a' }] }), /one and six/);
  assert.throws(() => validateInlineRequest({ ...batch, passages: batch.passages.map(p => ({ ...p, text: p.text + 'x' })) }), /12,000/);
  assert.throws(() => validateInlineRequest({ ...request(), passages: [{ id: 'a', text: 'a'.repeat(4001) }] }), /4,000/);
  assert.throws(() => validateInlineRequest({ ...request(), passages: [request().passages[0], request().passages[0]] }), /duplicated/);
});

test('inline proofreading uses a conservative prompt and independent output budget, retaining findings across passages', async () => {
  const input = request();
  input.passages = [{ id: 'p1', text: 'She walkd home.', chapterTitle: 'PRIVATE' }, { id: 'p2', text: 'He walkd home.', chapterTitle: 'PRIVATE' }];
  let seen;
  const providers = { async generateStructured(settings, key, prompt) {
    seen = { settings, key, prompt };
    return JSON.stringify({ findings: [
      ...['p1', 'p2'].map((passageId, i) => ({ passageId, start: i === 0 ? 4 : 3, original: 'walkd', replacement: 'walked', category: 'spelling', severity: 'definite', reason: 'Past-tense spelling.' })),
      { passageId: 'p1', start: 0, original: 'She', replacement: 'The woman', category: 'phrasing', severity: 'likely', reason: 'Style.' },
      { passageId: 'p1', start: 0, original: 'She walkd', replacement: 'The woman walked', category: 'grammar', severity: 'optional', reason: 'Style must not hide a real error beneath it.' },
      { passageId: 'p2', start: 0, original: 'He', replacement: 'The man', category: 'grammar', severity: 'optional', reason: 'Style.' }
    ] });
  } };
  const result = await runInlineProofread(providers, { tokenCap: 64, temperature: 1.5 }, 'key', input, new AbortController().signal);
  assert.deepEqual(result.findings.map(finding => finding.passageId), ['p1', 'p2']);
  assert.equal(seen.settings.agentTokenCap, 8192); assert.equal(seen.settings.temperature, 0.2);
  assert.match(seen.prompt.system, /She had had enough/);
  assert.match(seen.prompt.system, /incomplete final sentence/);
  assert.ok(!JSON.stringify(seen.prompt).includes('PRIVATE') && !JSON.stringify(seen.prompt).includes('SECRET'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runInlineProofread(providers, {}, 'key', input, controller.signal), { name: 'AbortError' });
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

test('inline results never guess between duplicate words with invalid model offsets', async () => {
  const input = request(); input.passages = [{ id: 'p1', text: 'He walkd home. She walkd back. One mispeling.' }];
  const candidates = [
    { start: 999, original: 'walkd', replacement: 'walked', occurrence: 2 },
    { start: 3, original: 'walkd', replacement: 'walked' },
    { start: 999, original: 'mispeling', replacement: 'misspelling' }
  ].map(item => ({ ...item, passageId: 'p1', severity: 'definite', category: 'spelling' }));
  const result = await runInlineProofread({ async generateStructured() { return JSON.stringify({ findings: candidates }); } }, {}, '', input);
  assert.deepEqual(result.findings.map(finding => [finding.start, finding.original]), [[3, 'walkd'], [input.passages[0].text.indexOf('mispeling'), 'mispeling']]);
});
