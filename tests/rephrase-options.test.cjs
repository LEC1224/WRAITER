const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRephraseOptions } = require('../electron/rephrase-options.cjs');
const { buildPrompt, validateRequest } = require('../electron/core.cjs');
const { mergeSettings, defaults } = require('../electron/preferences.cjs');
const { contentHash } = require('../electron/document-files.cjs');
const { contentFingerprint } = require('../electron/git-history.cjs');
test('an absent page-break default does not rewrite office files or create Git changes after upgrade',()=>{const original={title:'Old document',chapters:[{content:{type:'doc',content:[{type:'paragraph',attrs:{textAlign:null},content:[{type:'text',text:'Original'}]}]}}]};const upgraded=structuredClone(original);upgraded.chapters[0].content.content[0].attrs.pageBreakBefore=null;assert.equal(contentHash(original),contentHash(upgraded));assert.equal(contentFingerprint(original),contentFingerprint(upgraded));upgraded.chapters[0].content.content[0].attrs.pageBreakBefore=true;assert.notEqual(contentHash(original),contentHash(upgraded));assert.notEqual(contentFingerprint(original),contentFingerprint(upgraded))});
test('the new page-break default does not steal a saved custom acceptance shortcut',()=>{const prefs=mergeSettings(defaults,{hotkeys:{accept:'Ctrl+Enter'}});assert.equal(prefs.hotkeys.accept,'Ctrl+Enter');assert.equal(prefs.hotkeys.pageBreak,'');assert.equal(mergeSettings(defaults,{}).hotkeys.pageBreak,'Ctrl+Enter')});
test('ranked alternatives preserve selection whitespace, deduplicate and keep ratings separate', () => {
  const result=parseRephraseOptions(JSON.stringify({alternatives:[{text:'rising air',rating:2},{text:'updrafts',rating:3},{text:'UPDRAFTS',rating:1},{text:'ascending currents',rating:2}]}),{selection:' uppåtvindar '});
  assert.deepEqual(result.alternatives,[{text:' updrafts ',rating:3},{text:' rising air ',rating:2},{text:' ascending currents ',rating:2}]);
});

test('the original phrase rating stays independent of the ranked replacements', () => {
  for (const currentRating of [1, 2, 3]) {
    const result = parseRephraseOptions(JSON.stringify({ currentRating, alternatives: [
      { text: 'rising air', rating: 2 }, { text: 'updrafts', rating: 3 }
    ] }), { selection: ' uppåtvindar ' });
    assert.deepEqual(result, { currentRating, alternatives: [{ text: ' updrafts ', rating: 3 }, { text: ' rising air ', rating: 2 }] });
  }
  const originalBest = parseRephraseOptions(JSON.stringify({ currentRating: 3, alternatives: [{ text: 'people', rating: 2 }] }), { selection: 'humans' });
  assert.equal(originalBest.currentRating, 3);
  assert.equal(originalBest.alternatives[0].rating, 2);
});

test('a rated original can be returned without different wording', () => {
  for (const currentRating of [1, 2, 3]) assert.deepEqual(parseRephraseOptions(JSON.stringify({ currentRating, alternatives: [] }), { selection: 'updrafts' }), { currentRating, alternatives: [] });
  assert.deepEqual(parseRephraseOptions('{"currentRating":3,"alternatives":[{"text":"updrafts","rating":3}]}', { selection: 'updrafts' }), { currentRating: 3, alternatives: [{ text: 'updrafts', rating: 3 }] });
});

test('missing original ratings remain unknown and invalid ratings are rejected', () => {
  for (const currentRating of [undefined, null]) assert.deepEqual(parseRephraseOptions(JSON.stringify({ currentRating, alternatives: [{ text: 'people', rating: 3 }] }), { selection: 'humans' }), { alternatives: [{ text: 'people', rating: 3 }] });
  for (const currentRating of [0, 4, -1, 1.5, '3', true, {}, []]) assert.throws(() => parseRephraseOptions(JSON.stringify({ currentRating, alternatives: [{ text: 'people', rating: 3 }] }), { selection: 'humans' }), /invalid current phrase rating/);
  assert.throws(() => parseRephraseOptions('{"currentRating":null,"alternatives":[]}', { selection: 'humans' }), /valid rephrasing list/);
});

test('model descriptions stay paired with their replacements through ranking and deduplication', () => {
  const result = parseRephraseOptions(JSON.stringify({ alternatives: [
    { text: 'adult humans', rating: 2, description: 'Emphasizes age: adult means fully grown.' },
    { text: 'people', rating: 3, description: 'Focuses on the group, with less emphasis on species.' },
    { text: 'PEOPLE', rating: 1, description: 'This duplicate note must not replace the first.' }
  ] }), { selection: ' humans ' });
  assert.deepEqual(result.alternatives, [
    { text: ' people ', rating: 3, description: 'Focuses on the group, with less emphasis on species.' },
    { text: ' adult humans ', rating: 2, description: 'Emphasizes age: adult means fully grown.' }
  ]);
});

test('optional notes are compact plain text; missing or unusable notes do not invent an explanation', () => {
  for (const description of [undefined, null, '', ' \n ', 3, { text: 'Not a model note' }]) {
    assert.deepEqual(parseRephraseOptions(JSON.stringify({ alternatives: [{ text: 'people', rating: 3, description }] }), { selection: 'humans' }), { alternatives: [{ text: 'people', rating: 3 }] });
  }
  const result = parseRephraseOptions(JSON.stringify({ alternatives: [
    { text: 'people', rating: 3, description: ' <think>Private reasoning</think> Focuses\n on\t the <em>group</em>. ' },
    { text: 'adult humans', rating: 2, description: 'Age and maturity. '.repeat(50) }
  ] }), { selection: 'humans' });
  assert.equal(result.alternatives[0].description, 'Focuses on the <em>group</em>.');
  assert.equal(result.alternatives[0].text, 'people');
  assert.ok(result.alternatives[1].description.length <= 280);
  assert.ok(result.alternatives[1].description.endsWith('…'));
});
test('legacy single replacements are unranked, malformed or invalid ratings cannot become manuscript text',()=>{
  assert.deepEqual(parseRephraseOptions('updrafts',{selection:'uppåtvindar'}),{alternatives:[{text:'updrafts',rating:null}]});
  for(const raw of ['{"alternatives":','{"alternatives":[]}','{"alternatives":[{"text":"bad","rating":5}]}','{"alternatives":[{"text":"","rating":3}]}'])assert.throws(()=>parseRephraseOptions(raw,{selection:'x'}));
});
test('alternatives use the selected language and bounded sentence context and retain task isolation',()=>{
  const before=Array.from({length:200},(_,i)=>`before${i}`).join(' '),after=Array.from({length:200},(_,i)=>`after${i}`).join(' ');
  const request={id:'test',mode:'rewrite',selection:'uppåtvindar',before,after,language:'en-US',nativeLanguage:'sv-SE',alternatives:true};
  validateRequest(request);const prompt=buildPrompt(request).user;assert.ok(prompt.includes('before120')&&prompt.includes('after79'));assert.ok(!prompt.includes('before119 ')&&!prompt.includes('after80 '));assert.match(prompt,/sv-SE/);assert.match(prompt,/editorial judgment/);assert.match(prompt,/aim for 3 distinct/);
  assert.match(prompt, /"description":/); assert.match(prompt, /at most 25 words/); assert.match(prompt, /tone, register, emphasis, or shade of meaning/); assert.match(prompt, /For translations, explain the nuance/); assert.match(prompt, /Descriptions belong only in the description field/);
  assert.match(prompt, /"currentRating":/); assert.match(prompt, /unchanged SELECTED TEXT/); assert.match(prompt, /on the same scale/); assert.match(prompt, /original can be the strongest choice or tie/); assert.match(prompt, /empty alternatives array with currentRating/);
  assert.doesNotMatch(buildPrompt({ ...request, alternatives: false }).user, /"description":/);
  assert.doesNotMatch(buildPrompt({ ...request, alternatives: false }).user, /"currentRating":/);
  assert.throws(()=>validateRequest({...request,mode:'continue'}),/only available/);
});

test('model-classified alternatives retain the matching independent target after ranking', () => {
  const suggestionCounts = { translation: 4, correction: 2, rephrase: 5 };
  const alternatives = Array.from({ length: 8 }, (_, index) => ({ text: `Option ${index + 1}`, rating: index === 7 ? 3 : 2, description: `Note ${index + 1}` }));
  for (const [mode, kind, limit] of [['rewrite', 'translation', 4], ['rewrite', 'rephrase', 5], ['correct', 'correction', 2], ['correct', 'translation', 4]]) {
    const result = parseRephraseOptions(JSON.stringify({ kind, currentRating: 1, alternatives }), { mode, selection: 'original', suggestionCounts });
    assert.equal(result.kind, kind); assert.equal(result.currentRating, 1);
    assert.equal(result.alternatives.length, limit);
    assert.deepEqual(result.alternatives[0], alternatives[7]);
  }
  assert.equal(parseRephraseOptions(JSON.stringify({ kind: 'rephrase', alternatives }), { mode: 'rewrite', selection: 'original', suggestionCounts: { rephrase: 8 } }).alternatives.length, 8);
  assert.equal(parseRephraseOptions(JSON.stringify({ kind: 'translation', alternatives }), { mode: 'rewrite', selection: 'original', suggestionCounts: { translation: 1 } }).alternatives.length, 1);
});

test('legacy lists and plain corrections use compatible limits without inventing task metadata', () => {
  const alternatives = Array.from({ length: 5 }, (_, index) => ({ text: `Option ${index}`, rating: 3 }));
  assert.deepEqual(parseRephraseOptions(JSON.stringify({ alternatives }), { mode: 'correct', selection: 'original' }), { alternatives: alternatives.slice(0, 1) });
  assert.equal(parseRephraseOptions(JSON.stringify({ alternatives }), { mode: 'rewrite', selection: 'original', suggestionCounts: { translation: 4, rephrase: 5 } }).alternatives.length, 5);
  assert.deepEqual(parseRephraseOptions('She saw it.', { mode: 'correct', selection: 'She seen it.' }), { alternatives: [{ text: 'She saw it.', rating: null }] });
  for (const kind of ['correction', 'other', 3, true, {}]) assert.throws(() => parseRephraseOptions(JSON.stringify({ kind, alternatives }), { mode: 'rewrite', selection: 'original' }), /invalid suggestion type/);
  assert.throws(() => parseRephraseOptions(JSON.stringify({ kind: 'rephrase', alternatives }), { mode: 'correct', selection: 'original' }), /invalid suggestion type/);
});

test('selection prompts use independent targets and keep correction scope and context narrow', () => {
  const suggestionCounts = { translation: 4, correction: 2, rephrase: 5 };
  const request = { id: 'counts', mode: 'rewrite', alternatives: true, selection: 'phrase', suggestionCounts, before: Array.from({ length: 200 }, (_, index) => `before${index}`).join(' '), after: Array.from({ length: 200 }, (_, index) => `after${index}`).join(' ') };
  validateRequest(request);
  const rewriting = buildPrompt(request).user, correcting = buildPrompt({ ...request, mode: 'correct' }).user;
  assert.match(rewriting, /kind to "translation" and aim for 4 distinct translations/);
  assert.match(rewriting, /kind to "rephrase" and aim for 5 distinct natural rephrasings/);
  assert.match(correcting, /kind to "correction" and aim for 2 distinct minimal corrections/);
  assert.match(correcting, /do not offer stylistic rephrasings to fill the list/);
  assert.ok(correcting.includes('before190') && !correcting.includes('before189 '));
  assert.ok(correcting.includes('after9') && !correcting.includes('after10 '));
  assert.match(correcting, /targets, not quotas/);
  validateRequest({ ...request, mode: 'correct' });
  for (const suggestionCounts of [[], { wrong: 3 }, { translation: 9 }, { correction: 0 }, { rephrase: 2.5 }, { translation: '3' }]) assert.throws(() => validateRequest({ ...request, suggestionCounts }), /Invalid suggestion counts/);
  assert.throws(() => validateRequest({ ...request, alternatives: false }), /Invalid suggestion counts/);
});
