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
test('legacy single replacements are unranked, malformed or invalid ratings cannot become manuscript text',()=>{
  assert.deepEqual(parseRephraseOptions('updrafts',{selection:'uppåtvindar'}),{alternatives:[{text:'updrafts',rating:null}]});
  for(const raw of ['{"alternatives":','{"alternatives":[]}','{"alternatives":[{"text":"bad","rating":5}]}','{"alternatives":[{"text":"","rating":3}]}'])assert.throws(()=>parseRephraseOptions(raw,{selection:'x'}));
});
test('alternatives use the selected language and bounded sentence context and retain task isolation',()=>{
  const before=Array.from({length:200},(_,i)=>`before${i}`).join(' '),after=Array.from({length:200},(_,i)=>`after${i}`).join(' ');
  const request={id:'test',mode:'rewrite',selection:'uppåtvindar',before,after,language:'en-US',nativeLanguage:'sv-SE',alternatives:true};
  validateRequest(request);const prompt=buildPrompt(request).user;assert.ok(prompt.includes('before120')&&prompt.includes('after79'));assert.ok(!prompt.includes('before119 ')&&!prompt.includes('after80 '));assert.match(prompt,/sv-SE/);assert.match(prompt,/editorial judgment/);assert.match(prompt,/three distinct/);
  assert.throws(()=>validateRequest({...request,mode:'continue'}),/only available/);
});
