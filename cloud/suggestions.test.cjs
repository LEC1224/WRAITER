const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID,randomBytes } = require('node:crypto');
const { createApplication } = require('./server.cjs');
const { digest } = require('./auth.cjs');

test('verified submissions, owner-only decisions, origin-specific outbox and acknowledged PC delivery', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'wraiter-suggestions-'));
  const primary = 'write.first.example', alt = 'write.second.example', admin = 'owner@example.org';
  const key = randomBytes(32).toString('base64url'), messages = [];
  let mailOffline = false;
  const env = { WRAITER_DATA_DIR:root,WRAITER_STATIC_DIR:path.join(root,'primary'),WRAITER_ORIGIN:'https://'+primary,
    WRAITER_ALIAS_ORIGIN:'https://'+alt,WRAITER_ALIAS_STATIC_DIR:path.join(root,'alt'),WRAITER_MAIL_FROM:'noreply@first.example',
    WRAITER_SUGGESTION_ADMIN_EMAIL:admin,WRAITER_SUGGESTION_RELAY_KEY:key,WRAITER_SUGGESTION_ALIAS_RESEND_KEY:'fixture',WRAITER_SUGGESTION_ALIAS_FROM:'noreply@second.example' };
  const { server,store } = createApplication({env,suggestionPollMs:40,deliverSuggestionMail:async (message,config,dedupe) => {
    if (mailOffline) throw Error('Temporary failure');
    messages.push({...message,dedupe});
  }});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root,{recursive:true,force:true}); });
  function account(email,verified = true) {
    const user = store.createUser(email,'fixture'), token = randomBytes(32).toString('base64url');
    if (verified) store.verify(user.id);
    store.addSession(digest(token),user.id,Date.now()+60000,'device');
    return { user,token };
  }
  function request(route, { token,body,host=primary,origin } = {}) {
    return new Promise((resolve,reject) => {
      const req = http.request({host:'127.0.0.1',port:server.address().port,path:route,method:body ? 'POST' : 'GET',
        headers:{Host:host,'X-Wraiter-Request':'1',...(body && {'Content-Type':'application/json'}),...(token && {Authorization:'Bearer '+token}),...(origin && {Origin:origin})}}, res => {
        let text=''; res.on('data',b=>text+=b); res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:text && JSON.parse(text)}));
      }); req.on('error',reject); req.end(body && JSON.stringify(body));
    });
  }
  const owner = account(admin), writer = account('writer@example.org'), unverified=account('unverified@example.org',false);
  const id=randomUUID(), content={id,description:'Fix the toolbar',includeDiagnostics:false}, list='/api/admin/suggestions';
  const review=(action,body,token=owner.token) => request(`${list}/${id}/${action}`,{token,body});
  const poll=(body={}) => request('/api/suggestion-relay/poll',{token:key,body});
  const receipt=body => request('/api/suggestion-relay/receipt',{token:key,body});
  assert.equal((await request('/admin')).headers.location,'/?next=admin');
  assert.equal((await request('/admin',{token:writer.token})).status,403);
  assert.equal((await request(list,{token:writer.token})).status,403);
  assert.equal((await request('/api/suggestions',{body:content})).status,401);
  assert.equal((await request('/api/suggestions',{token:unverified.token,body:content})).status,403);
  assert.equal((await request('/api/suggestions',{token:writer.token,body:content,origin:'https://external.example'})).status,403);
  const file={name:'recent-logs.jsonl',text:'{"event":"test"}\n'};
  assert.equal((await request('/api/suggestions',{token:writer.token,body:{...content,attachments:[file]}})).status,400);
  const submit = () => request('/api/suggestions',{token:writer.token,body:{...content,includeDiagnostics:true,attachments:[file]},host:alt});
  assert.equal((await submit()).status,201); assert.equal((await submit()).status,201);
  assert.equal(messages.length,1); assert.equal(messages[0].to,admin); assert.match(messages[0].from,/noreply@second.example/);
  assert.doesNotMatch(messages[0].text,/recent-logs|first\.example/);
  assert.equal((await review('approve',{revision:1},writer.token)).status,403);
  assert.equal((await request('/api/suggestion-relay/poll',{token:owner.token,body:{}})).status,403);
  const models=[{id:'test',label:'Fixture',efforts:['low','high'],tiers:['priority'],defaultEffort:'low'}];
  assert.equal((await poll({models})).body.job,null);
  assert.equal((await review('edit',{revision:1,prompt:'Clarified toolbar request'})).status,200);
  assert.equal((await review('decline',{revision:1,motivation:'Stale'})).status,409);
  assert.equal((await review('decline',{revision:2,motivation:'   '})).status,400);
  assert.equal((await review('approve',{revision:2,model:'test',effort:'other',tier:''})).status,400);
  const options={model:'test',effort:'high',tier:'priority'};
  const waiting=poll();
  assert.equal((await review('approve',{revision:2,...options})).status,200);
  const {job}=(await waiting).body; assert.equal(job.prompt,'Clarified toolbar request'); assert.deepEqual(job.files,[file]); assert.deepEqual(job.options,options);
  assert.equal((await poll()).body.job,null);
  const threadId=randomUUID(), received={id,lease:job.lease,threadId};
  assert.equal((await receipt({...received,stage:'thread'})).status,200);
  store.db.prepare("UPDATE suggestions SET lease_until=0 WHERE id=?").run(id);
  const resumed=(await poll()).body.job; assert.equal(resumed.threadId,threadId);
  assert.equal((await receipt({...received,stage:'sent'})).status,409);
  assert.equal((await receipt({...received,lease:resumed.lease,stage:'sent'})).status,200);
  const item=(await request(list,{token:owner.token})).body.items[0];
  assert.equal(item.original,content.description); assert.equal(item.status,'sent'); assert.equal(item.thread_id,threadId);
  const second={...content,id:randomUUID()};
  await request('/api/suggestions',{token:writer.token,body:second});
  mailOffline=true;
  const route=`${list}/${second.id}`;
  await request(route+'/edit',{token:owner.token,body:{revision:1,prompt:'Private edit'}});
  await request(route+'/decline',{token:owner.token,host:alt,body:{revision:2,motivation:'The toolbar already supports this.'}});
  assert.equal((await request(list,{token:owner.token})).body.items[0].decline_mail,null);
  mailOffline=false; store.db.prepare('UPDATE suggestion_mail SET due=0 WHERE sent IS NULL').run();
  await request('/api/suggestions',{token:writer.token,body:second});
  const declined=messages.at(-1); assert.equal(declined.to,writer.user.email); assert.match(declined.from,/noreply@first.example/);
  assert.match(declined.text,/already supports/); assert.match(declined.text,/Fix the toolbar/); assert.doesNotMatch(declined.text,/Private edit/);
  assert.ok((await request(list,{token:owner.token})).body.items[0].decline_mail);
  store.removeAccount(owner.user.id);
  assert.equal((await request(list,{token:account(admin).token})).status,403);
});
