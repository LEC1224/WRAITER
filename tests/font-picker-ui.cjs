// Real toolbar and modal keyboard interactions in a private synthetic profile.
const {_electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label)=>{const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await pause(70)}throw new Error(label)};
(async()=>{
 const output=path.join(root,'test-output');await fs.mkdir(output,{recursive:true});
 const userData=await fs.mkdtemp(path.join(output,'font-desktop-'));
 const project={format:'wraiter',version:1,id:'font-desktop',title:'Synthetic font check',language:'en-US',documentStyle:{fontFamily:'Cambria',fontSize:12,lineHeight:1.5},notes:'',style:'',references:[],snapshots:[],chapters:[{id:'one',title:'Long chapter',content:{type:'doc',content:Array.from({length:600},(_,i)=>({type:'paragraph',content:[{type:'text',text:`Paragraph ${i+1}. The river crosses a quiet valley.`}]}))}}]};
 await fs.writeFile(path.join(userData,'recovery.json'),JSON.stringify({project,path:null,expectedHash:null}));
 await fs.writeFile(path.join(userData,'settings.json'),JSON.stringify({setupComplete:true,tutorialComplete:true,enabled:false,startup:'restore',spellcheck:false}));
 const env={...process.env,WRAITER_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;
 const options=process.env.WRAITER_EXECUTABLE?{executablePath:process.env.WRAITER_EXECUTABLE,args:[],env}:{args:[root],env};
 let app,page;const errors=[],checks=[];
 try{
  app=await _electron.launch(options);page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  const editor=page.getByRole('textbox',{name:'Manuscript editor',exact:true});await editor.waitFor();
  const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
  const focus=control=>control.evaluate(e=>e===document.activeElement);
  const search=()=>page.getByRole('textbox',{name:'Search fonts',exact:true});
  const modal=()=>page.getByRole('dialog',{name:'Paragraph and document formatting',exact:true});
  const font=()=>modal().getByRole('combobox',{name:'Default document font',exact:true});
  const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const resize=async(width,height)=>{
   const size=await app.evaluate(({BrowserWindow},size)=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(...size);return win.getContentSize()},[width,height]);
   await wait(()=>page.evaluate(size=>innerWidth===size[0]&&innerHeight===size[1],size),'native size reached renderer');await frames();
  };
  const bounds=()=>page.locator('.font-picker-popup').evaluate(e=>{const b=e.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:innerWidth,height:innerHeight}});
  const original=await editor.innerText();
  await editor.evaluate(e=>{const ed=e.editor;let position;ed.state.doc.forEach((n,offset,index)=>{if(index===599)position=offset+1+n.textContent.indexOf('river')});ed.commands.setTextSelection({from:position,to:position+5});ed.view.focus()});
  const selection=await editor.evaluate(e=>({from:e.editor.state.selection.from,to:e.editor.state.selection.to}));
  const toolbar=page.getByRole('combobox',{name:'Font family',exact:true});await toolbar.focus();await toolbar.press('ArrowDown');await search().fill('Arial');await search().press('Enter');
  await wait(()=>focus(editor),'toolbar font returns focus to editor');
  assert.deepEqual(await editor.evaluate(e=>({from:e.editor.state.selection.from,to:e.editor.state.selection.to})),selection);
  assert.match(await editor.evaluate(e=>JSON.stringify(e.editor.state.doc.lastChild.toJSON())),/Arial/);
  checks.push('Keyboard toolbar font choice retains the distant selected word and returns focus to the editor.');
  await resize(960,650);
  for(const theme of ['Light','Dark','High contrast']){
   await command('settings-appearance');await page.getByRole('button',{name:theme,exact:true}).click();await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor({state:'hidden'});
   await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,{'Light':'paper','Dark':'dark','High contrast':'contrast'}[theme]);
   await page.getByRole('button',{name:'Paragraph and document formatting',exact:true}).click();await modal().waitFor();
   await font().focus();await font().press('ArrowDown');await search().fill('Cambria');await search().press('Enter');await wait(()=>focus(font()),'document font choice returns focus to picker');
   await font().press('ArrowDown');await search().press('Tab');assert.equal(await page.locator('.font-picker-popup').count(),0);assert.ok(await focus(modal().getByRole('spinbutton',{name:'Default document size',exact:true})));
   await font().focus();await font().press('ArrowDown');await search().press('Shift+Tab');assert.equal(await page.locator('.font-picker-popup').count(),0);assert.ok(await focus(modal().getByRole('checkbox',{name:'Show reading statistics below chapter title',exact:true})));
   await font().focus();await font().press('ArrowDown');await search().waitFor();await frames();const b=await bounds();assert.ok(b.left>=0&&b.top>=0&&b.right<=b.width&&b.bottom<=b.height,JSON.stringify(b));
   await page.screenshot({path:path.join(userData,`font-${theme.replaceAll(' ','-').toLowerCase()}-minimum.png`)});
   await resize(1440,900);const big=await bounds();assert.ok(big.left>=0&&big.top>=0&&big.right<=big.width&&big.bottom<=big.height);
   await search().press('Escape');assert.ok(await modal().isVisible());assert.ok(await focus(font()));
   await modal().getByRole('button',{name:'Done',exact:true}).click();await modal().waitFor({state:'hidden'});assert.deepEqual(await editor.evaluate(e=>({from:e.editor.state.selection.from,to:e.editor.state.selection.to})),selection);
   await resize(960,650);
  }
  assert.equal(await editor.innerText(),original);assert.deepEqual(errors,[]);
  checks.push('Document-default font choice, Escape and both Tab directions work within the real formatting dialog.');
  checks.push('Popup bounds stay within native minimum and enlarged windows in all three themes; closing retains the selected word.');
  const result={passed:true,userData,checks,errors};await fs.writeFile(path.join(output,'font-picker-ui-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(error){await page?.screenshot({path:path.join(userData,'failure.png')}).catch(()=>{});console.error(JSON.stringify({userData,checks,errors}));throw error}
 finally{await app?.close().catch(()=>{})}
})().catch(e=>{console.error(e);process.exitCode=1});
