const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
const { createApplication } = require('../cloud/server.cjs');
const { hashPassword } = require('../cloud/auth.cjs');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'wraiter-review-ui-')), key=randomBytes(32).toString('base64url');
  const owner='owner@example.org', writer='writer@example.org', password='fixture-password-120';
  const messages=[], errors=[];
  const socket=require('node:net').createServer();
  await new Promise(r=>socket.listen(0,'127.0.0.1',r)); const port=socket.address().port; await new Promise(r=>socket.close(r));
  const origin='http://127.0.0.1:'+port;
  const env={WRAITER_ORIGIN:origin,WRAITER_SECURE_COOKIES:'0',WRAITER_DATA_DIR:dir,WRAITER_STATIC_DIR:path.resolve(process.argv[2] || 'dist-web'),WRAITER_SUGGESTION_ADMIN_EMAIL:owner,WRAITER_SUGGESTION_RELAY_KEY:key};
  const {server,store}=createApplication({env,deliverSuggestionMail:async message=>messages.push(message),suggestionPollMs:30});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  const hash=await hashPassword(password);
  for (const email of [owner,writer]) store.verify(store.createUser(email,hash).id);
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const writerPage=await browser.newPage({viewport:{width:390,height:844}});
    const adminPage=await browser.newPage();
    for (const page of [writerPage,adminPage]) page.on('pageerror',err=>errors.push(err.message));
    async function login(page,email,url) {
      await page.goto(origin+url); await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(password);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
    }
    await login(writerPage,writer,'/');
    const suggest=writerPage.getByRole('button',{name:'Suggest',exact:true});
    async function submit(text,diagnostics) {
      await suggest.click(); const dialog=writerPage.getByRole('dialog',{name:'Suggest a feature or fix to the developer'});
      const consent=dialog.getByRole('checkbox'); assert.equal(await consent.isChecked(),false);
      await dialog.getByLabel('Description').fill(text); if(diagnostics) await consent.check();
      await dialog.getByRole('button',{name:'Submit'}).click(); await dialog.waitFor({state:'hidden'});
    }
    await submit('Improve toolbar spacing',true);
    await submit('Add an extra control',false);
    assert.equal(messages.length,2);
    await writerPage.getByRole('button',{name:'New document',exact:true}).first().click();
    await writerPage.locator('.tiptap[contenteditable=true]').first().waitFor();
    await writerPage.locator('.web-cloud-header').getByRole('button',{name:'Suggest',exact:true}).click();
    const editorDialog=writerPage.getByRole('dialog',{name:'Suggest a feature or fix to the developer'});
    await editorDialog.getByRole('button',{name:'Cancel'}).click(); await editorDialog.waitFor({state:'hidden'});
    const relay=await fetch(origin+'/api/suggestion-relay/poll',{method:'POST',headers:{'X-Wraiter-Request':'1',Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({models:[{id:'test',label:'Test model',efforts:['low','high'],tiers:['priority'],defaultEffort:'low'}]})});
    assert.equal(relay.status,200);
    await login(adminPage,owner,'/admin');
    await adminPage.getByRole('heading',{name:'Suggestions',exact:true}).waitFor();
    const first=adminPage.locator('article').filter({hasText:'Improve toolbar spacing'});
    const second=adminPage.locator('article').filter({hasText:'Add an extra control'});
    assert.match(await first.innerText(),/browser-errors.jsonl/);
    assert.doesNotMatch(await second.innerText(),/browser-errors.jsonl/);
    await first.getByRole('button',{name:'Edit'}).click();
    let dialog=adminPage.getByRole('dialog');
    await dialog.getByLabel('Prompt for Codex').fill('Adjust the top toolbar spacing'); await dialog.getByRole('button',{name:'Save changes'}).click();
    await first.getByRole('button',{name:'Approve'}).click();
    dialog=adminPage.getByRole('dialog'); await dialog.getByLabel('Reasoning').selectOption('high'); await dialog.getByLabel('Speed').selectOption('priority'); await dialog.getByRole('button',{name:'Send to Codex'}).click();
    await first.getByText('Waiting for developer PC').waitFor();
    await second.getByRole('button',{name:'Decline'}).click(); dialog=adminPage.getByRole('dialog');
    assert.equal(await dialog.getByRole('button',{name:'Decline and email'}).isDisabled(),true);
    await dialog.getByLabel('Motivation').fill('The existing toolbar already offers this action.');
    await dialog.getByRole('button',{name:'Decline and email'}).click(); await second.getByText('Decline email sent').waitFor();
    assert.equal(messages.at(-1).to,writer);
    const denied=await writerPage.goto(origin+'/admin'); assert.equal(denied.status(),403); assert.deepEqual(errors,[]);
    console.log('Verified library and editor entry points, mobile submission, opt-in, admin decisions, model settings and access denial.');
  } finally {
    await browser.close(); await new Promise(r=>server.close(r)); await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
