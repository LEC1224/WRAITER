import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { arrangePages } from '../src/pagination.js';
import { createHistory, recordTransaction, applyHistory, normalizeHistoryProject } from '../src/history.js';
test('automatic divisions and manual breaks reserve margins without altering document positions',()=>{
  const result=arrangePages([{pos:1,top:120,height:24,inline:true},{pos:70,top:960,height:24,inline:true},{pos:140,top:984,height:24,inline:true},{pos:200,top:1008,height:24,inline:true,force:true}],1000,50,24);
  assert.equal(result.pages.length,3);assert.equal(result.breaks[0].pos,70);assert.equal(result.breaks[0].height,114);assert.equal(result.breaks[1].pos,200);assert.equal(result.height,3048);
});
test('oversized objects remain intact on an expanded page',()=>{
  const result=arrangePages([{pos:1,top:140,height:1600,inline:false}],1000,50,24);assert.equal(result.pages.at(-1).height,1700);
});
test('adding optional page-break formatting keeps pre-upgrade undo and redo history valid',()=>{
  const oldSchema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*',attrs:{textAlign:{default:null}}},text:{}}});
  const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*',attrs:{textAlign:{default:null},pageBreakBefore:{default:null}}},text:{}}});
  const original={id:'legacy-page-test',title:'Test',chapters:[{id:'one',title:'Chapter',content:oldSchema.node('doc',null,[oldSchema.node('paragraph',null,oldSchema.text('Before'))]).toJSON()}]};
  const state=EditorState.create({schema:oldSchema,doc:oldSchema.nodeFromJSON(original.chapters[0].content)}),transaction=state.tr.insertText('!',7),next={...original,chapters:[{...original.chapters[0],content:transaction.doc.toJSON()}]};
  const history=recordTransaction(createHistory(original),{chapterId:'one',beforeProject:original,afterProject:next,transaction}),normalized=normalizeHistoryProject(next,schema);
  const resumed=createHistory(normalized,{events:JSON.parse(JSON.stringify(history.events))}),undone=applyHistory(normalized,resumed,'undo',schema);assert.equal(schema.nodeFromJSON(undone.project.chapters[0].content).textContent,'Before');
  const redone=applyHistory(undone.project,undone.journal,'redo',schema);assert.equal(schema.nodeFromJSON(redone.project.chapters[0].content).textContent,'Before!');
});
