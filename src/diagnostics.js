import { useEffect } from 'react';

export function useLoggedSurface(kind, name) {
  useEffect(() => {
    if (!name) return;
    window.wraiter?.logSurface?.(kind, name, true);
    return () => window.wraiter?.logSurface?.(kind, name, false);
  }, [kind, name]);
}

export function reportError(source, error) {
  try {
    // The main process filters this further; never send arbitrary error objects,
    // manuscript payloads or messages across the diagnostics bridge.
    window.wraiter?.reportError?.(source, {
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : undefined,
      stack: typeof error?.stack === 'string' ? '\n' + error.stack.split('\n').slice(1).join('\n').slice(0, 16000) : '',
    });
  } catch { /* Diagnostics must never interrupt writing. */ }
}
