const { parentPort, workerData } = require('node:worker_threads');
const { NeuralGrammarEngine } = require('./neural-grammar-engine.cjs');
const engine = new NeuralGrammarEngine(workerData.directory);
let previous = Promise.resolve();
let stopping = false;
parentPort.on('message', request => {
  if (request?.type === 'shutdown') {
    if (stopping) return;
    stopping = true;
    previous.finally(async () => {
      try { await engine.close(); } finally { parentPort.close(); }
    }).catch(() => {});
    return;
  }
  if (stopping) return;
  previous = previous.catch(() => {}).then(async () => {
    if (stopping) return;
    try {
      const results = [];
      for (const text of request.texts) {
        if (stopping) return;
        results.push(await engine.check(text, () => stopping));
      }
      if (!stopping) parentPort.postMessage({ id: request.id, results });
    } catch { if (!stopping) parentPort.postMessage({ id: request.id, error: true }); }
  });
});
