const fs = require('node:fs/promises');
const path = require('node:path');
const { LOG_NAME, REPORT_NAME } = require('./diagnostics.cjs');

const LIMIT = 65536;
async function collectDiagnostics(log) {
  log.ensureDirectory();
  const cutoff = Date.now() - 7 * 86400000;
  const entries = await fs.readdir(log.directory, { withFileTypes: true });
  const recent = [];
  for (const entry of entries) {
    if (!entry.isFile() || !(LOG_NAME.test(entry.name) || REPORT_NAME.test(entry.name))) continue;
    const file = path.join(log.directory, entry.name);
    const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat?.isFile() && stat.mtimeMs >= cutoff) recent.push({ name: entry.name, file, modified: stat.mtimeMs });
  }
  recent.sort((a,b) => b.modified-a.modified);
  const files = [], lines = [];
  let reports = 0, logBytes = 0;
  for (const entry of recent) {
    const report = REPORT_NAME.test(entry.name);
    if (report ? reports >= 3 : logBytes >= LIMIT-1) continue;
    const handle = await fs.open(entry.file, 'r').catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!handle) continue;
    try {
      const { size } = await handle.stat();
      if (report) {
        if (size > LIMIT) continue;
        const text = await handle.readFile('utf8');
        if (text && Buffer.byteLength(text) <= LIMIT) files.push({ name: `crash-report-${++reports}.json`, text });
      } else {
        const len = Math.min(size, LIMIT-logBytes), buffer = Buffer.alloc(len);
        const { bytesRead } = await handle.read(buffer, 0, len, size-len);
        let text = buffer.toString('utf8',0,bytesRead);
        if (size > len) text = text.includes('\n') ? text.slice(text.indexOf('\n')+1) : '';
        if (text) { lines.unshift(text); logBytes += Buffer.byteLength(text); }
      }
    } finally { await handle.close(); }
  }
  if (lines.length) files.unshift({ name: 'recent-logs.jsonl', text: lines.join('') });
  return files;
}
module.exports = { collectDiagnostics };
