const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { StringDecoder } = require('node:string_decoder');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { atomicWrite, readLimited } = require('./core.cjs');
const { resolveOllama } = require('./ollama-service.cjs');
const { releaseInfo, installRuntime, childTask } = require('./local-runtime.cjs');

const DEFAULT_CONFIG = { modelDirectory: '', runtimeMode: 'auto', contextLength: 8192, idleMinutes: 5, maxLoaded: 1, gpu: 'auto' };
const CATALOG = [
  { name: 'qwen3:0.6b', label: 'Qwen 3 · 0.6B', description: 'Small model for trying local assistance.' },
  { name: 'qwen3:1.7b', label: 'Qwen 3 · 1.7B', description: 'Compact multilingual model.' },
  { name: 'qwen3:4b', label: 'Qwen 3 · 4B', description: 'A larger multilingual writing model.' },
  { name: 'qwen3:8b', label: 'Qwen 3 · 8B', description: 'More memory and processing required.' },
  { name: 'llama3.2:1b', label: 'Llama 3.2 · 1B', description: 'Small general-purpose model.' },
  { name: 'gemma3:1b', label: 'Gemma 3 · 1B', description: 'Compact text model.' }
];
function validateConfig(value) {
  const config = { ...DEFAULT_CONFIG, ...value };
  if (typeof config.modelDirectory !== 'string' || config.modelDirectory.length > 4000 || (config.modelDirectory && !path.isAbsolute(config.modelDirectory))) throw new Error('Choose an absolute model folder.');
  if (!['auto', 'portable', 'installed'].includes(config.runtimeMode)) throw new Error('Invalid runtime selection.');
  for (const [key, min, max] of [['contextLength', 2048, 131072], ['idleMinutes', 0, 120], ['maxLoaded', 1, 3]]) if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`Invalid ${key} setting.`);
  if (typeof config.gpu !== 'string' || !/^(auto|cpu|GPU-[a-fA-F0-9-]+)$/.test(config.gpu)) throw new Error('Choose automatic GPU selection, CPU, or a detected NVIDIA GPU.');
  return Object.fromEntries(Object.keys(DEFAULT_CONFIG).map(key => [key, config[key]]));
}
function validModel(name) {
  if (typeof name !== 'string' || name.length > 180 || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..') || /(?:^|[-:])cloud(?:$|[-:])/i.test(name)) throw new Error('Enter a local Ollama model name, such as qwen3:4b. Cloud models are unavailable here.');
  return name.includes(':') ? name : name + ':latest';
}
async function readJSON(file, fallback) { try { return JSON.parse((await readLimited(file, 2 * 1024 ** 2)).toString('utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
async function discoverModels(directory) {
  const base = path.join(directory, 'manifests'), files = []; let visited = 0;
  async function walk(folder, depth = 0) {
    if (depth > 8) return;
    let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (++visited > 20000) throw new Error('This model folder has too many manifest entries. Choose a narrower Ollama model folder.');
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1); else if (entry.isFile()) files.push(file);
    }
  }
  await walk(base); const models = [], warnings = [];
  for (const file of files) {
    try {
      const parts = path.relative(base, file).split(path.sep); if (parts.length < 4) continue;
      const tag = parts.pop(), host = parts.shift(), namespace = parts.shift();
      const name = validModel(`${host === 'registry.ollama.ai' ? '' : host + '/'}${namespace === 'library' ? '' : namespace + '/'}${parts.join('/')}:${tag}`);
      const manifest = await readJSON(file); if (!Array.isArray(manifest.layers)) throw new Error('Invalid layers');
      let size = 0, complete = true;
      for (const layer of manifest.layers) {
        if (!/^sha256:[a-f0-9]{64}$/.test(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 0) throw new Error('Invalid model layer');
        size += layer.size; const blob = await fs.stat(path.join(directory, 'blobs', layer.digest.replace(':', '-'))).catch(() => null);
        if (!blob?.isFile() || blob.size !== layer.size) complete = false;
      }
      if (!manifest.layers.some(layer => layer.mediaType === 'application/vnd.ollama.image.model')) continue;
      models.push({ name, size, complete, modifiedAt: (await fs.stat(file)).mtime.toISOString() });
    } catch { warnings.push(`Could not read model manifest ${path.relative(base, file)}.`); }
  }
  return { models: models.sort((a, b) => a.name.localeCompare(b.name)), warnings: warnings.slice(0, 8) };
}
function engineEnvironment(config, directory, port, base = process.env) {
  const env = { ...base, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_MODELS: directory, OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: String(config.maxLoaded), OLLAMA_CONTEXT_LENGTH: String(config.contextLength), OLLAMA_KEEP_ALIVE: `${config.idleMinutes}m`, NO_COLOR: '1' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'CUDA_VISIBLE_DEVICES', 'GGML_VK_VISIBLE_DEVICES', 'HIP_VISIBLE_DEVICES', 'ROCR_VISIBLE_DEVICES', 'GPU_DEVICE_ORDINAL', 'OLLAMA_VULKAN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete env[key];
  if (config.gpu === 'cpu') Object.assign(env, { CUDA_VISIBLE_DEVICES: '-1', GGML_VK_VISIBLE_DEVICES: '-1', HIP_VISIBLE_DEVICES: '-1', ROCR_VISIBLE_DEVICES: '-1', GPU_DEVICE_ORDINAL: '-1', OLLAMA_VULKAN: '0' });
  else if (config.gpu.startsWith('GPU-')) env.CUDA_VISIBLE_DEVICES = config.gpu;
  return env;
}
async function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function consumeJSONLines(body, onValue, signal) {
  let buffer = '', last; const decoder = new StringDecoder('utf8');
  for await (const chunk of body) {
    signal?.throwIfAborted(); buffer += decoder.write(Buffer.from(chunk));
    if (Buffer.byteLength(buffer) > 2 * 1024 ** 2) throw new Error('The local model returned an oversized progress record.');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (!line) continue;
      const value = JSON.parse(line); if (value.error) throw new Error(String(value.error).slice(0, 800)); last = value; onValue(value);
    }
  }
  buffer += decoder.end();
  if (buffer.trim()) { const value = JSON.parse(buffer); if (value.error) throw new Error(String(value.error).slice(0, 800)); last = value; onValue(value); }
  return last;
}
function friendlyError(error) {
  const message = String(error?.message || error);
  return /out of memory|not enough memory|insufficient.*memory|requires more.*memory|cuda.*alloc/i.test(message) ? 'The model could not fit in available memory. Unload other models, choose a smaller model, or reduce the context size.' : message;
}

class LocalModels {
  constructor(userData, { notify = () => {}, resolveExecutable = resolveOllama, spawnEngine = spawn } = {}) {
    this.root = path.join(userData, 'Local AI'); this.notify = notify; this.resolveExecutable = resolveExecutable; this.spawnEngine = spawnEngine;
    this.config = { ...DEFAULT_CONFIG }; this.child = null; this.starting = null; this.url = ''; this.job = null; this.progress = null; this.error = ''; this.loaded = []; this.hardware = { ram: os.totalmem(), gpus: [] }; this.initialized = false; this.releaseCache = new Map();
  }
  async init() {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.initialize();
    try { await this.initializing; this.initialized = true; } finally { this.initializing = null; }
  }
  async initialize() {
    this.config = validateConfig(await readJSON(path.join(this.root, 'settings.json'), DEFAULT_CONFIG));
    let environmentModels = process.env.OLLAMA_MODELS;
    if (!environmentModels && process.platform === 'win32') environmentModels = await childTask('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$modelFolder = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'User'); if (!$modelFolder) { $modelFolder = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'Machine') }; $modelFolder"], { timeout: 10000 }).catch(() => '');
    this.discoveredDirectory = environmentModels && path.isAbsolute(environmentModels) ? environmentModels : path.join(os.homedir(), '.ollama', 'models');
    if (process.platform === 'win32') {
      const gpuData = await childTask('nvidia-smi.exe', ['--query-gpu=uuid,name,memory.total', '--format=csv,noheader,nounits'], { timeout: 6000 }).catch(() => '');
      this.hardware.gpus = gpuData.split('\n').map(line => line.split(',').map(value => value.trim())).filter(row => /^GPU-[a-fA-F0-9-]+$/.test(row[0]) && Number.isFinite(Number(row[2]))).map(([id, name, mb]) => ({ id, name, memory: Number(mb) * 1024 ** 2 }));
      if (!this.hardware.gpus.length) {
        const names = await childTask('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'], { timeout: 10000 }).catch(() => '');
        this.hardware.adapterNames = names.split('\n').map(value => value.trim()).filter(Boolean);
      }
    }
  }
  get directory() { return this.config.modelDirectory || this.discoveredDirectory || path.join(os.homedir(), '.ollama', 'models'); }
  emit(value) { const now = Date.now(), same = this.progress?.phase === value.phase; this.progress = { ...value, updatedAt: new Date(now).toISOString() }; if (same && Number.isFinite(value.completed) && now - (this.lastEmit || 0) < 150 && value.completed !== value.total) return; this.lastEmit = now; try { this.notify(this.progress); } catch {} }
  async runtime() {
    let portable = await readJSON(path.join(this.root, 'runtime.json'), null).catch(() => null);
    if (portable) {
      const relative = typeof portable.executable === 'string' && path.relative(path.resolve(this.root, 'runtimes'), path.resolve(portable.executable));
      if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep) || path.basename(portable.executable).toLowerCase() !== 'ollama.exe' || !(await fs.stat(portable.executable).catch(() => null))?.isFile()) portable = null;
    }
    const installed = await this.resolveExecutable().catch(() => null);
    return { portable, installed, chosen: this.config.runtimeMode === 'portable' ? portable?.executable : this.config.runtimeMode === 'installed' ? installed : portable?.executable || installed };
  }
  async status() {
    await this.init(); const runtime = await this.runtime(), discovered = await discoverModels(this.directory).catch(error => ({ models: [], warnings: [error.message] }));
    if (this.child && this.url) { try { this.loaded = (await this.json('api/ps', null, AbortSignal.timeout(2000))).models || []; } catch { this.loaded = []; } }
    return { config: this.config, modelDirectory: this.directory, discoveredDirectory: this.discoveredDirectory, managedDirectory: path.join(this.root, 'models'), runtime: { installed: Boolean(runtime.installed), portable: runtime.portable ? { version: runtime.portable.version, flavor: runtime.portable.flavor } : null, available: Boolean(runtime.chosen), source: runtime.chosen === runtime.portable?.executable ? 'portable' : runtime.chosen ? 'installed' : null }, running: Boolean(this.child && this.child.exitCode == null), progress: this.progress, busy: Boolean(this.job), error: this.error, hardware: { ...this.hardware, freeRam: os.freemem() }, loaded: this.loaded, ...discovered, catalog: CATALOG };
  }
  async configure(update) {
    await this.init(); if (this.job) throw new Error('Finish or cancel the current local-model operation first.');
    const next = validateConfig({ ...this.config, ...update });
    if (next.gpu !== 'auto' && next.gpu !== 'cpu' && !this.hardware.gpus.some(gpu => gpu.id === next.gpu)) throw new Error('That GPU is no longer available.');
    if (JSON.stringify(next) !== JSON.stringify(this.config)) { await this.stop(); await atomicWrite(path.join(this.root, 'settings.json'), JSON.stringify(next)); this.config = next; }
    return this.status();
  }
  async json(route, body, signal) {
    if (!this.url) throw new Error('The local engine is not running.');
    const response = await fetch(`${this.url}/${route}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal, redirect: 'error' });
    const text = await response.text(); if (text.length > 4 * 1024 ** 2) throw new Error('Oversized local-model response.');
    let value; try { value = JSON.parse(text); } catch { throw new Error('The local engine returned an invalid response.'); }
    if (!response.ok || value.error) throw new Error(friendlyError(value.error || `Local engine returned HTTP ${response.status}.`)); return value;
  }
  async start(signal) {
    await this.init(); signal?.throwIfAborted();
    if (this.child && this.child.exitCode == null && !this.starting) return this.url;
    if (this.starting) { await this.starting; signal?.throwIfAborted(); return this.url; }
    this.starting = (async () => {
      const runtime = await this.runtime(); if (!runtime.chosen) throw new Error('Install the portable engine in Settings → Local models, or select an installed Ollama engine.');
      const port = await freePort(); await fs.mkdir(this.directory, { recursive: true });
      this.error = ''; this.emit({ phase: 'starting', message: 'Starting local engine…' });
      let logs = ''; const child = this.spawnEngine(runtime.chosen, ['serve'], { env: engineEnvironment(this.config, this.directory, port), cwd: path.dirname(runtime.chosen), windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      this.child = child; this.url = `http://127.0.0.1:${port}`;
      child.stderr.on('data', data => { logs = (logs + data.toString()).slice(-12000); });
      child.on('error', error => { this.error = friendlyError(error); });
      child.once('close', () => { if (this.child === child) { this.child = null; this.url = ''; this.loaded = []; } });
      try {
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          signal?.throwIfAborted(); if (child.exitCode != null) throw new Error(friendlyError(logs.slice(-900) || 'The local engine stopped during startup.'));
          try { await this.json('api/version', null, AbortSignal.timeout(800)); this.emit({ phase: 'ready', message: 'Local engine ready.' }); return this.url; } catch {}
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error('The local engine did not become ready. Try restarting it in Local models.');
      } catch (error) { await this.stopChild(); throw error; }
    })();
    try { return await this.starting; } catch (error) { this.error = friendlyError(error); this.emit({ phase: 'error', message: this.error }); throw new Error(this.error); } finally { this.starting = null; }
  }
  async stopChild() {
    const child = this.child; this.child = null; this.url = ''; this.loaded = [];
    if (!child || child.exitCode != null) return;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 6000); child.once('close', () => { clearTimeout(timer); resolve(); });
      if (process.platform === 'win32' && child.pid) childTask(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { timeout: 5000 }).catch(() => child.kill()); else child.kill();
    });
  }
  async stop() { if (this.starting) await this.starting.catch(() => {}); await this.stopChild(); this.emit({ phase: 'idle', message: 'Local engine stopped. Models remain on disk.' }); }
  async withModel(settings, signal, run) {
    if (this.job) throw new Error('Finish or cancel the current local-model operation before generating text.');
    const model = validModel(settings.model); const url = await this.start(signal);
    const installed = (await this.json('api/tags', null, signal)).models || [];
    if (!installed.some(item => (item.name || item.model) === model)) throw new Error('This model is not downloaded. Add or download it in Local models first.');
    this.error = ''; this.emit({ phase: 'loading', message: `Loading ${model}…`, model });
    try {
      // Preload separately so the UI can distinguish GPU loading from generation.
      await this.json('api/generate', { model, stream: false, keep_alive: `${Math.max(1, this.config.idleMinutes)}m`, options: { num_ctx: this.config.contextLength, ...(this.config.gpu === 'cpu' ? { num_gpu: 0 } : {}) } }, signal);
      this.emit({ phase: 'generating', message: `Running ${model} locally…`, model });
      const result = await run({ ...settings, provider: 'ollama', baseUrl: url, localContextLength: this.config.contextLength, localCPU: this.config.gpu === 'cpu', ollamaKeepAlive: `${this.config.idleMinutes}m` });
      this.emit({ phase: 'ready', message: `${model} ready.`, model }); return result;
    } catch (error) { this.error = signal?.aborted ? '' : friendlyError(error); this.emit({ phase: signal?.aborted ? 'ready' : 'error', message: signal?.aborted ? 'Local request cancelled.' : this.error }); throw new Error(this.error || 'Local request cancelled.'); }
  }
  async unload(model) { await this.start(); await this.json('api/generate', { model: validModel(model), stream: false, keep_alive: 0 }, AbortSignal.timeout(30000)); return this.status(); }
  async operation(label, run) {
    if (this.job) throw new Error('Another local-model operation is still running.');
    const controller = new AbortController(); this.job = controller; this.error = ''; this.emit({ phase: 'working', message: label });
    let work; try { work = Promise.resolve(run(controller.signal)); } catch (error) { work = Promise.reject(error); } controller.finished = work.catch(() => {});
    try { const result = await work; this.emit({ phase: 'ready', message: 'Finished.' }); return result; }
    catch (error) { this.error = controller.signal.aborted ? '' : friendlyError(error); this.emit({ phase: controller.signal.aborted ? 'idle' : 'error', message: controller.signal.aborted ? 'Operation cancelled. Existing models and runtime were kept.' : this.error }); throw new Error(this.error || 'Operation cancelled.'); }
    finally { if (this.job === controller) this.job = null; }
  }
  async cancel() { const job = this.job; job?.abort(); await job?.finished; return this.status(); }
  async shutdown() { const job = this.job; job?.abort(); await job?.finished; await this.stop(); }
  async runtimeRelease(flavor = 'standard') { const info = await releaseInfo(flavor); this.releaseCache.set(flavor, info); return info; }
  async install(flavor = 'standard') { const info = this.releaseCache.get(flavor); if (!info) throw new Error('Check the engine download first to see its version and size.'); return this.operation('Preparing portable engine download…', async signal => { await this.stop(); return installRuntime(this.root, info, signal, progress => this.emit(progress)); }); }
  async catalogInfo(name) {
    name = validModel(name); const [repository, tag] = name.split(':');
    if (repository.includes('/') && repository.split('/')[0].includes('.')) throw new Error('The download catalog supports the public Ollama registry.');
    const route = repository.includes('/') ? repository : 'library/' + repository;
    const response = await fetch(`https://registry.ollama.ai/v2/${route}/manifests/${tag}`, { headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`Model information returned HTTP ${response.status}. Check the model name.`);
    const manifest = await response.json(); if (!Array.isArray(manifest.layers) || manifest.layers.length > 1000) throw new Error('Invalid model manifest.');
    const bytes = manifest.layers.reduce((sum, layer) => sum + (Number.isSafeInteger(layer.size) && layer.size > 0 ? layer.size : 0), 0);
    return { name, bytes, source: `https://ollama.com/${repository.includes('/') ? repository : 'library/' + repository.split(':')[0]}` };
  }
  async stream(route, body, signal) {
    const response = await fetch(`${this.url}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal, redirect: 'error' });
    if (!response.ok) throw new Error((await response.text()).slice(0, 800) || `Local model returned HTTP ${response.status}`);
    const last = await consumeJSONLines(response.body, value => this.emit({ phase: route === 'api/pull' ? 'downloading' : 'importing', message: value.status || 'Working…', completed: value.completed, total: value.total }), signal);
    if (last?.status !== 'success') throw new Error('The operation ended before the model was registered successfully.'); return last;
  }
  async pull(name) {
    name = validModel(name); const repository = name.split(':')[0]; if (repository.includes('/') && repository.split('/')[0].includes('.')) throw new Error('Use a model from the public Ollama registry.');
    return this.operation(`Downloading ${name}…`, async signal => {
      await this.start(signal);
      if ((await this.json('api/tags', null, signal)).models?.some(item => (item.name || item.model) === name)) throw new Error('That model is already installed. Existing models are not overwritten by Download.');
      await this.stream('api/pull', { model: name, stream: true }, signal); return this.status();
    });
  }
  async inspectGGUF(file) {
    const handle = await fs.open(file, 'r');
    try { const stat = await handle.stat(), header = Buffer.alloc(8); await handle.read(header, 0, 8, 0); if (!stat.isFile() || stat.size < 24 || stat.size > 300 * 1024 ** 3 || header.subarray(0, 4).toString() !== 'GGUF' || ![2, 3].includes(header.readUInt32LE(4))) throw new Error('Choose a supported GGUF v2/v3 model file.'); return { path: file, name: path.basename(file), bytes: stat.size, mtime: stat.mtimeMs }; } finally { await handle.close(); }
  }
  async importGGUF(file, name) {
    name = validModel(name);
    return this.operation(`Adding ${name}…`, async signal => {
      const source = await this.inspectGGUF(file); await this.start(signal);
      if ((await this.json('api/tags', null, signal)).models?.some(item => (item.name || item.model) === name)) throw new Error('That model name already exists. Choose another name to preserve it.');
      const digest = crypto.createHash('sha256'); let completed = 0;
      for await (const chunk of createReadStream(file, { signal })) { digest.update(chunk); completed += chunk.length; this.emit({ phase: 'hashing', message: 'Checking model file…', completed, total: source.bytes }); }
      const sha = 'sha256:' + digest.digest('hex');
      const response = await fetch(`${this.url}/api/blobs/${sha}`, { method: 'HEAD', signal, redirect: 'error' });
      if (response.status === 404) {
        this.emit({ phase: 'importing', message: 'Registering model data with the local engine…' });
        const uploaded = await fetch(`${this.url}/api/blobs/${sha}`, { method: 'POST', body: createReadStream(file, { signal }), duplex: 'half', signal, redirect: 'error' });
        if (!uploaded.ok) throw new Error((await uploaded.text()).slice(0, 800) || 'Could not register the model data.'); await uploaded.body?.cancel();
      } else if (!response.ok) throw new Error('Could not check the local model data.');
      const current = await fs.stat(file); if (current.size !== source.bytes || current.mtimeMs !== source.mtime) throw new Error('The model file changed during import. Try again.');
      await this.stream('api/create', { model: name, files: { [source.name]: sha }, stream: true }, signal); return this.status();
    });
  }
}
module.exports = { LocalModels, DEFAULT_CONFIG, CATALOG, validateConfig, validModel, discoverModels, engineEnvironment, consumeJSONLines, friendlyError };
