const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Store, CloudError, encryptedInput } = require('./store.cjs');
const auth = require('./auth.cjs');
const mail = require('./mail.cjs');
const { siteOrigins } = require('./site-origins.cjs');
const { createSuggestions } = require('./suggestions.cjs');
const VERSION = '0.21.0-rc.4';
const HOUR = 3600000;
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.aff':'text/plain','.dic':'text/plain' };
function createApplication(options = {}) {
  const env = options.env || process.env;
  const selectSite = siteOrigins(env, path.resolve(env.WRAITER_STATIC_DIR || path.join(__dirname,'../dist-web')));
  const store = options.store || new Store(env.WRAITER_DATA_DIR || path.join(__dirname,'data'));
  const secure = env.WRAITER_SECURE_COOKIES !== '0', cookieName = secure ? '__Host-wraiter' : 'wraiter';
  const sendMail = options.sendMail || mail.sendMail;
  const suggestions = createSuggestions({ store, env, selectSite, deliver: options.deliverSuggestionMail, pollMs: options.suggestionPollMs });
  let hashing = 0;
  async function passwordWork(action) { if (hashing >= 3) throw new CloudError(429,'Too many sign-in requests. Please try again shortly.'); hashing++; try { return await action(); } finally { hashing--; } }
  function limited(key,max,time) { if (store.limited(key,max,time)) throw new CloudError(429,'Too many requests. Please try again later.'); }
  function cookie(response,value,age = 14 * 86400) { response.setHeader('Set-Cookie',`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`); }
  const sessionCacheTag = hash => auth.digest('wraiter-vault-cache:'+hash);
  function issueSession(response,user,device = false) { const value = auth.token(),hash=auth.digest(value); store.addSession(hash,user.id,Date.now() + (device ? 30 : 14) * 24 * HOUR,device ? 'device' : 'web'); if (!device) cookie(response,value); return { ...store.account(user),sessionCacheTag:sessionCacheTag(hash),...(device ? {token:value} : {}) }; }
  function session(request,requireVerified = true) { const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization || ''); const match = String(request.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'=')); const value = bearer?.[1] || match?.slice(cookieName.length+1),hash=value && auth.digest(value); const user = hash && store.session(hash); if (!user) throw new CloudError(401,'Sign in to your WRAITER account.','AUTH_REQUIRED'); if (request.headers['x-wraiter-user'] !== undefined && request.headers['x-wraiter-user'] !== user.id) throw new CloudError(409,'Your account changed in another tab. Sign in again.','ACCOUNT_CHANGED'); if (request.headers['x-wraiter-session'] !== undefined && request.headers['x-wraiter-session'] !== sessionCacheTag(hash)) throw new CloudError(409,'Your account session changed. Sign in again.','ACCOUNT_CHANGED'); if (requireVerified && !user.verified) throw new CloudError(403,'Confirm your email before opening your cloud library.','EMAIL_UNVERIFIED'); return {user,hash}; }
  async function body(request,limit = 100 * 1024 * 1024) { if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw new CloudError(415,'Send application/json.'); if (Number(request.headers['content-length']) > limit) throw new CloudError(413,'The request is too large.'); const chunks = []; let bytes=0; for await (const chunk of request) { bytes += chunk.length; if (bytes>limit) throw new CloudError(413,'The request is too large.'); chunks.push(chunk); } try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { throw new CloudError(400,'Invalid JSON request.'); } }
  async function authenticatedBody(request,user,limit) { const input=await body(request,limit); const current=session(request).user; if(current.id!==user.id) throw new CloudError(409,'Your account changed in another tab. Sign in again.','ACCOUNT_CHANGED'); return input; }
  function json(response,value,status = 200) { response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); response.end(JSON.stringify(value)); }
  async function emailLink(user,kind,site) { const value=auth.token(); store.createToken(user.id,kind,auth.digest(value),Date.now()+(kind==='verify'?24*HOUR:0.5*HOUR)); const link=`${site.origin}/${kind === 'verify' ? 'verify' : 'reset'}#token=${value}`; await sendMail(user.email,kind,link,site.mail); }
  async function api(request,response,url,site) {
    const method=request.method, route=url.pathname, ip = env.WRAITER_TRUST_PROXY === '1' && request.headers['cf-connecting-ip'] || request.socket.remoteAddress;
    const emailConfigured = Boolean(options.sendMail) || mail.configured(site.mail);
    if (route === '/api/health' && method==='GET') return json(response,{ok:true,version:VERSION,emailConfigured});
    if (!['GET','HEAD'].includes(method)) {
      if (request.headers['x-wraiter-request'] !== '1') throw new CloudError(403,'The request needs a WRAITER security header.');
      if (request.headers.origin && request.headers.origin !== site.origin || request.headers['sec-fetch-site']==='cross-site') throw new CloudError(403,'This request did not come from WRAITER.');
    }
    if (route.startsWith('/api/suggestion-relay/') && method === 'POST') {
      suggestions.requireRelay(request);
      if (route === '/api/suggestion-relay/poll') return json(response, await suggestions.poll(await body(request,256*1024), response));
      if (route === '/api/suggestion-relay/receipt') return json(response, suggestions.receipt(await body(request,4096)));
      throw new CloudError(404,'Unknown developer PC request.');
    }
    if (route.startsWith('/api/auth/') && method==='POST') {
      const action=route.slice('/api/auth/'.length);
      if (site.alternate && !emailConfigured && ['register','resend','forgot'].includes(action)) throw new CloudError(503,'Account creation and email resets are currently unavailable on this site.','ACCOUNT_EMAIL_UNAVAILABLE');
      limited('auth-ip:'+ip,60,15*60000);
      const input=action==='logout' && !Number(request.headers['content-length']) ? {} : await body(request,16*1024);
      if (action==='register') {
        limited('register-ip:'+ip,6,HOUR); const address=auth.email(input.email); auth.validatePassword(input.password); limited('register-mail:'+auth.digest(address),4,HOUR);
        let user=store.user(address);
        if (!user || !user.verified) { const hash=await passwordWork(()=>auth.hashPassword(input.password)); user=store.user(address) || store.createUser(address,hash); if(!user.verified){store.password(user.id,hash);user=store.userById(user.id);} }
        if (!user.verified) await emailLink(user,'verify',site);
        return json(response,{ok:true,message:'Check your email for the confirmation link. If you already have an account, sign in or reset your password.'},202);
      }
      if (action==='login') {
        limited('login-ip:'+ip,20,15*60000); const address=auth.email(input.email); limited('login-mail:'+auth.digest(address),12,15*60000);
        const user=store.user(address);
        const valid=await passwordWork(()=>auth.checkPassword(input.password,user?.password_hash || 'scrypt$131072$8$1$00000000000000000000000000000000$'+ '00'.repeat(64)));
        // Password verification yields while scrypt runs. A reset must also
        // invalidate sign-ins that started before its credential/session change.
        const current=user && store.userById(user.id);
        if (!current || !valid || current.password_hash !== user.password_hash) throw new CloudError(401,'Email or password is incorrect.');
        if (!current.verified) throw new CloudError(403,'Confirm your email before signing in. You can request another confirmation email.','EMAIL_UNVERIFIED');
        return json(response,issueSession(response,current,input.device===true));
      }
      if (action==='verify') { if (typeof input.token!=='string'||input.token.length!==43) throw new CloudError(400,'Invalid confirmation link.'); const user=store.consumeToken(auth.digest(input.token),'verify',id=>store.verify(id)); return json(response,issueSession(response,user)); }
      if (action==='resend' || action==='forgot') {
        const address=auth.email(input.email); limited('mail-ip:'+ip,8,HOUR); limited('mail-address:'+auth.digest(address),3,HOUR); const user=store.user(address);
        if (user && (action==='forgot' ? user.verified : !user.verified)) await emailLink(user,action==='forgot'?'reset':'verify',site);
        return json(response,{ok:true,message:'If the account is eligible, an email is on its way.'},202);
      }
      if (action==='reset') { auth.validatePassword(input.password); if (typeof input.token!=='string'||input.token.length!==43) throw new CloudError(400,'Invalid reset link.'); const hash=await passwordWork(()=>auth.hashPassword(input.password)); const userId=store.consumeToken(auth.digest(input.token),'reset',id=>{store.password(id,hash);return id;}); cookie(response,'',0); return json(response,{ok:true,userId,message:'Password updated. Sign in with your new password.'}); }
      if (action==='logout') { const current=session(request,false); store.deleteSession(current.hash); cookie(response,'',0); return json(response,{ok:true}); }
      throw new CloudError(404,'Account action not found.');
    }
    if (route==='/api/auth/me' && method==='GET') { const current=session(request,false); return json(response,{...store.account(current.user),sessionCacheTag:sessionCacheTag(current.hash)}); }
    const {user}=session(request); limited('api-user:'+user.id,2000,60000);
    if (route === '/api/suggestions' && method === 'POST') {
      limited('suggestions:'+user.id,12,HOUR);
      return json(response, suggestions.submit(user,site,await authenticatedBody(request,user,640*1024)),201);
    }
    if (route === '/api/admin/suggestions' || route.startsWith('/api/admin/suggestions/')) {
      suggestions.requireAdmin(user);
      if (route === '/api/admin/suggestions' && method === 'GET') return json(response,suggestions.list(url.searchParams.get('before')));
      const match = /^\/api\/admin\/suggestions\/([a-f0-9-]{36})\/(edit|approve|decline|retry)$/.exec(route);
      if (match && method === 'POST') return json(response,suggestions.review(match[1],match[2],await authenticatedBody(request,user,48*1024)));
      throw new CloudError(404,'Suggestion action not found.');
    }
    if (route.startsWith('/api/ai/')) throw new CloudError(410,'AI now connects directly from your device to your own provider. Reload WRAITER or install the updated desktop app. This server no longer processes document text or provider keys.','CLIENT_UPGRADE_REQUIRED');
    if (route==='/api/account/password' && method==='POST') {
      limited('password-change:'+user.id,6,15*60000);
      const input=await authenticatedBody(request,user,16*1024);
      auth.validatePassword(input.newPassword);
      const valid=await passwordWork(()=>auth.checkPassword(input.currentPassword,user.password_hash));
      if (!valid) throw new CloudError(403,'Enter your current account password to change it.');
      const hash=await passwordWork(()=>auth.hashPassword(input.newPassword));
      const current=session(request),value=auth.token(),newHash=auth.digest(value),device=current.user.session_kind==='device';
      const result=store.changePassword(user.id,{sessionHash:current.hash,expectedPasswordHash:user.password_hash,newPasswordHash:hash,vault:input.vault,baseRevision:input.baseRevision,newSession:{hash:newHash,expires:Date.now()+(device?30:14)*24*HOUR,kind:device?'device':'web'}});
      if (!device) cookie(response,value);
      return json(response,{...store.account(result.user),sessionCacheTag:sessionCacheTag(newHash),...(device?{token:value}:{}),vaultState:result.vaultState});
    }
    if (route==='/api/account' && method==='DELETE') {
      const input=await authenticatedBody(request,user,8192);
      if (!await passwordWork(()=>auth.checkPassword(input.password,user.password_hash))) throw new CloudError(403,'Enter your current password to delete your account.');
      // A reset, logout, or session expiry during password verification must
      // prevent an already-running request from deleting the account afterward.
      const current=session(request).user;
      if (current.id !== user.id || current.password_hash !== user.password_hash) throw new CloudError(403,'Your account changed. Sign in again before deleting your account.');
      store.removeAccount(current.id); cookie(response,'',0); return json(response,{deleted:true});
    }
    if (route==='/api/settings') { if(method==='GET') return json(response,JSON.parse(user.settings)); if(method==='PUT') { const input=await authenticatedBody(request,user,256*1024); return json(response,store.settings(user.id,input.settings || input)); } }
    if (route==='/api/vault') { if(method==='GET') return json(response,store.vault(user.id)); if(method==='PUT') return json(response,store.saveVault(user.id,await authenticatedBody(request,user,16*1024))); }
    if (route==='/api/thesaurus' && method==='POST') throw new CloudError(410,'Thesaurus lookup now runs on your device so selected words stay private. Reload WRAITER or install the updated desktop app.','CLIENT_UPGRADE_REQUIRED');
    if (route==='/api/documents') { if(method==='GET') return json(response,store.list(user.id)); if(method==='POST') { const input=await authenticatedBody(request,user); encryptedInput(input); if (typeof input.id !== 'string') throw new CloudError(400,'An encrypted document identifier is required.'); return json(response,store.save(user.id,input.id,input,true),201); } }
    const documentMatch=/^\/api\/documents\/([A-Za-z0-9_-]{1,200})$/.exec(route);
    if(documentMatch) { const id=documentMatch[1]; if(method==='GET') return json(response,store.document(user.id,id)); if(method==='PUT') return json(response,store.save(user.id,id,await authenticatedBody(request,user))); if(method==='DELETE') { const input=await authenticatedBody(request,user,4096); return json(response,store.remove(user.id,id,input.baseRevision)); } }
    throw new CloudError(404,'API endpoint not found.');
  }
  const server=http.createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff'); response.setHeader('X-Frame-Options','DENY'); response.setHeader('Referrer-Policy','no-referrer'); response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.x.ai https://openrouter.ai https://generativelanguage.googleapis.com; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if(secure) response.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const site = selectSite(request), { staticDir } = site;
      if (site.alternate) response.setHeader('X-Robots-Tag', 'noindex');
      const url=new URL(request.url,site.origin);
      if (!request.url.startsWith('/') || url.origin !== site.origin) throw new CloudError(400,'Invalid URL.');
      if(url.pathname.startsWith('/api/')) return await api(request,response,url,site);
      if(!['GET','HEAD'].includes(request.method)) throw new CloudError(405,'Method not allowed.');
      let pathname; try { pathname=decodeURIComponent(url.pathname); } catch { throw new CloudError(400,'Invalid URL.'); }
      if (/^\/admin\/?$/.test(pathname)) {
        try { suggestions.requireAdmin(session(request).user); }
        catch (error) {
          if (error.status !== 401) throw error;
          response.writeHead(303, { Location: '/?next=admin', 'Cache-Control': 'no-store' });
          return response.end();
        }
      }
      if(pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(part=>part.startsWith('.'))) throw new CloudError(404,'Not found.');
      if (site.alternate && /\.map$/i.test(pathname)) throw new CloudError(404,'Not found.');
      let file=path.resolve(staticDir,'.'+pathname); if(file!==staticDir && !file.startsWith(staticDir+path.sep)) throw new CloudError(404,'Not found.');
      let stat; try { stat=fs.statSync(file); } catch {}
      if(!stat?.isFile()) { if(path.extname(pathname)) throw new CloudError(404,'Not found.'); file=path.join(staticDir,'index.html'); try{stat=fs.statSync(file);}catch{throw new CloudError(503,'The writing app is being prepared. Please try again shortly.');} }
      response.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':/^\/admin\/?$/.test(pathname)?'private, no-store':file.endsWith('.html')?'no-cache':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'public, max-age=3600'});
      if(request.method==='HEAD') return response.end(); await pipeline(fs.createReadStream(file),response);
    } catch(error) { if(response.headersSent) { response.destroy(); return; } const status=error.status || (/document|chapter|format|history|reference|Invalid|damaged|preview supports/i.test(error.message)?400:500); if(status===500) console.error(JSON.stringify({event:'request-error',code:error.code||error.name})); json(response,{error:status===500?'The request could not be completed. Please try again.':error.message,...(error.code?{code:error.code}:{})},status); }
  });
  server.requestTimeout=300000; server.headersTimeout=15000; server.keepAliveTimeout=5000; server.maxRequestsPerSocket=1000;
  const cleanup=setInterval(()=>store.cleanup(),HOUR); cleanup.unref(); server.on('close',()=>{clearInterval(cleanup); suggestions.close(); if(!options.store)store.close();});
  return { server,store };
}
if(require.main===module) { const app=createApplication(); app.server.listen(Number(process.env.PORT || 3020),process.env.HOST || '127.0.0.1',()=>console.log(JSON.stringify({event:'listening',port:app.server.address().port,version:VERSION}))); for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close()); }
module.exports={createApplication};
