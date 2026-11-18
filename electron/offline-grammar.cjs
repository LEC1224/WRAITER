const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

function validateOfflineGrammarRequest(request) {
  if (!request || typeof request !== 'object' || !/^(?:en|sv)(?:-|$)/i.test(request.language || '') || typeof request.language !== 'string' || request.language.length > 32 ||
      !Array.isArray(request.texts) || !request.texts.length || request.texts.length > 16 ||
      request.texts.some(text => typeof text !== 'string' || text.length > 3500) || request.texts.reduce((sum, text) => sum + text.length, 0) > 12000) {
    throw new Error('Invalid local grammar request.');
  }
  return { language: request.language, texts: request.texts };
}

// A single process per app receives bounded passages on stdin and replies on
// stdout. The bundled Java bridge disables all sockets before loading rules.
class OfflineGrammar {
  constructor(directory, { spawnProcess = spawn, timeout = 120000, idleTimeout = 120000 } = {}) {
    this.directory = directory; this.spawnProcess = spawnProcess; this.timeout = timeout; this.idleTimeout = idleTimeout;
    this.child = null; this.nextId = 0; this.pending = new Map(); this.idleTimer = null;
  }
  start() {
    if (this.child) return this.child;
    const executable = path.join(this.directory, 'runtime', 'bin', 'java.exe');
    const bridge = path.join(this.directory, 'WraiterGrammar.jar');
    if (!fs.existsSync(executable) || !fs.existsSync(bridge)) throw new Error('The bundled grammar engine is unavailable.');
    const environment = { ...process.env };
    // Prevent machine-specific Java options from changing the local process.
    for (const key of Object.keys(environment)) if (/^(?:JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH)$/i.test(key)) delete environment[key];
    const child = this.spawnProcess(executable, ['-Djava.security.manager=allow', '-XX:+UseSerialGC', '-Xms16m', '-Xmx256m', '-cp', `${bridge}${path.delimiter}${path.join(this.directory, 'lib', '*')}`, 'WraiterGrammar'],
      { windowsHide: true, cwd: this.directory, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    // Runtime diagnostics can contain text from a rule. Do not copy them to
    // WRAITER logs; failures are surfaced as a generic local-engine error.
    child.stderr?.on('data', () => {});
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (this.child !== child) return;
      if (line.length > 2_000_000) return this.fail(child, 'The local grammar engine returned an oversized result.');
      let result;
      try { result = JSON.parse(line); } catch { return this.fail(child, 'The local grammar engine returned an invalid result.'); }
      const pending = this.pending.get(result?.id);
      if (!pending) return;
      this.pending.delete(result.id); clearTimeout(pending.timer);
      if (result.error) pending.reject(new Error('The local grammar engine could not check this passage.'));
      else if (!Array.isArray(result.results) || result.results.length !== pending.count) pending.reject(new Error('The local grammar engine returned an invalid result.'));
      else pending.resolve(result.results);
      this.scheduleIdle();
    });
    child.on('error', () => this.fail(child, 'The local grammar engine could not start.'));
    child.on('exit', () => this.fail(child, 'The local grammar engine stopped.'));
    child.stdin.on('error', () => this.fail(child, 'The local grammar engine stopped.'));
    return child;
  }
  fail(child, message) {
    if (this.child !== child) return;
    this.child = null; clearTimeout(this.idleTimer); this.idleTimer = null;
    try { child.kill(); } catch { /* Already stopped. */ }
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
  }
  scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.pending.size && this.child) this.idleTimer = setTimeout(() => this.stop(), this.idleTimeout);
    this.idleTimer?.unref?.();
  }
  async check(request) {
    const valid = validateOfflineGrammarRequest(request);
    if (this.pending.size >= 32) throw new Error('The local grammar engine is busy.');
    clearTimeout(this.idleTimer); this.idleTimer = null;
    const child = this.start(), id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(child, 'The local grammar engine timed out.'), this.timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, count: valid.texts.length });
      try { child.stdin.write(JSON.stringify({ id, ...valid }) + '\n'); }
      catch { this.fail(child, 'The local grammar engine stopped.'); }
    });
  }
  stop() {
    clearTimeout(this.idleTimer); this.idleTimer = null;
    if (this.child) this.fail(this.child, 'The local grammar engine stopped.');
  }
}

module.exports = { OfflineGrammar, validateOfflineGrammarRequest };
