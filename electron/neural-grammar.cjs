const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { validateOfflineGrammarRequest } = require('./offline-grammar.cjs');

// Native inference stays off the Electron event loop. A shared worker bounds
// CPU and memory across all editors. Only the parent supplies text; the model
// and tokenizer are read from the installed resources without any fetch.
class NeuralGrammar {
  constructor(directory, { WorkerClass = Worker, timeout = 30000, idleTimeout = 120000, shutdownTimeout = 10000 } = {}) {
    Object.assign(this, { directory, WorkerClass, timeout, idleTimeout, shutdownTimeout });
    this.nextId = 0; this.pending = new Map(); this.worker = null; this.workers = new Map(); this.closed = false;
  }
  start() {
    if (this.worker) return this.worker;
    if (this.workers.size) throw new Error('The neural grammar model is stopping.');
    const worker = new this.WorkerClass(path.join(__dirname, 'neural-grammar-worker.cjs'), { workerData: { directory: this.directory } });
    this.worker = worker;
    let resolveExit;
    const record = { exited: new Promise(resolve => { resolveExit = resolve; }) };
    this.workers.set(worker, record);
    worker.on('message', response => {
      if (this.worker !== worker) return;
      const pending = this.pending.get(response?.id);
      if (!pending) return;
      this.pending.delete(response.id); clearTimeout(pending.timer);
      if (response.error || !Array.isArray(response.results) || response.results.length !== pending.count)
        pending.reject(new Error('The neural grammar model could not check this passage.'));
      else pending.resolve(response.results);
      if (!this.pending.size) {
        this.idleTimer = setTimeout(() => this.stop(), this.idleTimeout);
        this.idleTimer.unref?.();
      }
    });
    worker.on('error', () => this.fail(worker, true));
    worker.on('exit', () => {
      this.workers.delete(worker); resolveExit(true); this.fail(worker, true);
    });
    return worker;
  }
  retire(worker, exiting = false) {
    const record = this.workers.get(worker);
    if (!record) return Promise.resolve(true);
    if (!record.stopping) {
      // Terminating a worker inside ONNX native initialization/inference can
      // crash or deadlock the whole app. Drain it and release the session first.
      if (!exiting) {
        try { worker.postMessage({ type: 'shutdown' }); } catch { /* Exit may already be queued. */ }
      }
      record.stopping = new Promise(resolve => {
        const timer = setTimeout(() => { worker.unref?.(); resolve(false); }, this.shutdownTimeout);
        record.exited.then(() => { clearTimeout(timer); resolve(true); });
      });
    }
    return record.stopping;
  }
  fail(worker, exiting = false) {
    if (this.worker !== worker) return;
    this.worker = null; clearTimeout(this.idleTimer);
    this.retire(worker, exiting);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The neural grammar model stopped.'));
    }
    this.pending.clear();
  }
  check(request) {
    const { texts, language } = validateOfflineGrammarRequest(request);
    if (this.closed) return Promise.reject(new Error('The neural grammar model is closed.'));
    if (!/^en(?:-|$)/iu.test(language)) return Promise.resolve(texts.map(() => []));
    if (this.pending.size >= 32) return Promise.reject(new Error('The neural grammar model is busy.'));
    clearTimeout(this.idleTimer);
    let worker;
    try { worker = this.start(); } catch (error) { return Promise.reject(error); }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(worker), this.timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, count: texts.length });
      try { worker.postMessage({ id, texts }); } catch { this.fail(worker); }
    });
  }
  stop({ permanent = false } = {}) {
    if (permanent) this.closed = true;
    clearTimeout(this.idleTimer);
    if (this.worker) this.fail(this.worker);
    return Promise.all([...this.workers.keys()].map(worker => this.retire(worker))).then(results => results.every(Boolean));
  }
}
module.exports = { NeuralGrammar };
