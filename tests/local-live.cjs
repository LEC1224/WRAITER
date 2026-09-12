// Optional live smoke test. Uses a model already downloaded on this PC and
// copies its blobs into isolated storage; no author text or original cache writes.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { LocalModels } = require('../electron/local-models.cjs');
const providers = require('../electron/providers.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'), directory=await fs.mkdtemp(path.join(root,'test-output','local-live-full-'));
 const originalModels=process.env.OLLAMA_MODELS||path.join(os.homedir(),'.ollama','models'), name='llama3.2:1b';
 const manifest=JSON.parse(await fs.readFile(path.join(originalModels,'manifests','registry.ollama.ai','library','llama3.2','1b'),'utf8'));
 const models=path.join(directory,'models');await fs.mkdir(path.join(models,'blobs'),{recursive:true});
 for(const item of [manifest.config,...manifest.layers]){assert.match(item.digest,/^sha256:[a-f0-9]{64}$/);const file=item.digest.replace(':','-');await fs.copyFile(path.join(originalModels,'blobs',file),path.join(models,'blobs',file));}
 const modelLayer=manifest.layers.find(item=>item.mediaType==='application/vnd.ollama.image.model');const source=path.join(directory,'Synthetic model.gguf');await fs.copyFile(path.join(models,'blobs',modelLayer.digest.replace(':','-')),source);const before=await fs.stat(source);
 const manager=new LocalModels(directory,{notify:progress=>{if(!progress.completed)console.log(`${progress.phase}: ${progress.message}`)}});
 if(process.env.WRAITER_TEST_RUNTIME_ROOT)manager.root=path.resolve(process.env.WRAITER_TEST_RUNTIME_ROOT);
 providers.configureLocalModels(manager);const started=Date.now();
 try{
  await manager.configure({modelDirectory:models,runtimeMode:process.env.WRAITER_TEST_RUNTIME_ROOT?'portable':'installed',contextLength:4096,idleMinutes:1,maxLoaded:1});
  await manager.pull(name);assert.ok((await manager.status()).models.some(item=>item.name===name));
  await manager.importGGUF(source,'wraiter-synthetic-gguf');assert.ok((await manager.status()).models.some(item=>item.name==='wraiter-synthetic-gguf:latest'));
  const result=await providers.generate({provider:'local',model:'wraiter-synthetic-gguf:latest',ollamaMode:'auto',tokenCap:64,temperature:0},'',{mode:'continue',before:'The garden was quiet,',words:8},AbortSignal.timeout(120000));assert.ok(result.trim());
  const loaded=await manager.status();assert.ok(loaded.loaded.some(item=>item.name==='wraiter-synthetic-gguf:latest'));await manager.unload('wraiter-synthetic-gguf:latest');assert.ok(!(await manager.status()).loaded.some(item=>item.name==='wraiter-synthetic-gguf:latest'));
  const after=await fs.stat(source);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
  const report={passed:true,runtime:loaded.runtime,downloadedModel:name,importedModel:'wraiter-synthetic-gguf:latest',sourcePreserved:true,actualOutput:result,unloadPassed:true,elapsedMs:Date.now()-started,directory};await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await manager.shutdown()}
})().catch(error=>{console.error(error);process.exitCode=1});
