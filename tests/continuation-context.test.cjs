const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareContinuationContext, estimatePromptTokens, ContinuationContextError, GUIDED_COMPLETION_INSTRUCTION } = require('../electron/continuation-context.cjs');

const passage = count => Array.from({ length: count }, (_, index) => `word${index}`).join(' ') + ' ';
const baseRequest = overrides => ({ mode: 'continue', before: 'Mara waited by the locked door. ', words: 25, contextWords: 2000, language: 'en-US', references: [], history: [], ...overrides });
function freezeDeep(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freezeDeep); }
  return value;
}

test('small continuation context is preserved without mutating caller data or nested references', () => {
  const original = freezeDeep(baseRequest({ references: [{ name: 'World', text: 'The door is brass.', details: { author: 'Mara' } }], history: ['She left the house.'], style: 'Use concise prose.' }));
  const result = prepareContinuationContext({ localContextLength: 4096 }, original, { outputTokens: 192 });
  assert.deepEqual(result.request, original);
  assert.notEqual(result.request, original);
  assert.notEqual(result.request.references, original.references);
  assert.notEqual(result.request.references[0].details, original.references[0].details);
  assert.notEqual(result.request.history, original.history);
  assert.deepEqual(result.notices, []);
  assert.equal(result.outputTokens, 192);
  assert.equal(result.marginTokens, 512);
  assert.ok(result.estimatedTotalTokens <= 4096);
});

test('reference space is shared fairly before the manuscript is shortened', () => {
  const before = passage(180);
  const references = ['One', 'Two', 'Three'].map(name => ({ name, text: `${name} fact. `.repeat(3000) }));
  const result = prepareContinuationContext({ localContextLength: 4096 }, baseRequest({ before, references }), { outputTokens: 192 });
  assert.equal(result.request.before, before);
  assert.equal(result.request.references.length, 3);
  const lengths = result.request.references.map(reference => reference.text.length);
  assert.ok(Math.max(...lengths) - Math.min(...lengths) < 25, String(lengths));
  assert.ok(result.request.references.every((reference, index) => references[index].text.startsWith(reference.text)));
  assert.ok(result.notices.some(notice => /Reference material was shortened/.test(notice)));
  assert.ok(result.estimatedTotalTokens <= 4096);
});

test('the 48,000 character reference ceiling does not silently crowd later sheets out', () => {
  const references = ['First', 'Second', 'Third'].map(name => ({ name, text: `${name} `.repeat(15000) }));
  const result = prepareContinuationContext({ localContextLength: 65536 }, baseRequest({ references }), { outputTokens: 192 });
  assert.equal(result.request.references.length, 3);
  assert.ok(result.request.references.every(reference => reference.text.length > 15000));
  const supplied = result.prompt.user.split('REFERENCE MATERIAL:\n')[1].split('\n\nTEXT BEFORE CURSOR:')[0];
  assert.ok(supplied.length <= 48000);
  assert.ok(result.notices.some(notice => /Reference material/.test(notice)));
});

test('overfull manuscript context removes references first and retains the cursor tail and style', () => {
  const before = passage(3000) + 'The nearest sentence must remain exactly here. ';
  const request = baseRequest({ before, contextWords: 16000, style: 'Preserve the quiet mood.', language: 'sv-SE', references: [{ name: 'Reference', text: 'Useful background. '.repeat(100) }] });
  const result = prepareContinuationContext({ localContextLength: 2048 }, request, { outputTokens: 192 });
  assert.deepEqual(result.request.references, []);
  assert.ok(result.request.before.endsWith(before.match(/\S+\s*/g).slice(-64).join('')));
  assert.ok(result.request.before.endsWith('The nearest sentence must remain exactly here. '));
  assert.ok((result.request.before.match(/\S+/g) || []).length >= 64);
  assert.equal(result.request.style, request.style);
  assert.equal(result.request.language, 'sv-SE');
  assert.match(result.prompt.system, /Preserve the quiet mood/);
  assert.match(result.prompt.user, /content language is sv-SE/);
  assert.ok(result.notices.some(notice => /Older story text was reduced/.test(notice)));
  assert.ok(result.estimatedTotalTokens <= 2048);
});

test('opening context is retained only when enough space remains for the immediate scene', () => {
  const before = passage(500);
  const larger = prepareContinuationContext({ localContextLength: 32768 }, baseRequest({ before, contextWords: 180 }), { outputTokens: 192 });
  assert.ok(larger.request.before.startsWith('word0 '));
  assert.match(larger.request.before, /Earlier passage omitted/);
  assert.ok(larger.request.before.endsWith('word499 '));
  assert.ok(!larger.notices.some(notice => /Older story text/.test(notice)));
  const smaller = prepareContinuationContext({ localContextLength: 32768 }, baseRequest({ before, contextWords: 70 }), { outputTokens: 192 });
  assert.equal(smaller.request.before, before.match(/\S+\s*/g).slice(-70).join(''));
  assert.doesNotMatch(smaller.request.before, /Earlier passage omitted/);
  assert.ok(!smaller.notices.some(notice => /Older story text/.test(notice)));
});

test('forced reduction makes no notice when a small source has nothing to remove', () => {
  const request = baseRequest();
  const result = prepareContinuationContext({ localContextLength: 4096 }, request, { outputTokens: 192, forceReduced: true });
  assert.equal(result.request.before, request.before);
  assert.deepEqual(result.notices, []);
});

test('rejected suggestions are reduced after the manuscript reaches its protected nearest tail', () => {
  const history = ['A '.repeat(750), 'B '.repeat(750), 'C '.repeat(750)];
  const result = prepareContinuationContext({ localContextLength: 2048 }, baseRequest({ before: passage(400), history }), { outputTokens: 192 });
  assert.equal(result.request.before.match(/\S+/g).length, 64);
  assert.ok(result.request.history.join('').length < history.join('').length);
  assert.ok(result.notices.some(notice => /Rejected suggestions/.test(notice)));
  assert.ok(result.estimatedTotalTokens <= 2048);
});

test('forced reduction makes a smaller independent retry context even in a roomy window', () => {
  const request = freezeDeep(baseRequest({ before: passage(500), references: [{ name: 'Facts', text: 'A reference fact. '.repeat(150) }], history: ['Rejected words. '.repeat(60)] }));
  const normal = prepareContinuationContext({ localContextLength: 32768 }, request, { outputTokens: 192 });
  const reduced = prepareContinuationContext({ localContextLength: 32768 }, request, { outputTokens: 192, forceReduced: true });
  assert.ok(reduced.estimatedTotalTokens < normal.estimatedTotalTokens);
  assert.ok(reduced.request.references[0].text.length <= normal.request.references[0].text.length / 2);
  assert.ok(reduced.request.history[0].length <= normal.request.history[0].length / 2);
  assert.ok(reduced.request.before.endsWith('word499 '));
  assert.equal(request.before, passage(500));
});

test('irreducible instructions and nearest scene fail explicitly instead of discarding style or the cursor tail', () => {
  const request = freezeDeep(baseRequest({ before: passage(100), style: 'Specific style guidance. '.repeat(250) }));
  assert.throws(() => prepareContinuationContext({ localContextLength: 1024 }, request, { outputTokens: 192 }), error => {
    assert.ok(error instanceof ContinuationContextError);
    assert.equal(error.code, 'CONTINUATION_CONTEXT_TOO_SMALL');
    assert.match(error.message, /estimated/);
    assert.ok(error.estimatedRequiredTokens > error.contextLength);
    return true;
  });
});

test('full style guidance remains supplied and budgeted beyond the generic prompt style cap', () => {
  const style = 'Keep this style instruction. '.repeat(250) + 'The final style direction must survive.';
  const result = prepareContinuationContext({ localContextLength: 32768 }, baseRequest({ style }), { outputTokens: 192 });
  assert.ok(style.length > 6000);
  assert.ok(result.prompt.system.endsWith('The final style direction must survive.'));
  assert.equal(result.request.style, style);
  assert.throws(() => prepareContinuationContext({ localContextLength: 2048 }, baseRequest({ style }), { outputTokens: 192 }), ContinuationContextError);
});

test('budget includes guided formatting, extra system instructions, output reservation and safety margin', () => {
  const request = baseRequest();
  const unguided = prepareContinuationContext({}, request, { outputTokens: 192, guided: false });
  const guided = prepareContinuationContext({}, request, { outputTokens: 192, extraSystem: 'Required retry instruction.' });
  assert.equal(guided.estimatedPromptTokens - unguided.estimatedPromptTokens, estimatePromptTokens(`${guided.prompt.system}\n${GUIDED_COMPLETION_INSTRUCTION}\n\n${guided.prompt.user}`) - estimatePromptTokens(`${unguided.prompt.system}\n\n${unguided.prompt.user}`));
  assert.match(guided.prompt.system, /Required retry instruction/);
  assert.equal(guided.estimatedTotalTokens, guided.estimatedPromptTokens + 192 + 512);
  assert.equal(guided.contextLength, 32768);
});

test('non-ASCII text gets a conservative estimate and explicit large windows are respected', () => {
  assert.equal(estimatePromptTokens('a'.repeat(300)), 100);
  assert.equal(estimatePromptTokens('漢'.repeat(300)), 450);
  const request = baseRequest({ before: '細かな描写 '.repeat(3000), contextWords: 16000 });
  const large = prepareContinuationContext({ localContextLength: 65536 }, request, { outputTokens: 192 });
  const automatic = prepareContinuationContext({}, request, { outputTokens: 192 });
  assert.equal(large.contextLength, 65536);
  assert.equal(large.request.before, request.before);
  assert.ok(automatic.estimatedTotalTokens <= 32768);
});

test('non-continuation requests cannot accidentally enter the fitting path', () => {
  assert.throws(() => prepareContinuationContext({}, { mode: 'rewrite' }), /continuation request/);
});
