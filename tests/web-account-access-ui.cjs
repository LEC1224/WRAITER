const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApplication } = require('../cloud/server.cjs');
const { hashPassword } = require('../cloud/auth.cjs');

(async () => {
  const { createVault, unlockAccountVault, sealDocument, openDocument } = await import('../src/cloud-vault.js');
  const { newProject } = await import('../src/document.js');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wraiter-account-ui-'));
  const origin = 'http://127.0.0.1:3039', messages = [];
  const app = createApplication({ env: { WRAITER_DATA_DIR: data, WRAITER_ORIGIN: origin, WRAITER_SECURE_COOKIES: '0' }, sendMail: async (email,kind,link) => messages.push({email,kind,link}) });
  await new Promise(resolve => app.server.listen(3039, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({viewport:{width:1440,height:960}}), page = await context.newPage();
  const output = path.join(__dirname, '../test-output/web-account'); fs.mkdirSync(output,{recursive:true});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const email='account-access@example.com', password='accountpassword2026', changed='changedpassword2026', reset='resetpassword2026', trusted='trustedpassword2026';
  const user=app.store.createUser(email,await hashPassword(password)); app.store.verify(user.id);
  const old=await createVault(user.id,'old document secret 2026'), project=newProject(); project.title='Preserved encrypted manuscript';
  project.chapters[0].content.content[0].content=[{type:'text',text:'The same private manuscript survives every password operation.'}];
  app.store.saveVault(user.id,{vault:old.vault,baseRevision:0}); const sealed=await sealDocument(old.key,user.id,project.id,{project,journal:[]}); app.store.save(user.id,project.id,{sealed},true);
  const library=p=>p.getByRole('heading',{name:'Document library',exact:true}).waitFor();
  const signIn=async(p,pwd)=>{await p.getByRole('button',{name:'Sign in',exact:true}).waitFor();await p.locator('input[name=email]').fill(email);await p.locator('input[name=password]').fill(pwd);await p.getByRole('button',{name:'Sign in',exact:true}).click();};
  const cached=()=>page.evaluate(async()=>new Promise((resolve,reject)=>{const req=indexedDB.open('wraiter-session-keys',1);req.onsuccess=()=>{const tx=req.result.transaction('keys','readonly'),read=tx.objectStore('keys').getAll();read.onsuccess=()=>resolve(read.result.map(r=>({userId:r.userId,tag:r.sessionCacheTag,key:r.key?.constructor.name,fields:Object.keys(r)})));read.onerror=reject;};req.onerror=reject;}));
  const preserved=async(pwd)=>{const state=app.store.vault(user.id),key=await unlockAccountVault(user.id,state.vault,pwd);assert.equal(state.vault.version,2);assert.deepEqual(app.store.document(user.id,project.id).sealed,sealed);assert.equal((await openDocument(key,user.id,project.id,sealed)).project.title,project.title);};
  const forgot=async(ctx)=>{const r=await ctx.request.post(origin+'/api/auth/forgot',{headers:{Origin:origin,'X-Wraiter-Request':'1'},data:{email}});assert.equal(r.status(),202);return messages.at(-1).link;};
  const resetForm=async(p,link,pwd)=>{await p.goto(link);await p.getByRole('heading',{name:'Set account password',exact:true}).waitFor();await p.locator('input[name=password]').fill(pwd);await p.locator('input[name=password-confirmation]').fill(pwd);await p.getByRole('button',{name:'Reset password',exact:true}).click();await p.getByRole('button',{name:'Sign in',exact:true}).waitFor();};
  try {
    await page.goto(origin);await signIn(page,password);await page.getByRole('heading',{name:'Update document access',exact:true}).waitFor();
    await page.locator('input[name=document-recovery-secret]').fill('incorrect previous secret');await page.getByRole('button',{name:'Update and open documents'}).click();await page.getByRole('alert').waitFor();assert.equal(app.store.vault(user.id).vault.version,1);assert.deepEqual(app.store.document(user.id,project.id).sealed,sealed);
    await page.locator('input[name=document-recovery-secret]').fill('old document secret 2026');await page.getByRole('button',{name:'Update and open documents'}).click();await library(page);await preserved(password);
    assert.equal((await cached())[0].key,'CryptoKey');assert.equal((await cached())[0].fields.includes('password'),false);
    await page.reload();await library(page);const tab=await context.newPage();await tab.goto(origin);await library(tab);
    await page.goto(origin+'/verify#token=not-a-real-token');await page.getByRole('heading',{name:'Confirm email address',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Document library',exact:true}).count(),0);await page.goto(origin);await library(page);
    const second=await browser.newContext(), p2=await second.newPage();await p2.goto(origin);await signIn(p2,password);await library(p2);
    const oldSession = await (await context.request.get(origin+'/api/auth/me')).json();
    await page.locator('.web-header-actions > button').last().click();await page.locator('summary').filter({hasText:'Change password'}).click();await page.locator('input[name=change-current-password]').fill(password);await page.locator('input[name=change-new-password]').fill(changed);await page.locator('input[name=change-confirmation]').fill(changed);await page.getByRole('button',{name:'Change password',exact:true}).click();await page.getByText('Password changed. Your documents are available.',{exact:true}).waitFor();await preserved(changed);const beforeStale=app.store.vault(user.id);const stale=await context.request.put(origin+'/api/vault',{headers:{Origin:origin,'X-Wraiter-Request':'1','X-Wraiter-User':user.id,'X-Wraiter-Session':oldSession.sessionCacheTag},data:{vault:beforeStale.vault,baseRevision:beforeStale.revision}});assert.equal(stale.status(),409);assert.equal((await stale.json()).code,'ACCOUNT_CHANGED');assert.equal(app.store.vault(user.id).revision,beforeStale.revision);await page.reload();await library(page);
    await tab.getByRole('button',{name:'Refresh library',exact:true}).click();await tab.getByRole('button',{name:'Sign in',exact:true}).waitFor();await page.reload();await library(page);await tab.close();
    await p2.reload();await p2.getByRole('button',{name:'Sign in',exact:true}).waitFor();await second.close();
    await page.locator('.web-header-actions > button').last().click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal((await cached()).length,0);
    await signIn(page,password);await page.getByRole('alert').waitFor();await signIn(page,changed);await library(page);await page.evaluate(async()=>new Promise(resolve=>{const req=indexedDB.open('wraiter-session-keys',1);req.onsuccess=()=>{const tx=req.result.transaction('keys','readwrite');tx.objectStore('keys').clear();tx.oncomplete=resolve;};}));await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await page.locator('input[name=email]').inputValue(),email);await signIn(page,changed);await library(page);
    // Reset on a new browser has no trusted key: previous account password is required, never a replacement vault.
    const remote=await browser.newContext(), remotePage=await remote.newPage();await resetForm(remotePage,await forgot(remote),reset);await signIn(remotePage,reset);await remotePage.getByRole('heading',{name:'Recover document access',exact:true}).waitFor();assert.deepEqual(app.store.document(user.id,project.id).sealed,sealed);
    await remotePage.locator('input[name=document-recovery-secret]').fill(changed);await remotePage.getByRole('button',{name:'Recover and open documents'}).click();await library(remotePage);await preserved(reset);
    await remotePage.screenshot({path:path.join(output,'account-recovered.png'),fullPage:true});
    // A reset link on the trusted browser keeps its validated cached key in RAM and binds it after matching fresh login.
    const link=await forgot(remote), before=app.store.vault(user.id);await resetForm(remotePage,link,trusted);await signIn(remotePage,trusted);await library(remotePage);assert.equal(await remotePage.getByRole('heading',{name:'Recover document access',exact:true}).count(),0);assert.equal(app.store.vault(user.id).revision,before.revision+1);await preserved(trusted);await remotePage.reload();await library(remotePage);
    await remote.close();assert.deepEqual(errors,[]);console.log('PASS account-key migration, wrong-secret preservation, structured CryptoKey cache, reload/new-tab, verification route, password change/session revocation, logout purge, remote reset recovery and trusted-device reset');
  } catch(error) {await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
  finally {await browser.close();await new Promise(resolve=>app.server.close(resolve));fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});


