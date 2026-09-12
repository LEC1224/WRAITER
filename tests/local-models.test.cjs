const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { LocalModels, validateConfig, validModel, discoverModels, engineEnvironment, consumeJSONLines, friendlyError } = require('../electron/local-models.cjs');
const { runtimeAssets, downloadVerified, extractRuntime, trustedDownload, installRuntime } = require('../electron/local-runtime.cjs');
const JSZip = require('jszip');

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'wraiter-local-test-'));
  t.after(async () => { const resolved = await fs.realpath(directory); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-local-test-')); await fs.rm(resolved, { force: true, recursive: true }); });
  const manager = new LocalModels(directory, { resolveExecutable: async () => path.join(directory, 'ollama.exe') }); manager.initialized = true; manager.discoveredDirectory = path.join(directory, 'models');
  return { directory, manager };
}
async function server(t, handler) {
  const requests = [], instance = http.createServer(async (req,res) => { const chunks=[]; for await(const chunk of req) chunks.push(chunk); const bytes=Buffer.concat(chunks); let body;try {body=JSON.parse(bytes)}catch{}; requests.push({url:req.url,method:req.method,body,bytes}); res.setHeader('Content-Type','application/json'); await handler(req,res,body,bytes); });
  await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise(resolve=>{instance.closeAllConnections();instance.close(resolve)}));
  return {url:`http://127.0.0.1:${instance.address().port}`, requests};
}
test('model names, resource settings and cloud names are validated', () => {
  assert.equal(validModel('qwen3'), 'qwen3:latest'); assert.equal(validModel('author/model:Q4_K_M'), 'author/model:Q4_K_M');
  for(const name of ['../model','name/../model','https://host/model','model --bad','model:cloud','qwen-cloud:latest']) assert.throws(()=>validModel(name));
  assert.throws(()=>validateConfig({contextLength:100})); assert.throws(()=>validateConfig({maxLoaded:20})); assert.throws(()=>validateConfig({gpu:'CUDA_1'})); assert.throws(()=>validateConfig({modelDirectory:'../models'}));
  assert.equal(validateConfig({idleMinutes:0,maxLoaded:2}).idleMinutes,0);
});
test('offline discovery lists complete existing models without reading model weights or starting an engine', async t => {
  const {directory}=await fixture(t); const digest='a'.repeat(64), blob=path.join(directory,'blobs','sha256-'+digest), manifest=path.join(directory,'manifests','registry.ollama.ai','library','synthetic','tiny');
  await fs.mkdir(path.dirname(blob),{recursive:true});await fs.writeFile(blob,Buffer.from('weights')); await fs.mkdir(path.dirname(manifest),{recursive:true});
  await fs.writeFile(manifest,JSON.stringify({layers:[{mediaType:'application/vnd.ollama.image.model',digest:'sha256:'+digest,size:7}]}));
  assert.deepEqual((await discoverModels(directory)).models.map(x=>[x.name,x.size,x.complete]),[['synthetic:tiny',7,true]]);
  await fs.writeFile(blob,'short');assert.equal((await discoverModels(directory)).models[0].complete,false);
  await fs.writeFile(manifest,JSON.stringify({layers:[{mediaType:'application/vnd.ollama.image.model',digest:'../secret',size:7}]}));const invalid=await discoverModels(directory);assert.equal(invalid.models.length,0);assert.equal(invalid.warnings.length,1);
});
test('owned engines use an independent loopback address, selected storage and bounded GPU resources', () => {
  const env=engineEnvironment(validateConfig({gpu:'cpu',maxLoaded:1,contextLength:4096,idleMinutes:0}),'D:\\Models',12345,{ELECTRON_RUN_AS_NODE:'1',OPENAI_API_KEY:'private',CUDA_VISIBLE_DEVICES:'0'});
  assert.equal(env.OLLAMA_HOST,'127.0.0.1:12345');assert.equal(env.OLLAMA_MODELS,'D:\\Models');assert.equal(env.OLLAMA_NO_CLOUD,'1');assert.equal(env.OLLAMA_NOPRUNE,'1');assert.equal(env.CUDA_VISIBLE_DEVICES,'-1');assert.equal(env.OLLAMA_MAX_LOADED_MODELS,'1');assert.equal(env.OLLAMA_KEEP_ALIVE,'0m');assert.equal(env.OPENAI_API_KEY,undefined);
});
test('model progress parses streaming records and does not claim success after an error or cancellation', async () => {
  const values=[];const last=await consumeJSONLines(Readable.from(['{"status":"pulling","completed":1,','"total":4}\n{"status":"success"}']),value=>values.push(value));assert.equal(values.length,2);assert.equal(last.status,'success');
  await assert.rejects(consumeJSONLines(Readable.from(['{"error":"bad model"}\n']),()=>{}),/bad model/);
  const controller=new AbortController();controller.abort();await assert.rejects(consumeJSONLines(Readable.from(['{}\n']),()=>{},controller.signal),/abort/i);
});
test('local generation preloads the chosen installed model and carries resource controls into the adapter', async t => {
  const {manager}=await fixture(t);const s=await server(t,async(req,res)=>res.end(JSON.stringify(req.url==='/api/tags'?{models:[{name:'synthetic:tiny'}]}:{done:true})));manager.url=s.url;manager.start=async()=>s.url;manager.config=validateConfig({gpu:'cpu',contextLength:4096,idleMinutes:1});
  const result=await manager.withModel({model:'synthetic:tiny'},new AbortController().signal,async settings=>{assert.equal(settings.provider,'ollama');assert.equal(settings.baseUrl,s.url);assert.equal(settings.localCPU,true);assert.equal(settings.localContextLength,4096);assert.equal(settings.ollamaKeepAlive,'1m');return 'written'});
  assert.equal(result,'written');assert.equal(s.requests[1].body.options.num_gpu,0);assert.equal(s.requests[1].body.model,'synthetic:tiny');
  await assert.rejects(manager.withModel({model:'missing:tiny'},null,()=>{}),/not downloaded/);assert.equal(s.requests.length,3);
});
test('GGUF import preserves the original, streams bytes and rejects existing model names', async t => {
  const {directory,manager}=await fixture(t);const source=Buffer.alloc(40);source.write('GGUF');source.writeUInt32LE(3,4);const file=path.join(directory,'Synthetic.gguf');await fs.writeFile(file,source);const sha=crypto.createHash('sha256').update(source).digest('hex');
  const s=await server(t,async(req,res,body,data)=>{if(req.url==='/api/tags')return res.end('{"models":[]}');if(req.method==='HEAD'){res.statusCode=404;return res.end()};if(req.url.includes('/api/blobs/')){assert.equal(req.url,'/api/blobs/sha256:'+sha);assert.deepEqual(data,source);res.statusCode=201;return res.end('{}')};assert.deepEqual(body.files,{'Synthetic.gguf':'sha256:'+sha});res.end('{"status":"parsing GGUF"}\n{"status":"success"}\n')});manager.url=s.url;manager.start=async()=>s.url;manager.status=async()=>({busy:!!manager.job});
  await manager.importGGUF(file,'test-model');assert.deepEqual(await fs.readFile(file),source);assert.equal(manager.job,null);assert.equal(s.requests.at(-1).body.model,'test-model:latest');
  await fs.writeFile(file,'not a GGUF model');await assert.rejects(manager.inspectGGUF(file),/GGUF/);
});
test('download/import cancellation preserves the engine and reports a cancelled operation', async t => {
  const {manager}=await fixture(t);let cancelled=false;const work=manager.operation('Synthetic download',signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(new Error('aborted'))},{once:true})));
  manager.status=async()=>({});const rejected=assert.rejects(work,/cancelled/);await manager.cancel();await rejected;assert.equal(cancelled,true);assert.equal(manager.job,null);assert.match(manager.progress.message,/Existing models and runtime were kept/);
});
test('runtime release selection requires official paths and immutable SHA-256 metadata', () => {
  const asset={name:'ollama-windows-amd64.zip',browser_download_url:'https://github.com/ollama/ollama/releases/download/v0.34.0/ollama-windows-amd64.zip',digest:'sha256:'+'a'.repeat(64),size:10};
  assert.equal(runtimeAssets({tag_name:'v0.34.0',assets:[asset]},'x64')[0].sha256,'a'.repeat(64));assert.throws(()=>runtimeAssets({tag_name:'v0.34.0',assets:[{...asset,digest:null}]},'x64'),/verifiable/);assert.throws(()=>runtimeAssets({tag_name:'v0.34.0',assets:[{...asset,browser_download_url:'https://attacker.invalid/ollama.exe'}]},'x64'));
  assert.equal(trustedDownload('https://release-assets.githubusercontent.com/a'),true);assert.equal(trustedDownload('http://github.com/a'),false);assert.equal(trustedDownload('https://github.com.attacker.invalid/a'),false);
});
test('runtime downloads are streamed and verified before extraction, including wrong size/digest and cancellation', async t => {
  const {directory}=await fixture(t), data=Buffer.from('synthetic verified runtime');const asset={url:'https://github.com/ollama/ollama/test',size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};const fetcher=async()=>({body:Readable.from([data.subarray(0,4),data.subarray(4)])});
  const target=path.join(directory,'good.zip');await downloadVerified(asset,target,null,()=>{},fetcher);assert.deepEqual(await fs.readFile(target),data);
  await assert.rejects(downloadVerified({...asset,sha256:'b'.repeat(64)},path.join(directory,'bad.zip'),null,()=>{},fetcher),/checksum/);
  await assert.rejects(downloadVerified({...asset,size:4},path.join(directory,'large.zip'),null,()=>{},fetcher),/expected size/);
  const controller=new AbortController();controller.abort();await assert.rejects(downloadVerified(asset,path.join(directory,'cancelled.zip'),controller.signal,()=>{},fetcher),/abort/i);
});
test('Windows runtime extraction accepts regular files and blocks archive traversal before any extraction', {skip:process.platform!=='win32'}, async t => {
  const {directory}=await fixture(t);let zip=new JSZip();zip.file('lib/engine.txt','safe');const archive=path.join(directory,'safe.zip');await fs.writeFile(archive,await zip.generateAsync({type:'nodebuffer'}));await extractRuntime(archive,path.join(directory,'safe'));assert.equal(await fs.readFile(path.join(directory,'safe','lib','engine.txt'),'utf8'),'safe');
  zip=new JSZip();zip.file('good.txt','must not extract');zip.file('../escaped.txt','bad');const bad=path.join(directory,'bad.zip');await fs.writeFile(bad,await zip.generateAsync({type:'nodebuffer'}));await assert.rejects(extractRuntime(bad,path.join(directory,'bad')),/Unsafe runtime archive path/);await assert.rejects(fs.stat(path.join(directory,'escaped.txt')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(directory,'bad','good.txt')),{code:'ENOENT'});
});
test('out-of-memory errors have a useful recovery message',()=>{assert.match(friendlyError(new Error('CUDA out of memory')),/smaller model/)});

test('parallel initialization waits for saved configuration and failed initialization remains retryable', async t => {
  const {manager}=await fixture(t);manager.initialized=false;let finish,calls=0;
  manager.initialize=async()=>{calls++;await new Promise(resolve=>finish=resolve);manager.config.contextLength=16384};
  const first=manager.init(),second=manager.init();assert.equal(manager.initialized,false);finish();await Promise.all([first,second]);assert.equal(calls,1);assert.equal(manager.config.contextLength,16384);
  manager.initialized=false;manager.initialize=async()=>{throw new Error('Read failed')};await assert.rejects(manager.init(),/Read failed/);assert.equal(manager.initialized,false);assert.equal(manager.initializing,null);
});

test('public model downloads accept version dots and reject registry hosts without overwriting existing models', async t => {
  const {manager}=await fixture(t);manager.start=async()=>{};manager.json=async()=>({models:[]});manager.status=async()=>({});const pulled=[];manager.stream=async(_route,body)=>pulled.push(body.model);
  await manager.pull('llama3.2:1b');await manager.pull('qwen3.5:4b');assert.deepEqual(pulled,['llama3.2:1b','qwen3.5:4b']);
  await assert.rejects(manager.pull('private.example/model:latest'),/public Ollama/);
  manager.json=async()=>({models:[{name:'llama3.2:1b'}]});await assert.rejects(manager.pull('llama3.2:1b'),/already installed/);assert.equal(pulled.length,2);
});

test('immediate unload applies after generation, and unrelated cloud catalog entries do not block local models', async t => {
  const {manager}=await fixture(t);manager.config.idleMinutes=0;manager.start=async()=> 'http://127.0.0.1:12345';const calls=[];
  manager.json=async(route,body)=>{calls.push(body);return route==='api/tags'?{models:[{name:'qwen-cloud:latest'},{name:'synthetic:tiny'}]}:{done:true}};
  await manager.withModel({model:'synthetic:tiny'},null,async settings=>{assert.equal(settings.ollamaKeepAlive,'0m');return 'text'});assert.equal(calls[1].keep_alive,'1m');
  await assert.rejects(manager.operation('Fail',()=>{throw new Error('Failed synchronously')}),/Failed synchronously/);assert.equal(manager.job,null);
});

test('progress decoding preserves Unicode split across network chunks', async () => {
  const bytes=Buffer.from('{"status":"läser"}\n');const values=[];await consumeJSONLines(Readable.from([...bytes].map(byte=>Buffer.from([byte]))),value=>values.push(value));assert.equal(values[0].status,'läser');
});

test('cancelled runtime installation cleans only new staging and preserves the active engine record', async t => {
  const {directory}=await fixture(t),record=path.join(directory,'runtime.json');await fs.writeFile(record,'previous runtime');const controller=new AbortController();controller.abort();
  const info={version:'v0.34.0',flavor:'standard',assets:[{name:'ollama-windows-amd64.zip',url:'https://github.com/ollama/ollama/releases/download/v0.34.0/ollama-windows-amd64.zip',size:10,sha256:'a'.repeat(64)}]};
  await assert.rejects(installRuntime(directory,info,controller.signal),/abort/i);assert.equal(await fs.readFile(record,'utf8'),'previous runtime');assert.deepEqual(await fs.readdir(path.join(directory,'runtimes')),[]);
});
