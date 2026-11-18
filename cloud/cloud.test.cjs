const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createApplication}=require('./server.cjs');
const {Store}=require('./store.cjs');
const {snapshot}=require('./backup.cjs');
const {cloudSettings}=require('./ai.cjs');
const {runAI}=require('./ai.cjs');
const {hashPassword,checkPassword}=require('./auth.cjs');
const makeProject=()=>({format:'wraiter',version:1,id:randomUUID(),title:'A test manuscript',chapters:[{id:randomUUID(),title:'Chapter one',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Private test writing.'}]}]}}],references:[],chats:[],snapshots:[]});
async function setup(t,quota){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wraiter-cloud-')),sent=[],store=new Store(directory,{quota});
  const app=createApplication({store,env:{WRAITER_ORIGIN:'http://127.0.0.1:3020',WRAITER_SECURE_COOKIES:'0',WRAITER_STATIC_DIR:path.join(directory,'static')},sendMail:async(to,kind,link)=>sent.push({to,kind,link})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));store.close();await fs.rm(directory,{recursive:true,force:true});});
  let cookie='',currentUser,currentVault;
  async function request(route,method='GET',data,extra={}){
    const response=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json','X-Wraiter-Request':'1',...extra},...(data?{body:JSON.stringify(data)}:{})});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  async function account(email){
    await request('/api/auth/register','POST',{email,password:'lowercase123'});
    const link=sent.at(-1).link,verified=await request('/api/auth/verify','POST',{token:new URLSearchParams(new URL(link).hash.slice(1)).get('token')});
    currentUser=verified.body.user;currentVault=null;return verified;
  }
  async function vault(){
    if(!currentVault){const crypto=await import('../src/cloud-vault.js');currentVault={...await crypto.createVault(currentUser.id,'A separate document passphrase1'),userId:currentUser.id};const saved=await request('/api/vault','PUT',{vault:currentVault.vault,baseRevision:0});assert.equal(saved.status,200);}
    return currentVault;
  }
  async function seal(project,journal=[]){const crypto=await import('../src/cloud-vault.js'),active=await vault();return crypto.sealDocument(active.key,active.userId,project.id,{project,journal});}
  async function write(project,{create=true,baseRevision,journal=[]}={}){const sealed=await seal(project,journal);return request(create?'/api/documents':'/api/documents/'+project.id,create?'POST':'PUT',{id:project.id,sealed,...(baseRevision!==undefined?{baseRevision}:{})});}
  async function open(document){const crypto=await import('../src/cloud-vault.js'),active=await vault();return crypto.openDocument(active.key,active.userId,document.id,document.sealed);}
  return {app,store,sent,directory,request,account,vault,seal,write,open,setCookie:value=>cookie=value};
}
async function accountVaultFixture(s,email){
  const signed=await s.account(email),userId=signed.body.user.id,crypto=await import('../src/cloud-vault.js'),active=await crypto.createAccountVault(userId,'lowercase123');
  assert.equal((await s.request('/api/vault','PUT',{vault:active.vault,baseRevision:0})).status,200);
  const project=makeProject(),journal=[{synthetic:'Retain complete encrypted history.'}],sealed=await crypto.sealDocument(active.key,userId,project.id,{project,journal});
  assert.equal((await s.request('/api/documents','POST',{id:project.id,sealed})).status,201);
  return {signed,userId,crypto,active,project,journal,sealed};
}
test('passwords use unique salted slow hashes and accept lowercase plus numbers',async()=>{const first=await hashPassword('lowercase123'),second=await hashPassword('lowercase123');assert.notEqual(first,second);assert.equal(await checkPassword('lowercase123',first),true);assert.equal(await checkPassword('incorrect123',first),false);await assert.rejects(hashPassword('short12'));await assert.rejects(hashPassword('onlyletterslong'));});
test('registration needs email confirmation; token is single use; sessions and passwords are hashed',async t=>{const s=await setup(t);assert.equal((await s.request('/api/auth/register','POST',{email:'writer@example.com',password:'lowercase123'})).status,202);const user=s.store.user('writer@example.com');assert.match(user.password_hash,/^scrypt\$/);assert.equal(user.password_hash.includes('lowercase123'),false);assert.equal((await s.request('/api/auth/login','POST',{email:user.email,password:'lowercase123'})).status,403);const token=new URLSearchParams(new URL(s.sent[0].link).hash.slice(1)).get('token');assert.equal((await s.request('/api/auth/verify','POST',{token})).status,200);assert.equal((await s.request('/api/auth/verify','POST',{token})).status,400);const login=await s.request('/api/auth/login','POST',{email:user.email,password:'lowercase123',device:true});assert.equal(login.status,200);assert.ok(login.body.token);assert.equal(s.store.db.prepare('SELECT hash FROM sessions WHERE kind=?').get('device').hash,require('./auth.cjs').digest(login.body.token));assert.match(login.headers.get('content-security-policy'),/frame-ancestors 'none'/);});
test('encrypted documents enforce ownership, revisions and quotas including the vault',async t=>{
  const s=await setup(t,5000);await s.account('alice@example.com');const project=makeProject();
  assert.equal((await s.write(project)).status,201);
  assert.equal((await s.write(project,{create:false,baseRevision:0})).status,409);
  project.title='Updated';assert.equal((await s.write(project,{create:false,baseRevision:1})).status,200);
  assert.equal((await s.request('/api/documents/'+project.id,'DELETE',{baseRevision:1})).status,409);
  const huge={...project,id:randomUUID(),notes:'x'.repeat(6000)};assert.equal((await s.write(huge)).body.code,'QUOTA_EXCEEDED');
  const before=(await s.request('/api/auth/me')).body.usedBytes;assert.ok(before>500);
  await s.request('/api/auth/logout','POST',{});await s.account('bob@example.com');
  assert.equal((await s.request('/api/documents')).body.documents.length,0);assert.equal((await s.request('/api/vault')).body.vault,null);
  assert.equal((await s.request('/api/documents/'+project.id)).status,404);
  assert.equal((await s.write(project,{create:false,baseRevision:2})).status,404);
  assert.equal((await s.request('/api/documents/'+project.id,'DELETE',{baseRevision:2})).status,404);
});
test('library listing projects only encrypted metadata out of SQLite, without transferring payloads into Node',async t=>{
  const s=await setup(t);await s.account('metadata-only@example.com');
  const project={...makeProject(),notes:'SYNTHETIC-LARGE-PRIVATE-PAYLOAD'.repeat(32768)};
  assert.equal((await s.write(project)).status,201);
  const original=s.store.db.prepare;let checked=0;
  s.store.db.prepare=function(sql){
    const statement=original.call(this,sql);
    if(sql.includes('FROM documents WHERE user_id=? ORDER BY')){
      const all=statement.all;
      statement.all=function(...args){const rows=all.apply(this,args);checked++;for(const row of rows){for(const field of ['sealed','project','journal'])assert.equal(Object.hasOwn(row,field),false,'full private packages must not cross the SQLite listing boundary');for(const value of Object.values(row))if(typeof value==='string')assert.ok(value.length<1000,'only the small encrypted metadata header should enter Node');}return rows;};
    }
    return statement;
  };t.after(()=>{s.store.db.prepare=original;});
  const listed=await s.request('/api/documents');assert.equal(listed.status,200);assert.equal(checked,1);
  assert.equal(listed.body.documents.length,1);const item=listed.body.documents[0];
  assert.deepEqual(Object.keys(item).sort(),['id','encrypted','metadata','revision','bytes','updatedAt'].sort());
  assert.equal(item.encrypted,true);assert.equal(item.id,project.id);assert.equal(item.revision,1);
  assert.deepEqual(item.metadata,(await s.request('/api/documents/'+project.id)).body.sealed.metadata);
  assert.ok(JSON.stringify(listed.body).length<1000);assert.ok(listed.body.usedBytes>1024*1024);
});
test('settings discard credentials recursively and reset revokes old sessions',async t=>{const s=await setup(t);await s.account('writer@example.com');const saved=await s.request('/api/settings','PUT',{theme:'dark',apiKey:'secret-value',tasks:{chat:{provider:'openai',apiKey:'other-secret'}}});assert.equal(saved.status,200);assert.deepEqual(saved.body,{theme:'dark',tasks:{chat:{provider:'openai'}}});await s.request('/api/auth/forgot','POST',{email:'writer@example.com'});const token=new URLSearchParams(new URL(s.sent.at(-1).link).hash.slice(1)).get('token');assert.equal((await s.request('/api/auth/reset','POST',{token,password:'different123'})).status,200);assert.equal((await s.request('/api/auth/me')).status,401);assert.equal((await s.request('/api/auth/login','POST',{email:'writer@example.com',password:'lowercase123'})).status,401);assert.equal((await s.request('/api/auth/login','POST',{email:'writer@example.com',password:'different123'})).status,200);});
test('browser account binding rejects cross-tab cookie changes before private reads, mutations or sign-out',async t=>{
  const s=await setup(t),alice=await s.account('bound-alice@example.com'),aliceId=alice.body.user.id,aliceCookie=alice.headers.get('set-cookie').split(';')[0];
  const project=makeProject();assert.equal((await s.write(project)).status,201);
  assert.equal((await s.request('/api/settings','PUT',{theme:'private-alice-setting'})).status,200);
  const bob=await s.account('bound-bob@example.com'),bobId=bob.body.user.id,bobCookie=bob.headers.get('set-cookie').split(';')[0];
  const before={users:s.store.db.prepare('SELECT id,settings FROM users ORDER BY id').all(),documents:s.store.db.prepare('SELECT id,revision FROM documents ORDER BY id').all(),vaults:s.store.db.prepare('SELECT user_id,revision FROM vaults ORDER BY user_id').all(),sessions:s.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n};
  s.setCookie(aliceCookie);
  const wrong={'X-Wraiter-User':bobId},routes=[
    ['/api/auth/me'],['/api/vault'],['/api/settings'],['/api/documents'],['/api/documents/'+project.id],
    ['/api/auth/logout','POST',{}],['/api/account','DELETE',{password:'lowercase123'}],
    ['/api/settings','PUT',{theme:'cross-tab-overwrite'}],['/api/vault','PUT',{vault:null,baseRevision:0}],
    ['/api/documents','POST',{id:'cross-tab-write',project}],['/api/documents/'+project.id,'PUT',{baseRevision:1,project}],['/api/documents/'+project.id,'DELETE',{baseRevision:1}]
  ];
  for(const [route,method='GET',data] of routes){const result=await s.request(route,method,data,wrong);assert.equal(result.status,409,route);assert.deepEqual(result.body,{error:'Your account changed in another tab. Sign in again.',code:'ACCOUNT_CHANGED'});assert.equal(result.headers.get('set-cookie'),null);}
  assert.deepEqual({users:s.store.db.prepare('SELECT id,settings FROM users ORDER BY id').all(),documents:s.store.db.prepare('SELECT id,revision FROM documents ORDER BY id').all(),vaults:s.store.db.prepare('SELECT user_id,revision FROM vaults ORDER BY user_id').all(),sessions:s.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n},before);
  const matched={'X-Wraiter-User':aliceId};
  assert.equal((await s.request('/api/auth/me','GET',undefined,matched)).body.user.id,aliceId);
  assert.equal((await s.request('/api/documents/'+project.id,'GET',undefined,matched)).status,200);
  assert.equal((await s.request('/api/settings','PUT',{theme:'matched-user-setting'},matched)).status,200);
  s.setCookie(bobCookie);assert.equal((await s.request('/api/vault','GET',undefined,matched)).status,409);
  // Unbound and desktop clients remain supported. Authentication must also let
  // a stale tab choose a new account rather than trapping it behind its header.
  assert.equal((await s.request('/api/auth/me')).body.user.id,bobId);
  assert.equal((await s.request('/api/auth/login','POST',{email:'bound-alice@example.com',password:'lowercase123'},wrong)).status,200);
  assert.equal((await s.request('/api/auth/register','POST',{email:'bound-new@example.com',password:'lowercase123'},wrong)).status,202);
  const token=new URLSearchParams(new URL(s.sent.at(-1).link).hash.slice(1)).get('token');
  assert.equal((await s.request('/api/auth/verify','POST',{token},wrong)).status,200);
});
test('a session revoked while a private upload body is arriving cannot commit its mutation',{timeout:10000},async t=>{
  const s=await setup(t),account=await s.account('body-recheck@example.com'),userId=account.body.user.id,cookie=account.headers.get('set-cookie').split(';')[0],auth=require('./auth.cjs'),http=require('node:http');
  let entered;const started=new Promise(resolve=>{entered=resolve;}),originalSession=s.store.session;
  s.store.session=function(...args){const result=originalSession.apply(this,args);entered();return result;};t.after(()=>{s.store.session=originalSession;});
  const payload=JSON.stringify({theme:'revoked-body-must-not-commit'});
  let upload;
  const finished=new Promise((resolve,reject)=>{
    upload=http.request({hostname:'127.0.0.1',port:s.app.server.address().port,path:'/api/settings',method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'X-Wraiter-Request':'1','X-Wraiter-User':userId}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks))}));});
    upload.on('error',reject);upload.write(payload.slice(0,1));
  });
  t.after(()=>upload.destroy());await started;
  s.store.deleteSession(auth.digest(cookie.slice(cookie.indexOf('=')+1)));upload.end(payload.slice(1));
  const result=await finished;assert.equal(result.status,401);assert.equal(result.body.code,'AUTH_REQUIRED');
  assert.deepEqual(JSON.parse(s.store.userById(userId).settings),{});
});
test('session cache tags bind local keys to one authenticated session and never expose stored credentials',async t=>{
  const s=await setup(t),signed=await s.account('cache-tag@example.com'),user=s.store.user('cache-tag@example.com'),cookie=signed.headers.get('set-cookie').split(';')[0],auth=require('./auth.cjs');
  assert.match(signed.body.sessionCacheTag,/^[a-f0-9]{64}$/);
  assert.equal(signed.body.sessionCacheTag,auth.digest('wraiter-vault-cache:'+auth.digest(cookie.slice(cookie.indexOf('=')+1))));
  assert.equal((await s.request('/api/auth/me')).body.sessionCacheTag,signed.body.sessionCacheTag);
  const login=await s.request('/api/auth/login','POST',{email:user.email,password:'lowercase123'});
  assert.equal(login.status,200);assert.notEqual(login.body.sessionCacheTag,signed.body.sessionCacheTag);
  assert.equal((await s.request('/api/auth/me')).body.sessionCacheTag,login.body.sessionCacheTag);
  const output=JSON.stringify(login.body);assert.equal(output.includes(user.password_hash),false);assert.equal(output.includes('lowercase123'),false);
  assert.equal(output.includes(auth.digest(cookie.slice(cookie.indexOf('=')+1))),false);
});
test('same-user stale session binding cannot read or rewrap a vault after a password reset and fresh login',async t=>{
  const s=await setup(t),f=await accountVaultFixture(s,'same-user-session@example.com'),oldTag=f.signed.body.sessionCacheTag,oldHeader={'X-Wraiter-User':f.userId,'X-Wraiter-Session':oldTag};
  const proposed=await f.crypto.bindVaultToAccount(f.userId,f.active.vault,f.active.key,'lowercase123'),before=(await s.request('/api/vault')).body;
  await s.request('/api/auth/forgot','POST',{email:'same-user-session@example.com'},oldHeader);const token=new URLSearchParams(new URL(s.sent.at(-1).link).hash.slice(1)).get('token');
  const reset=await s.request('/api/auth/reset','POST',{token,password:'resetaccount789'},oldHeader);assert.equal(reset.status,200);assert.equal(reset.body.userId,f.userId);
  const login=await s.request('/api/auth/login','POST',{email:'same-user-session@example.com',password:'resetaccount789'},oldHeader);assert.equal(login.status,200);assert.notEqual(login.body.sessionCacheTag,oldTag);
  for(const [route,method='GET',input] of [['/api/auth/me'],['/api/vault'],['/api/documents'],['/api/documents/'+f.project.id],['/api/vault','PUT',{vault:proposed,baseRevision:1}],['/api/settings','PUT',{theme:'stale-session'}],['/api/auth/logout','POST',{}],['/api/account','DELETE',{password:'resetaccount789'}],['/api/account/password','POST',{currentPassword:'resetaccount789',newPassword:'changedaccount456',vault:proposed,baseRevision:1}]]){
    const result=await s.request(route,method,input,oldHeader);assert.equal(result.status,409,route);assert.deepEqual(result.body,{error:'Your account session changed. Sign in again.',code:'ACCOUNT_CHANGED'});
  }
  const currentHeader={'X-Wraiter-User':f.userId,'X-Wraiter-Session':login.body.sessionCacheTag};
  assert.equal((await s.request('/api/auth/me','GET',undefined,currentHeader)).status,200);assert.deepEqual((await s.request('/api/vault','GET',undefined,currentHeader)).body,before);
  assert.deepEqual(JSON.parse(s.store.userById(f.userId).settings),{});assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM documents').get().n,1);
  assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
});
test('account-password vault v2 accepts null or retained legacy recovery and migrates the same document key',async t=>{
  const s=await setup(t),signed=await s.account('vault-two@example.com'),userId=signed.body.user.id,crypto=await import('../src/cloud-vault.js');
  const legacy=await crypto.createVault(userId,'Legacy separate document passphrase1'),project=makeProject(),sealed=await crypto.sealDocument(legacy.key,userId,project.id,{project,journal:[]});
  assert.equal((await s.request('/api/vault','PUT',{vault:legacy.vault,baseRevision:0})).status,200);
  assert.equal((await s.request('/api/documents','POST',{id:project.id,sealed})).status,201);
  const rebound=await crypto.bindVaultToAccount(userId,legacy.vault,legacy.key,'lowercase123');
  assert.equal(rebound.version,2);assert.deepEqual(rebound.recovery,legacy.vault.recovery);
  const saved=await s.request('/api/vault','PUT',{vault:rebound,baseRevision:1});assert.equal(saved.status,200);assert.equal(saved.body.revision,2);
  const unlocked=await crypto.unlockAccountVault(userId,saved.body.vault,'lowercase123');assert.deepEqual((await crypto.openDocument(unlocked,userId,project.id,sealed)).project,project);
  const recovered=await crypto.unlockVault(userId,saved.body.vault,legacy.recoveryKey,{recovery:true});assert.deepEqual((await crypto.openDocument(recovered,userId,project.id,sealed)).project,project);
  const noRecovery={...rebound,recovery:null};assert.equal((await s.request('/api/vault','PUT',{vault:noRecovery,baseRevision:2})).status,200);
  for(const bad of [{...noRecovery,credential:'other'}, {...noRecovery,credential:undefined}, {...noRecovery,recovery:{}}, {...noRecovery,wrappedKey:{...noRecovery.wrappedKey,ciphertext:Buffer.alloc(47).toString('base64')}}, {...noRecovery,password:'never store this'}])assert.equal((await s.request('/api/vault','PUT',{vault:bad,baseRevision:3})).status,400);
  assert.equal((await s.request('/api/vault')).body.revision,3);
  assert.equal(s.store.db.prepare('SELECT sealed FROM documents WHERE id=?').get(project.id).sealed,JSON.stringify(sealed));
});
test('changing account password atomically rewraps the existing key and rotates all web/device sessions',async t=>{
  const s=await setup(t),f=await accountVaultFixture(s,'password-change@example.com'),oldCookie=f.signed.headers.get('set-cookie').split(';')[0];
  const device=await s.request('/api/auth/login','POST',{email:'password-change@example.com',password:'lowercase123',device:true});
  await s.request('/api/auth/forgot','POST',{email:'password-change@example.com'});assert.ok(s.store.db.prepare('SELECT count(*) AS n FROM tokens').get().n>0);
  const vault=await f.crypto.bindVaultToAccount(f.userId,f.active.vault,f.active.key,'changedaccount456');
  const changed=await s.request('/api/account/password','POST',{currentPassword:'lowercase123',newPassword:'changedaccount456',vault,baseRevision:1},{'X-Wraiter-User':f.userId});
  assert.equal(changed.status,200);assert.equal(changed.body.user.id,f.userId);assert.equal(changed.body.vaultState.revision,2);assert.deepEqual(changed.body.vaultState.vault,vault);
  assert.notEqual(changed.body.sessionCacheTag,f.signed.body.sessionCacheTag);assert.equal((await s.request('/api/auth/me')).body.sessionCacheTag,changed.body.sessionCacheTag);
  assert.equal((await s.request('/api/auth/me','GET',undefined,{Cookie:oldCookie})).status,401);
  assert.equal((await s.request('/api/auth/me','GET',undefined,{Authorization:'Bearer '+device.body.token})).status,401);
  assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM tokens').get().n,0);
  assert.equal((await s.request('/api/auth/login','POST',{email:'password-change@example.com',password:'lowercase123'})).status,401);
  assert.equal((await s.request('/api/auth/login','POST',{email:'password-change@example.com',password:'changedaccount456'})).status,200);
  const key=await f.crypto.unlockAccountVault(f.userId,vault,'changedaccount456');assert.deepEqual(await f.crypto.openDocument(key,f.userId,f.project.id,f.sealed),{project:f.project,journal:f.journal});
  await assert.rejects(f.crypto.unlockAccountVault(f.userId,vault,'lowercase123'));
  assert.equal(s.store.db.prepare('SELECT sealed FROM documents WHERE id=?').get(f.project.id).sealed,JSON.stringify(f.sealed));
});
test('device password change returns a fresh bearer session and preserves an account with no document vault',async t=>{
  const s=await setup(t),signed=await s.account('device-password@example.com');
  const device=await s.request('/api/auth/login','POST',{email:'device-password@example.com',password:'lowercase123',device:true});
  const changed=await s.request('/api/account/password','POST',{currentPassword:'lowercase123',newPassword:'changedaccount456',vault:null,baseRevision:0},{Authorization:'Bearer '+device.body.token,'X-Wraiter-User':signed.body.user.id});
  assert.equal(changed.status,200);assert.match(changed.body.token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(changed.body.token,device.body.token);assert.equal(changed.headers.get('set-cookie'),null);
  assert.deepEqual(changed.body.vaultState,{vault:null,revision:0,legacyDocuments:0});
  assert.equal((await s.request('/api/auth/me')).status,401);
  assert.equal((await s.request('/api/auth/me','GET',undefined,{Authorization:'Bearer '+device.body.token})).status,401);
  const current=await s.request('/api/auth/me','GET',undefined,{Authorization:'Bearer '+changed.body.token});assert.equal(current.status,200);assert.equal(current.body.sessionCacheTag,changed.body.sessionCacheTag);
  assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);assert.equal(s.store.db.prepare('SELECT kind FROM sessions').get().kind,'device');
  assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM vaults').get().n,0);
});
test('failed password changes preserve the old password, vault and sessions, including transactional rollback',async t=>{
  const s=await setup(t),f=await accountVaultFixture(s,'password-failures@example.com'),vault=await f.crypto.bindVaultToAccount(f.userId,f.active.vault,f.active.key,'changedaccount456');
  const originalHash=s.store.userById(f.userId).password_hash,originalVault=(await s.request('/api/vault')).body;
  const input={currentPassword:'lowercase123',newPassword:'changedaccount456',vault,baseRevision:1};
  assert.equal((await s.request('/api/account/password','POST',{...input,currentPassword:'wrongaccount123'})).status,403);
  assert.equal((await s.request('/api/account/password','POST',{...input,newPassword:'short123'})).status,400);
  assert.equal((await s.request('/api/account/password','POST',{...input,baseRevision:0})).body.code,'VAULT_CONFLICT');
  assert.equal((await s.request('/api/account/password','POST',{...input,vault:null,baseRevision:0})).body.code,'VAULT_CONFLICT');
  const addSession=s.store.addSession;s.store.addSession=()=>{throw new Error('Synthetic session-insert failure');};
  try{assert.equal((await s.request('/api/account/password','POST',input)).status,500);}finally{s.store.addSession=addSession;}
  assert.equal(s.store.userById(f.userId).password_hash,originalHash);assert.deepEqual((await s.request('/api/vault')).body,originalVault);
  assert.equal((await s.request('/api/auth/me')).status,200);assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
  const oldQuota=s.store.quota;s.store.quota=(await s.request('/api/auth/me')).body.usedBytes-1;
  try{assert.equal((await s.request('/api/account/password','POST',input)).body.code,'QUOTA_EXCEEDED');}finally{s.store.quota=oldQuota;}
  assert.equal(s.store.userById(f.userId).password_hash,originalHash);assert.deepEqual((await s.request('/api/vault')).body,originalVault);
});
test('a concurrent vault rewrap prevents a stale password change after asynchronous password work',async t=>{
  const s=await setup(t),f=await accountVaultFixture(s,'password-vault-race@example.com'),auth=require('./auth.cjs'),originalCheck=auth.checkPassword;
  const proposed=await f.crypto.bindVaultToAccount(f.userId,f.active.vault,f.active.key,'changedaccount456'),concurrent=await f.crypto.bindVaultToAccount(f.userId,f.active.vault,f.active.key,'lowercase123');
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  auth.checkPassword=async(...args)=>{const valid=await originalCheck(...args);entered();await wait;return valid;};t.after(()=>{auth.checkPassword=originalCheck;release();});
  const changing=s.request('/api/account/password','POST',{currentPassword:'lowercase123',newPassword:'changedaccount456',vault:proposed,baseRevision:1});
  await started;assert.equal((await s.request('/api/vault','PUT',{vault:concurrent,baseRevision:1})).status,200);release();
  const result=await changing;assert.equal(result.status,409);assert.equal(result.body.code,'VAULT_CONFLICT');
  assert.deepEqual((await s.request('/api/vault')).body.vault,concurrent);assert.equal(await checkPassword('lowercase123',s.store.userById(f.userId).password_hash),true);
  assert.equal((await s.request('/api/auth/me')).body.sessionCacheTag,f.signed.body.sessionCacheTag);
});
test('email password reset revokes an in-flight change and preserves account-wrapped vault/documents for recovery',async t=>{
  const s=await setup(t),f=await accountVaultFixture(s,'password-reset-vault@example.com'),auth=require('./auth.cjs'),originalCheck=auth.checkPassword;
  const proposed=await f.crypto.bindVaultToAccount(f.userId,f.active.vault,f.active.key,'changedaccount456'),before=(await s.request('/api/vault')).body;
  await s.request('/api/auth/forgot','POST',{email:'password-reset-vault@example.com'});const resetToken=new URLSearchParams(new URL(s.sent.at(-1).link).hash.slice(1)).get('token');
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  auth.checkPassword=async(...args)=>{const valid=await originalCheck(...args);entered();await wait;return valid;};t.after(()=>{auth.checkPassword=originalCheck;release();});
  const changing=s.request('/api/account/password','POST',{currentPassword:'lowercase123',newPassword:'changedaccount456',vault:proposed,baseRevision:1});
  await started;const reset=await s.request('/api/auth/reset','POST',{token:resetToken,password:'resetaccount789'});assert.equal(reset.status,200);assert.equal(reset.body.userId,f.userId);release();
  assert.equal((await changing).status,401);auth.checkPassword=originalCheck;
  const login=await s.request('/api/auth/login','POST',{email:'password-reset-vault@example.com',password:'resetaccount789'});assert.equal(login.status,200);assert.notEqual(login.body.sessionCacheTag,f.signed.body.sessionCacheTag);
  assert.deepEqual((await s.request('/api/vault')).body,before);
  const reused=await s.request('/api/auth/reset','POST',{token:resetToken,password:'unusedaccount456'});assert.equal(reused.status,400);assert.equal(reused.body.userId,undefined);
  const key=await f.crypto.unlockAccountVault(f.userId,before.vault,'lowercase123');assert.deepEqual(await f.crypto.openDocument(key,f.userId,f.project.id,(await s.request('/api/documents/'+f.project.id)).body.sealed),{project:f.project,journal:f.journal});
  await assert.rejects(f.crypto.unlockAccountVault(f.userId,before.vault,'resetaccount789'));
});
test('password reset blocks an in-flight old-password sign-in and account deletion',async t=>{
  const s=await setup(t),auth=require('./auth.cjs'),originalCheck=auth.checkPassword;
  await s.account('reset-race@example.com');
  const project=makeProject(); assert.equal((await s.write(project)).status,201);
  let pending;
  auth.checkPassword=async(password,hash)=>{
    const valid=await originalCheck(password,hash);
    if(pending && pending.password===password){const active=pending;pending=null;active.entered();await active.wait;}
    return valid;
  };
  const releases=[];
  t.after(()=>{auth.checkPassword=originalCheck;for(const release of releases)release();});
  function pause(password){let entered,release;const started=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});pending={password,entered,wait};releases.push(release);return{started,release};}
  async function resetLink(){await s.request('/api/auth/forgot','POST',{email:'reset-race@example.com'});return new URLSearchParams(new URL(s.sent.at(-1).link).hash.slice(1)).get('token');}

  const firstToken=await resetLink(),loginPause=pause('lowercase123');
  const signingIn=s.request('/api/auth/login','POST',{email:'reset-race@example.com',password:'lowercase123',device:true});
  await loginPause.started;
  assert.equal((await s.request('/api/auth/reset','POST',{token:firstToken,password:'different123'})).status,200);
  loginPause.release();
  const rejectedLogin=await signingIn;
  assert.equal(rejectedLogin.status,401);assert.equal(rejectedLogin.body.token,undefined);
  assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);

  assert.equal((await s.request('/api/auth/login','POST',{email:'reset-race@example.com',password:'different123'})).status,200);
  const secondToken=await resetLink(),deletePause=pause('different123');
  const deleting=s.request('/api/account','DELETE',{password:'different123'});
  await deletePause.started;
  assert.equal((await s.request('/api/auth/reset','POST',{token:secondToken,password:'replacement123'})).status,200);
  deletePause.release();assert.equal((await deleting).status,401);
  assert.ok(s.store.user('reset-race@example.com'));
  assert.equal((await s.request('/api/auth/login','POST',{email:'reset-race@example.com',password:'replacement123'})).status,200);
  assert.equal((await s.open((await s.request('/api/documents/'+project.id)).body)).project.title,project.title);
});
test('API rejects cross-site writes and the retired AI proxy; CSP permits only direct cloud origins',async t=>{
  const s=await setup(t);assert.equal((await s.request('/api/auth/login','POST',{}, {Origin:'https://attacker.invalid'})).status,403);assert.equal((await s.request('/api/auth/login','POST',{}, {'X-Wraiter-Request':''})).status,403);await s.account('writer@example.com');
  for(const action of ['generate','proofread','inline','agent','probe','models','checkpoint']){const denied=await s.request('/api/ai/'+action,'POST',{settings:{provider:'openai'},apiKey:'SYNTHETIC-NO-PROXY',request:{text:'Synthetic text must not be processed.'}});assert.equal(denied.status,410);assert.equal(denied.body.code,'CLIENT_UPGRADE_REQUIRED');}
  const csp=(await s.request('/api/health')).headers.get('content-security-policy'),connect=csp.match(/connect-src ([^;]+)/)[1];
  assert.equal(connect,"'self' https://api.openai.com https://api.anthropic.com https://api.x.ai https://openrouter.ai https://generativelanguage.googleapis.com");
});
test('retired thesaurus endpoint rejects selection text without invoking lookup or echoing it',async t=>{
  const s=await setup(t);await s.account('thesaurus@example.com');const thesaurus=require('../electron/thesaurus.cjs'),lookup=thesaurus.lookup;let lookups=0;
  thesaurus.lookup=async()=>{lookups++;throw new Error('Retired server lookup must not run.');};t.after(()=>{thesaurus.lookup=lookup;});
  const selection='PRIVATE_SELECTION_MUST_STAY_ON_CLIENT',result=await s.request('/api/thesaurus','POST',{word:selection,language:'en-US'});
  assert.equal(result.status,410);assert.equal(result.body.code,'CLIENT_UPGRADE_REQUIRED');assert.equal(lookups,0);assert.equal(JSON.stringify(result.body).includes(selection),false);
});
test('backup restores opaque documents, wrapped vault, users and settings without a document key',async t=>{
  const s=await setup(t);await s.account('backup@example.com');const project=makeProject();await s.write(project);await s.request('/api/settings','PUT',{theme:'night'});
  const output=path.join(s.directory,'snapshot','wraiter.sqlite'),result=await snapshot(s.directory,output);assert.ok(result.bytes>0);
  const {DatabaseSync}=require('node:sqlite'),restored=new DatabaseSync(output,{readOnly:true});
  try{assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('SELECT count(*) AS n FROM users').get().n,1);assert.equal(restored.prepare('SELECT count(*) AS n FROM vaults').get().n,1);const row=restored.prepare('SELECT * FROM documents').get();assert.equal(row.title,'Encrypted document');assert.equal(row.project,'{}');assert.equal(row.journal,'[]');assert.equal(JSON.stringify(row).includes('Private test writing.'),false);assert.equal((await s.open({id:row.id,sealed:JSON.parse(row.sealed)})).project.title,project.title);assert.equal(JSON.parse(restored.prepare('SELECT settings FROM users').get().settings).theme,'night');}finally{restored.close();}
});
test('vault create and rewrap use compare-and-swap, survive auth reset and cascade on account deletion',async t=>{
  const s=await setup(t),signed=await s.account('vault@example.com'),userId=signed.body.user.id;
  assert.deepEqual((await s.request('/api/vault')).body,{vault:null,revision:0,legacyDocuments:0});
  const crypto=await import('../src/cloud-vault.js'),active=await s.vault(),original=active.vault;
  const created=(await s.request('/api/vault')).body;assert.equal(created.revision,1);assert.deepEqual(created.vault,original);
  assert.equal((await s.request('/api/vault','PUT',{vault:original,baseRevision:0})).status,409);
  const replacement=await crypto.rewrapVault(userId,original,active.key,'A different document passphrase2');
  assert.equal((await s.request('/api/vault','PUT',{vault:replacement,baseRevision:1})).body.revision,2);
  assert.equal((await s.request('/api/vault','PUT',{vault:original,baseRevision:1})).status,409);
  const recoveryKey=await crypto.unlockVault(userId,replacement,active.recoveryKey,{recovery:true});
  const project=makeProject(),sealed=await crypto.sealDocument(recoveryKey,userId,project.id,{project,journal:[]});
  assert.equal((await s.request('/api/documents','POST',{id:project.id,sealed})).status,201);
  await s.request('/api/auth/forgot','POST',{email:'vault@example.com'});
  const token=new URLSearchParams(new URL(s.sent.at(-1).link).hash.slice(1)).get('token');
  assert.equal((await s.request('/api/auth/reset','POST',{token,password:'different123'})).status,200);
  assert.equal((await s.request('/api/auth/login','POST',{email:'vault@example.com',password:'different123'})).status,200);
  assert.deepEqual((await s.request('/api/vault')).body.vault,replacement);
  const record=(await s.request('/api/documents/'+project.id)).body;
  assert.deepEqual((await crypto.openDocument(recoveryKey,userId,record.id,record.sealed)).project,project);
  assert.equal(JSON.stringify(s.store.db.prepare('SELECT * FROM vaults').get()).includes('document passphrase'),false);
  assert.equal((await s.request('/api/account','DELETE',{password:'different123'})).status,200);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM vaults').get().n,0);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,0);
});
test('new writes require client encryption and an account vault, with no plaintext content persisted',async t=>{
  const s=await setup(t),signed=await s.account('opaque@example.com'),userId=signed.body.user.id,project=makeProject();
  project.notes='Synthetic private notes';project.style='Synthetic private style';project.chats=[{id:randomUUID(),messages:[{role:'user',text:'Synthetic private conversation'}]}];project.references=[{id:randomUUID(),name:'Synthetic reference',text:'Synthetic reference content'}];
  const rejected=await s.request('/api/documents','POST',{project,journal:[]});assert.equal(rejected.status,410);assert.equal(rejected.body.code,'CLIENT_UPGRADE_REQUIRED');assert.match(rejected.body.error,/vault/);
  const crypto=await import('../src/cloud-vault.js'),active=await crypto.createVault(userId,'Synthetic private vault passphrase1'),journal=[{synthetic:'private journal marker'}],sealed=await crypto.sealDocument(active.key,userId,project.id,{project,journal});
  assert.equal((await s.request('/api/documents','POST',{id:project.id,sealed})).body.code,'VAULT_REQUIRED');
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,0);
  assert.equal((await s.request('/api/vault','PUT',{vault:active.vault,baseRevision:0})).status,200);
  assert.equal((await s.request('/api/documents','POST',{id:project.id,sealed,project})).status,410);
  const saved=await s.request('/api/documents','POST',{id:project.id,sealed});assert.equal(saved.status,201);assert.equal(saved.body.bytes,Buffer.byteLength(JSON.stringify(sealed)));
  const row=s.store.db.prepare('SELECT title,project,journal,sealed FROM documents').get();assert.equal(row.title,'Encrypted document');assert.equal(row.project,'{}');assert.equal(row.journal,'[]');
  for(const marker of [project.title,'Private test writing.','Synthetic private notes','Synthetic private conversation','Synthetic reference content','private journal marker'])assert.equal(JSON.stringify(row).includes(marker),false);
  const listed=(await s.request('/api/documents')).body.documents[0];assert.equal(listed.encrypted,true);assert.equal(listed.title,undefined);assert.deepEqual(listed.metadata,sealed.metadata);assert.equal(listed.sealed,undefined);
  assert.equal((await crypto.openMetadata(active.key,userId,project.id,listed.metadata)).title,project.title);
  const record=(await s.request('/api/documents/'+project.id)).body;assert.equal(record.project,undefined);assert.equal(record.journal,undefined);assert.deepEqual(await crypto.openDocument(active.key,userId,project.id,record.sealed),{project,journal});
  assert.equal((await s.request('/api/auth/me')).body.usedBytes,Buffer.byteLength(JSON.stringify(sealed))+Buffer.byteLength(JSON.stringify(active.vault))+2);
});
test('vault and encrypted-envelope validation rejects malformed or unsupported data before writing',async t=>{
  const s=await setup(t);await s.account('validation@example.com');const active=await s.vault(),project=makeProject(),sealed=await s.seal(project);
  for(const bad of [
    {...active.vault,version:2},
    {...active.vault,kdf:{...active.vault.kdf,iterations:1}},
    {...active.vault,kdf:{...active.vault.kdf,salt:Buffer.alloc(15).toString('base64')}},
    {...active.vault,wrappedKey:{...active.vault.wrappedKey,ciphertext:Buffer.alloc(47).toString('base64')}},
    {...active.vault,recovery:{...active.vault.recovery,iv:Buffer.alloc(11).toString('base64')}},
    {...active.vault,passphrase:'must never be stored'}
  ])assert.equal((await s.request('/api/vault','PUT',{vault:bad,baseRevision:1})).status,400);
  assert.equal((await s.request('/api/vault')).body.revision,1);
  for(const bad of [
    {...sealed,version:2},
    {...sealed,payload:{...sealed.payload,iv:Buffer.alloc(11).toString('base64')}},
    {...sealed,payload:{...sealed.payload,ciphertext:'not base64!'}},
    {...sealed,payload:{...sealed.payload,ciphertext:Buffer.alloc(15).toString('base64')}},
    {...sealed,metadata:{...sealed.metadata,ciphertext:Buffer.alloc(64*1024+1).toString('base64')}},
    {...sealed,title:'plaintext metadata is not accepted'}
  ])assert.equal((await s.request('/api/documents','POST',{id:project.id,sealed:bad})).status,400);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,0);
});
test('vault envelope uses storage quota and failure leaves no partial vault',async t=>{
  const s=await setup(t,100),signed=await s.account('smallquota@example.com'),crypto=await import('../src/cloud-vault.js'),active=await crypto.createVault(signed.body.user.id,'Synthetic vault quota passphrase1');
  const result=await s.request('/api/vault','PUT',{vault:active.vault,baseRevision:0});assert.equal(result.status,413);assert.equal(result.body.code,'QUOTA_EXCEEDED');assert.equal((await s.request('/api/vault')).body.vault,null);
});
test('schema-one documents migrate additively, stay readonly as legacy, and convert with revision protection',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wraiter-cloud-legacy-')),filename=path.join(directory,'wraiter.sqlite'),{DatabaseSync}=require('node:sqlite'),legacy=new DatabaseSync(filename),userId=randomUUID(),project=makeProject(),journal=[{synthetic:'Legacy journal'}],createdAt=new Date().toISOString();
  legacy.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,settings TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL); CREATE TABLE documents(id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,project TEXT NOT NULL,journal TEXT NOT NULL,revision INTEGER NOT NULL,bytes INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,id));");
  legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(userId,'legacy@example.com','synthetic-hash',1,'{}',createdAt);
  legacy.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)').run(project.id,userId,project.title,JSON.stringify(project),JSON.stringify(journal),1,Buffer.byteLength(JSON.stringify(project))+Buffer.byteLength(JSON.stringify(journal)),createdAt);legacy.close();
  const store=new Store(directory);t.after(async()=>{store.close();await fs.rm(directory,{recursive:true,force:true});});
  assert.equal(store.db.prepare("SELECT value FROM metadata WHERE key='schema'").get().value,'2');assert.equal(store.vault(userId).legacyDocuments,1);
  assert.equal(store.list(userId).documents[0].legacy,true);assert.equal(store.list(userId).documents[0].title,project.title);assert.deepEqual(store.document(userId,project.id).project,project);
  assert.throws(()=>store.save(userId,project.id,{project,journal,baseRevision:1}),error=>error.status===410);assert.equal(store.document(userId,project.id).revision,1);
  const crypto=await import('../src/cloud-vault.js'),active=await crypto.createVault(userId,'Synthetic migration vault passphrase1');store.saveVault(userId,{vault:active.vault,baseRevision:0});const sealed=await crypto.sealDocument(active.key,userId,project.id,{project,journal});
  assert.throws(()=>store.save(userId,project.id,{sealed,baseRevision:0}),error=>error.code==='REVISION_CONFLICT');assert.equal(store.document(userId,project.id).legacy,true);
  assert.equal(store.save(userId,project.id,{sealed,baseRevision:1}).revision,2);assert.equal(store.vault(userId).legacyDocuments,0);assert.equal(store.list(userId).documents[0].title,undefined);
  const row=store.db.prepare('SELECT title,project,journal,sealed FROM documents').get();assert.equal(row.title,'Encrypted document');assert.equal(row.project,'{}');assert.equal(row.journal,'[]');assert.deepEqual(await crypto.openDocument(active.key,userId,project.id,store.document(userId,project.id).sealed),{project,journal});
});
test('cloud generation forwards only the requesting user key and never falls back to publisher credentials',async()=>{const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY,calls=[];process.env.OPENAI_API_KEY='publisher-key-must-never-be-used';globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'A bird began to sing.'}]}]}),{headers:{'Content-Type':'application/json'}});};try{const body={settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:'synthetic-cloud'},request:{id:'synthetic-request',mode:'continue',before:'The garden was quiet. ',words:10}};await assert.rejects(runAI('generate',body,AbortSignal.timeout(1000)),/your own/);assert.equal(calls.length,0);const result=await runAI('generate',{...body,apiKey:'user-owned-test-key'},AbortSignal.timeout(1000));assert.match(result,/bird began/);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(calls[0].init.headers.Authorization,'Bearer user-owned-test-key');assert.equal(calls[0].init.redirect,'error');assert.equal(JSON.parse(calls[0].init.body).store,false);assert.throws(()=>cloudSettings({...body.settings,taskProfiles:{continue:{provider:'codex'}}},'generate'),/cloud API providers only/);}finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}});
