import { useEffect } from 'react';

export function reportTabSwitch(started, opening, stillCurrent) {
  const bridge = window.wraiter;
  if (!bridge?.logSlowTab || document.hidden) return;
  const installed = performance.now();
  // A completed native IPC does not mean the restored editor has painted.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (document.hidden || !stillCurrent()) return;
    const painted = performance.now();
    if (painted - started >= 1000) {
      bridge.logSlowTab(Math.round(opening - started), Math.round(installed - opening), Math.round(painted - installed));
    }
  }));
}

export function useLoggedSurface(kind, name) {
  useEffect(() => {
    if (!name) return;
    window.wraiter?.logSurface?.(kind, name, true);
    return () => window.wraiter?.logSurface?.(kind, name, false);
  }, [kind, name]);
}

const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError']);
const ERROR_CODES = new Set(['EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'ENOSPC', 'EIO', 'EBUSY', 'EMFILE', 'ENFILE', 'EROFS', 'ENOTDIR', 'EISDIR', 'EINVAL', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'ABORT_ERR', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE']);

function sourceStack(value) {
  if (typeof value !== 'string') return '';
  const locations = value.slice(0, 16000).split('\n').filter(line => /^\s+at\s/.test(line)).flatMap(line => {
    const location = line.match(/(?:[/\\])((?:electron|src|dist[/\\]assets)[/\\][a-zA-Z0-9_./\\-]+\.(?:cjs|mjs|js|jsx)):(\d+):(\d+)(?:\)?$)/)
      || line.match(/\b(node:[a-zA-Z0-9_/-]+):(\d+):(\d+)\)?$/);
    if (!location) return [];
    const file = location[1].replaceAll('\\', '/');
    return [`    at ${file.startsWith('node:') ? '' : '/'}${file}:${location[2]}:${location[3]}`];
  }).slice(0, 12);
  return locations.length ? '\n' + locations.join('\n') : '';
}

// Produce only fixed classifications and application source locations. Error
// messages can contain private document text, paths or provider credentials.
export function serializeError(error, context = {}) {
  const seen = new WeakSet();
  let remaining = 8;
  function serialize(value, depth, extra = {}) {
    if (depth >= 3 || remaining <= 0) return undefined;
    if (value && (typeof value === 'object' || typeof value === 'function')) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    remaining--;
    const message = typeof value === 'string' ? value.slice(0, 8000) : typeof value?.message === 'string' ? value.message.slice(0, 8000) : '';
    const result = {
      name: ERROR_NAMES.has(value?.name) ? value.name : 'Error',
      category: /abort|cancel/i.test(message) || value?.name === 'AbortError' ? 'cancelled'
        : /timed? ?out|timeout/i.test(message) || value?.name === 'TimeoutError' ? 'timeout'
          : /permission|access denied|not permitted/i.test(message) ? 'permission'
            : /network|fetch|connect|socket/i.test(message) ? 'connection'
              : /invalid|malformed|must be|out of range/i.test(message) ? 'validation' : 'other',
      stack: sourceStack(value?.stack),
    };
    if (ERROR_CODES.has(value?.code)) result.code = value.code;
    if (!result.stack && typeof extra.filename === 'string' && Number.isSafeInteger(extra.lineno) && extra.lineno > 0 && Number.isSafeInteger(extra.colno) && extra.colno >= 0) {
      result.stack = sourceStack(`    at ${extra.filename}:${extra.lineno}:${extra.colno}`);
    }
    const componentStack = sourceStack(extra.componentStack);
    if (componentStack) result.componentStack = componentStack;
    if (value?.cause !== undefined) {
      const cause = serialize(value.cause, depth + 1);
      if (cause) result.cause = cause;
    }
    if (Array.isArray(value?.errors)) {
      const errors = value.errors.slice(0, 3).map(item => serialize(item, depth + 1)).filter(Boolean);
      if (errors.length) result.errors = errors;
    }
    return result;
  }
  try { return serialize(error, 0, context); }
  catch { return { name: 'Error', category: 'other', stack: '' }; }
}

export function reportError(source, error, context = {}) {
  try {
    // The main process filters this further; never send arbitrary error objects,
    // manuscript payloads or messages across the diagnostics bridge.
    window.wraiter?.reportError?.(source, serializeError(error, context));
  } catch { /* Diagnostics must never interrupt writing. */ }
}
