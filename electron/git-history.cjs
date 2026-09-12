const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { hash, validateProject, atomicWrite, readLimited } = require('./core.cjs');

const execute = promisify(execFile);
// A private repository for each manuscript avoids touching the author's folders or Git identity.
// No remotes, hooks, credentials, inherited Git directory overrides, or shell commands are used.
function gitEnvironment(directory) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(directory, 'no-global-config'), GIT_TERMINAL_PROMPT: '0' };
}
function textOf(node) {
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(textOf).join(['doc', 'blockquote', 'listItem', 'bulletList', 'orderedList'].includes(node.type) ? '\n' : '');
}
function contentFingerprint(project) {
  const { updatedAt, snapshots, ...content } = project;
  return hash(JSON.stringify(content));
}
class GitHistory {
  constructor(directory, options = {}) {
    this.directory = path.join(path.resolve(directory), 'Git history');
    this.executable = options.executable || 'git';
    this.debounce = options.debounce ?? 20000;
    this.queue = Promise.resolve(); this.pending = new Map(); this.initialized = new Set(); this.lastHashes = new Map(); this.lastError = '';
  }
  repository(id) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Invalid manuscript identifier.');
    return path.join(this.directory, hash(id));
  }
  async run(directory, args) {
    try {
      const result = await execute(this.executable, ['-c', 'core.hooksPath=' + path.join(this.directory, 'disabled-hooks'), '-c', 'commit.gpgsign=false', ...args], { cwd: directory, env: gitEnvironment(this.directory), windowsHide: true, timeout: 45000, maxBuffer: 75 * 1024 * 1024, encoding: 'utf8' });
      return result.stdout;
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Git is not installed or is unavailable on PATH. Saving and recovery still work.');
      throw new Error(String(error.stderr || error.message).trim().slice(0, 1200));
    }
  }
  serialize(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(error => { this.lastError = error.message; });
    return result;
  }
  async initialize(id) {
    const directory = this.repository(id);
    if (this.initialized.has(id)) return directory;
    await fs.mkdir(directory, { recursive: true });
    await fs.mkdir(path.join(this.directory, 'disabled-hooks'), { recursive: true });
    await this.run(directory, ['init', '--quiet']);
    try {
      const previous = JSON.parse(await this.run(directory, ['show', 'HEAD:manuscript.json']));
      this.lastHashes.set(id, contentFingerprint(validateProject(previous)));
    } catch (error) { if (error.code !== 'ENOENT') this.lastHashes.delete(id); }
    this.initialized.add(id);
    return directory;
  }
  record(project, label = 'Saved manuscript', explicit = false) {
    validateProject(project);
    const snapshot = structuredClone(project);
    const waiting = this.pending.get(snapshot.id);
    if (waiting) { clearTimeout(waiting.timer); this.pending.delete(snapshot.id); }
    return this.serialize(async () => {
      const directory = await this.initialize(snapshot.id);
      const fingerprint = contentFingerprint(snapshot);
      if (!explicit && this.lastHashes.get(snapshot.id) === fingerprint) return { committed: false };
      await atomicWrite(path.join(directory, 'manuscript.json'), JSON.stringify(snapshot, null, 2) + '\n');
      // This companion is deliberately readable in ordinary git diff/log tools.
      const plain = [snapshot.title, ...snapshot.chapters.flatMap(chapter => ['\n# ' + chapter.title, textOf(chapter.content)])].join('\n') + '\n';
      await atomicWrite(path.join(directory, 'manuscript.txt'), plain);
      await this.run(directory, ['add', '--', 'manuscript.json', 'manuscript.txt']);
      const message = String(label || 'Saved manuscript').replace(/[\r\n\x00-\x1f]+/g, ' ').trim().slice(0, 500) || 'Saved manuscript';
      await this.run(directory, ['-c', 'user.name=WRAITER', '-c', 'user.email=history@wraiter.local', 'commit', '--quiet', '--allow-empty', '-m', message, '--', 'manuscript.json', 'manuscript.txt']);
      this.lastHashes.set(snapshot.id, fingerprint); this.lastError = '';
      return { committed: true, revision: (await this.run(directory, ['rev-parse', 'HEAD'])).trim() };
    });
  }
  schedule(project) {
    validateProject(project);
    const previous = this.pending.get(project.id);
    if (previous) clearTimeout(previous.timer);
    const started = previous?.started || Date.now();
    const item = { project: structuredClone(project), started, timer: null };
    const delay = Math.min(this.debounce, Math.max(0, 120000 - (Date.now() - started)));
    item.timer = setTimeout(() => { this.pending.delete(project.id); this.record(item.project, 'Automatic checkpoint').catch(() => {}); }, delay);
    item.timer.unref?.();
    this.pending.set(project.id, item);
  }
  async flush(id) {
    const items = [...this.pending.entries()].filter(([key]) => !id || key === id);
    for (const [key, item] of items) {
      clearTimeout(item.timer); this.pending.delete(key);
      await this.record(item.project, 'Automatic checkpoint').catch(() => {});
    }
    await this.queue;
  }
  async list(id) {
    await this.flush(id);
    return this.serialize(async () => {
      try {
        const directory = await this.initialize(id);
        const output = await this.run(directory, ['log', '-150', '--format=%H%x00%aI%x00%s%x00']);
        const fields = output.split('\0'); const entries = [];
        for (let i = 0; i + 2 < fields.length; i += 3) entries.push({ revision: fields[i].trim(), date: fields[i + 1], message: fields[i + 2] });
        return { available: true, entries, repository: directory, error: this.lastError || undefined };
      } catch (error) {
        if (/does not have any commits yet|bad default revision|unknown revision/i.test(error.message)) return { available: true, entries: [], repository: this.repository(id) };
        return { available: false, entries: [], error: error.message };
      }
    });
  }
  async revision(id, revision) {
    if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid Git revision.');
    await this.queue;
    const directory = await this.initialize(id);
    const value = JSON.parse(await this.run(directory, ['show', `${revision}:manuscript.json`]));
    validateProject(value);
    if (value.id !== id) throw new Error('This revision belongs to a different manuscript.');
    return value;
  }
}
module.exports = { GitHistory, contentFingerprint, gitEnvironment, textOf };
