import { serializeError } from '../diagnostics.js';

let records = [];
function record(event, error) {
  records.push({ time: new Date().toISOString(), event, ...(error && { error }) });
  if (records.length > 30) records.shift();
}
export function startSuggestionDiagnostics() {
  records = [];
  record('browser.session-started');
  const onError = e => record('browser.error', serializeError(e.error, e));
  const onRejection = e => record('browser.unhandled-rejection', serializeError(e.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    records = [];
  };
}
export function recordEditorCrash(error) { record('browser.editor-crash', serializeError(error)); }
export function browserAttachments() {
  const lines = records.map(item => JSON.stringify(item));
  while (lines.length && new Blob(lines).size + lines.length > 65536) lines.shift();
  return lines.length ? [{ name: 'browser-errors.jsonl', text: lines.join('\n') + '\n' }] : [];
}
