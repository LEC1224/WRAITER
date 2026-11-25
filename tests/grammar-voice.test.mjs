import test from 'node:test';
import assert from 'node:assert/strict';
import { keepGrammarHint } from '../src/grammar-voice.js';
const hint = (text, original, rule='wraiter') => ({ from:text.indexOf(original),to:text.indexOf(original)+original.length,original,rule,category:'grammar' });
test('informal quoted verb forms remain quiet while narrative grammar is checked',()=>{
 for(const text of ['“We was passing through.”',"'We was passing through.'"]){
  assert.equal(keepGrammarHint(text,hint(text,'was')),false);
 }
 const narrative='We was passing through.';
 assert.equal(keepGrammarHint(narrative,hint(narrative,'was')),true);
 const possessive="The dogs' owner said we was late.";
 assert.equal(keepGrammarHint(possessive,hint(possessive,'was')),true);
 const normal='“I has a key.”';
 assert.equal(keepGrammarHint(normal,hint(normal,'has')),true);
});
test('optional less/fewer distinction is left to the writer',()=>{
 const text='There were less candles.';
 assert.equal(keepGrammarHint(text,hint(text,'less','lt:FEWER_LESS')),false);
});
