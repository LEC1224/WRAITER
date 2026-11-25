// Run explicitly with the installed Codex CLI. The account store, project and
// model endpoint are isolated so this cannot submit a turn to the developer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CodexBridge,resolveCodex } = require('../electron/codex-bridge.cjs');
const { deliverJob,findProject } = require('../tools/suggestion-relay.cjs');

test('installed Codex persists project, attachments and exactly one approved prompt across receipt loss', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'wraiter-suggestion-codex-'));
  const cwd = path.join(root,'WRAITER'), profile = path.join(root,'codex');
  await fs.mkdir(cwd); await fs.mkdir(profile);
  const model = http.createServer((req,res) => {
    req.resume(); res.writeHead(503,{'Content-Type':'application/json'}); res.end('{"error":{"message":"Local test endpoint"}}');
  });
  await new Promise(r => model.listen(0,'127.0.0.1',r));
  const config = ['model_provider="fixture"','model="fixture-model"','model_providers.fixture.name="Fixture"',
    'model_providers.fixture.wire_api="responses"',`model_providers.fixture.base_url="http://127.0.0.1:${model.address().port}/v1"`,
    'model_providers.fixture.requires_openai_auth=false','features.plugins=false','features.apps=false','features.remote_models=false'];
  const bridge = new CodexBridge(await resolveCodex(), {
    args:['app-server','--listen','stdio://',...config.flatMap(value => ['-c',value])],
    spawn:(exe,args,options) => spawn(exe,args,{...options,env:{...options.env,CODEX_HOME:profile}})
  });
  t.after(async () => {
    await bridge.close(); model.closeAllConnections(); await new Promise(r => model.close(r));
    await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  });
  await bridge.start();
  const rpc = (method,params) => bridge.rpc(method,params);
  const {project} = await rpc('project/create',{name:'WRAITER',roots:[{path:cwd}],idempotencyKey:randomUUID()});
  const projectId = await findProject(rpc,cwd);
  assert.equal(projectId,project.id);
  const job = {id:randomUUID(),lease:randomUUID(),prompt:'Approved test requirement.',options:{model:'fixture-model',effort:'low',tier:''},
    files:[{name:'recent-logs.jsonl',text:'{"event":"fixture"}\n'}]};
  const context = {job,rpc,cwd,projectId,storage:root}, receipts = [];
  const post = async (_route,body) => receipts.push(body);
  await assert.rejects(deliverJob({...context,post:async () => { throw Error('Lost thread receipt'); }}),/Lost thread receipt/);
  await deliverJob({...context,post});
  const {stage,threadId} = receipts.at(-1);
  assert.equal(stage,'sent');
  assert.equal((await rpc('thread/read',{threadId})).thread.projectId,projectId);
  const {data:attachments} = await rpc('thread/attachment/list',{threadId});
  const file = attachments.find(a => a.attachmentType === 'file').payload;
  assert.equal(file.name,job.files[0].name);
  assert.equal(await fs.readFile(file.path,'utf8'),job.files[0].text);
  await deliverJob({...context,job:{...job,threadId},post});
  const {data:turns} = await rpc('thread/turns/list',{threadId,itemsView:'full',limit:10});
  const prompts = turns.flatMap(turn => turn.items).filter(item => item.type === 'userMessage');
  assert.equal(prompts.length,1);
  assert.match(prompts[0].content[0].text,/Approved test requirement/);
});
