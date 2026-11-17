// Both backends serialize expensive work. Keep their queues in the renderer
// so closing a tab can withdraw its passages before they enter a worker or IPC.
export function passageQueue() {
  const queued = new Set();
  let running = false;
  function next() {
    if (running || !queued.size) return;
    const job = queued.values().next().value;
    queued.delete(job); running = true;
    job.signal?.removeEventListener('abort', job.cancel);
    Promise.resolve().then(() => {
      job.signal?.throwIfAborted();
      return job.check();
    }).then(job.resolve, job.reject).finally(() => { running = false; next(); });
  }
  return (signal, check) => new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const job = { signal, check, resolve, reject, cancel() { queued.delete(job); reject(signal.reason); } };
    queued.add(job); signal?.addEventListener('abort', job.cancel, { once: true });
    next();
  });
}
