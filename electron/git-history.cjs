const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { hash, validatedProjectJSON, validateProject, atomicWrite, readLimited } = require('./core.cjs');

const execute = promisify(execFile);
const gitIdentity = ['-c', 'user.name=WRAITER', '-c', 'user.email=history@wraiter.local'];
const validRevision = revision => typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision);
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
function manuscriptText(project) {
  return [project.title, ...project.chapters.flatMap(chapter => ['\n# ' + chapter.title, textOf(chapter.content)])].join('\n') + '\n';
}
function contentFingerprint(project) {
  const { updatedAt, snapshots, chats, activeChatId, historySequence, binding, fileBinding, nativeBinding, ...content } = project;
  return hash(JSON.stringify(content, (key, value) => key === 'pageBreakBefore' && value == null ? undefined : value));
}
function structureOf(node) {
  if (!node || node.type === 'text') return '';
  return `${node.type}(${(node.content || []).filter(child => child.type !== 'text').map(structureOf).join(',')})`;
}
function changedWords(before, after) {
  const words = text => text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
  const previous = words(before), current = words(after);
  let start = 0, endBefore = previous.length, endAfter = current.length;
  while (start < endBefore && start < endAfter && previous[start] === current[start]) start++;
  while (endBefore > start && endAfter > start && previous[endBefore - 1] === current[endAfter - 1]) { endBefore--; endAfter--; }
  return Math.max(endBefore - start, endAfter - start);
}
// The edit journal preserves every change. Git checkpoints mark substantial
// writing progress or a new structure, so a pause after one letter is not a version.
function shouldCheckpoint(before, after, minimumWords = 40) {
  if (!before) return true;
  if (contentFingerprint(before) === contentFingerprint(after)) return false;
  const metadata = project => {
    const { chapters, updatedAt, snapshots, chats, activeChatId, historySequence, binding, fileBinding, nativeBinding, ...rest } = project;
    return rest;
  };
  if (JSON.stringify(metadata(before)) !== JSON.stringify(metadata(after)) || before.chapters.length !== after.chapters.length) return true;
  if (before.chapters.some((chapter, index) => {
    const next = after.chapters[index];
    if (chapter.id !== next?.id || structureOf(chapter.content) !== structureOf(next?.content)) return true;
    const { content: _old, ...earlierFields } = chapter, { content: _new, ...laterFields } = next;
    return JSON.stringify(earlierFields) !== JSON.stringify(laterFields);
  })) return true;
  const previous = before.chapters.map(chapter => textOf(chapter.content)).join('\n'), current = after.chapters.map(chapter => textOf(chapter.content)).join('\n');
  return changedWords(previous, current) >= minimumWords;
}
class GitHistory {
  constructor(directory, options = {}) {
    this.directory = path.join(path.resolve(directory), 'Git history');
    this.executable = options.executable || 'git';
    this.debounce = options.debounce ?? 20000;
    this.onCheckpoint = options.onCheckpoint;
    this.hasMergeEvent = options.hasMergeEvent;
    this.unfinishedMerges = new Set();
    this.queue = Promise.resolve(); this.pending = new Map(); this.initialized = new Set(); this.lastHashes = new Map(); this.lastProjects = new Map(); this.lastError = '';
  }
  repository(id) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Invalid manuscript identifier.');
    return path.join(this.directory, hash(id));
  }
  async run(directory, args, input) {
    try {
      const work = execute(this.executable, ['-c', 'core.hooksPath=' + path.join(this.directory, 'disabled-hooks'), '-c', 'commit.gpgsign=false', ...args], { cwd: directory, env: gitEnvironment(this.directory), windowsHide: true, timeout: 45000, maxBuffer: 75 * 1024 * 1024, encoding: 'utf8' });
      if (input !== undefined) {
        work.child.stdin.on('error', () => {}); // The process error below reports a failed or interrupted Git command.
        work.child.stdin.end(input);
      }
      const result = await work;
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
    if (this.initialized.has(id) && !this.unfinishedMerges.has(id)) return directory;
    await fs.mkdir(directory, { recursive: true });
    await fs.mkdir(path.join(this.directory, 'disabled-hooks'), { recursive: true });
    await this.run(directory, ['init', '--quiet']);
    await this.finishPendingMerge(id, directory);
    try {
      const previous = JSON.parse(await this.run(directory, ['show', 'HEAD:manuscript.json']));
      validateProject(previous);
      this.lastHashes.set(id, contentFingerprint(previous)); this.lastProjects.set(id, previous);
    } catch (error) { if (error.code !== 'ENOENT') { this.lastHashes.delete(id); this.lastProjects.delete(id); } }
    this.initialized.add(id);
    return directory;
  }
  record(project, label = 'Saved manuscript', explicit = false, options = {}) {
    const serialized = validatedProjectJSON(project);
    return this.#recordSnapshot(project.id, serialized, label, explicit, options);
  }
  #recordSnapshot(id, serialized, label, explicit, options) {
    const waiting = this.pending.get(id);
    if (waiting) { clearTimeout(waiting.timer); this.pending.delete(id); }
    let snapshot;
    const operation = this.serialize(async () => {
      const directory = await this.initialize(id);
      snapshot = JSON.parse(serialized);
      const fingerprint = contentFingerprint(snapshot);
      const before = this.lastProjects.get(snapshot.id) || null;
      if (!explicit && this.lastHashes.get(snapshot.id) === fingerprint) return { committed: false };
      if (options.automatic && !shouldCheckpoint(before, snapshot)) return { committed: false, belowThreshold: true };
      await this.stageSnapshot(directory, snapshot, serialized);
      const message = String(label || 'Saved manuscript').replace(/[\r\n\x00-\x1f]+/g, ' ').trim().slice(0, 500) || 'Saved manuscript';
      await this.run(directory, [...gitIdentity, 'commit', '--quiet', '--allow-empty', '-m', message, '--', 'manuscript.json', 'manuscript.txt']);
      this.lastHashes.set(snapshot.id, fingerprint); this.lastProjects.set(snapshot.id, snapshot); this.lastError = '';
      return { committed: true, revision: (await this.run(directory, ['rev-parse', 'HEAD'])).trim(), before };
    });
    if (!options.automatic || typeof this.onCheckpoint !== 'function') return operation;
    return operation.then(result => {
      if (result.committed) Promise.resolve().then(() => this.onCheckpoint({ id: snapshot.id, before: result.before, after: snapshot, revision: result.revision, label, automatic: true })).catch(error => { this.lastError = String(error?.message || error); });
      return result;
    });
  }
  schedule(project, serialized = validatedProjectJSON(project)) {
    // The validated JSON is immutable. Typing again before the debounce ends
    // just replaces it; no editor-sized clone or parse runs on the save path.
    const id = project.id, previous = this.pending.get(id);
    if (previous) clearTimeout(previous.timer);
    const started = previous?.started || Date.now();
    const record = () => this.#recordSnapshot(id, serialized, 'Automatic checkpoint', false, { automatic: true });
    const item = { record, started, timer: null };
    const delay = Math.min(this.debounce, Math.max(0, 120000 - (Date.now() - started)));
    item.timer = setTimeout(() => record().catch(() => {}), delay);
    item.timer.unref?.();
    this.pending.set(id, item);
  }
  async flush(id) {
    const items = [...this.pending.entries()].filter(([key]) => !id || key === id);
    // Take every pending snapshot before yielding. A new save during the
    // flush must remain queued, even when it belongs to a later tab.
    await Promise.all(items.map(([, item]) => item.record().catch(() => {})));
    await this.queue;
  }
  async list(id) {
    await this.flush(id);
    return this.serialize(async () => {
      try {
        const directory = await this.initialize(id);
        const output = await this.run(directory, ['log', '--all', '--format=%H%x00%P%x00%aI%x00%s%x00']);
        const fields = output.split('\0'); const entries = [];
        for (let i = 0; i + 3 < fields.length; i += 4) {
          const revision = fields[i].trim(), parents = fields[i + 1].trim().split(/\s+/).filter(Boolean);
          if (/^[a-f0-9]{40}$/.test(revision)) entries.push({ revision, parentRevision: parents[0] || null, parentRevisions: parents, date: fields[i + 2], message: fields[i + 3].trim() });
        }
        const branchOutput = await this.run(directory, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00', 'refs/heads']);
        const branchFields = branchOutput.split('\0'), branches = [];
        for (let i = 0; i + 1 < branchFields.length; i += 2) {
          const name = branchFields[i].trim(), revision = branchFields[i + 1].trim();
          if (name && /^[a-f0-9]{40}$/.test(revision)) branches.push({ name, revision });
        }
        let labels = {}, labelError = '';
        try { labels = await this.readLabels(directory); }
        catch (error) { labelError = `Checkpoint labels could not be read: ${error.message}`; }
        const branchNames = new Map();
        for (const branch of branches) branchNames.set(branch.revision, [...(branchNames.get(branch.revision) || []), branch.name]);
        for (const entry of entries) Object.assign(entry, labels[entry.revision] || {}, { branchNames: branchNames.get(entry.revision) || [] });
        const headRevision = (await this.run(directory, ['rev-parse', 'HEAD'])).trim();
        const currentBranch = (await this.run(directory, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
        return { available: true, entries, branches, headRevision, currentBranch, repository: directory, error: labelError || this.lastError || undefined };
      } catch (error) {
        if (/does not have any commits yet|bad default revision|unknown revision/i.test(error.message)) return { available: true, entries: [], repository: this.repository(id) };
        return { available: false, entries: [], error: error.message };
      }
    });
  }
  async revision(id, revision) {
    await this.queue;
    const directory = await this.initialize(id);
    return this.readRevision(directory, id, revision);
  }
  async readRevision(directory, id, revision) {
    if (!validRevision(revision)) throw new Error('Invalid Git revision.');
    const value = JSON.parse(await this.run(directory, ['show', `${revision}:manuscript.json`]));
    validateProject(value);
    if (value.id !== id) throw new Error('This revision belongs to a different manuscript.');
    return value;
  }
  async stageSnapshot(directory, snapshot, serialized = validatedProjectJSON(snapshot)) {
    await atomicWrite(path.join(directory, 'manuscript.json'), serialized + '\n');
    await atomicWrite(path.join(directory, 'manuscript.txt'), manuscriptText(snapshot));
    await this.run(directory, ['add', '--', 'manuscript.json', 'manuscript.txt']);
  }
  async mergeContext(directory, sourceRevision) {
    if (!validRevision(sourceRevision)) throw new Error('Choose a saved version to merge.');
    const headRevision = (await this.run(directory, ['rev-parse', 'HEAD'])).trim();
    const branch = (await this.run(directory, ['symbolic-ref', 'HEAD'])).trim();
    const base = (await this.run(directory, ['merge-base', '--all', headRevision, sourceRevision])).trim().split(/\s+/);
    if (base.includes(sourceRevision)) throw new Error('That version is already included in the current path.');
    if (base.length !== 1 || !validRevision(base[0])) throw new Error('These versions need a single common starting checkpoint.');
    return { headRevision, sourceRevision, branch, baseRevision: base[0] };
  }
  async prepareMerge(id, sourceRevision) {
    await this.flush(id);
    return this.serialize(async () => {
      const directory = await this.initialize(id), context = await this.mergeContext(directory, sourceRevision);
      const base = await this.readRevision(directory, id, context.baseRevision);
      const source = await this.readRevision(directory, id, sourceRevision);
      return { ...context, base, source };
    });
  }
  async finishPendingMerge(id, directory, confirmed = false) {
    const file = path.join(directory, '.git', 'wraiter-pending-merge.json');
    let marker;
    try { marker = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const { branch, headRevision, revision, event } = marker;
    if (!validRevision(headRevision) || !validRevision(revision) || typeof branch !== 'string' || !branch.startsWith('refs/heads/')) throw new Error('The pending merge record is unreadable.');
    const actual = (await this.run(directory, ['rev-parse', branch])).trim();
    if (actual !== headRevision && actual !== revision) throw new Error('The branch changed while completing its merge.');
    if (actual !== revision && event && !confirmed && !this.hasMergeEvent) throw new Error('Open this manuscript in WRAITER to finish checking its merge against the editing journal.');
    if (actual === revision || confirmed || !event || await this.hasMergeEvent(id, event)) {
      if (actual !== revision) await this.run(directory, ['update-ref', branch, revision, headRevision]);
      if ((await this.run(directory, ['symbolic-ref', 'HEAD'])).trim() === branch) await this.run(directory, ['restore', '--source=' + revision, '--staged', '--worktree', '--', 'manuscript.json', 'manuscript.txt']);
    }
    await fs.unlink(file);
    this.unfinishedMerges.delete(id);
  }
  async commitMerge(target, merged, expected, label, event, appendEvent) {
    if (target.id !== merged.id) throw new Error('The manuscript changed. Review the merge again.');
    const serialized = validatedProjectJSON(merged), id = target.id;
    await this.flush(id);
    return this.serialize(async () => {
      const directory = await this.initialize(id);
      const context = await this.mergeContext(directory, expected.sourceRevision);
      if (['headRevision', 'branch', 'baseRevision'].some(key => context[key] !== expected[key])) throw new Error('The current path changed. Review the merge again.');
      const commit = async (snapshot, parents, message, json) => {
        // Build detached objects. A crash during preparation cannot leave a
        // partially staged file or dirty checkout on the author's current path.
        const blob = async data => (await this.run(directory, ['hash-object', '-w', '--stdin'], data)).trim();
        const manuscript = await blob((json || validatedProjectJSON(snapshot)) + '\n'), plain = await blob(manuscriptText(snapshot));
        const tree = (await this.run(directory, ['mktree'], '100644 blob ' + manuscript + '\tmanuscript.json\n100644 blob ' + plain + '\tmanuscript.txt\n')).trim();
        return (await this.run(directory, [...gitIdentity, 'commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', message])).trim();
      };
      let first = context.headRevision;
      if (this.lastHashes.get(id) !== contentFingerprint(target)) first = await commit(target, [first], 'Draft before merge');
      const revision = await commit(merged, [first, context.sourceRevision], label, serialized);
      const marker = { branch: context.branch, headRevision: context.headRevision, revision, event: event && { sequence: event.sequence, id: event.entry.id } };
      await atomicWrite(path.join(directory, '.git', 'wraiter-pending-merge.json'), JSON.stringify(marker));
      this.unfinishedMerges.add(id);
      // The fsynced undo event is the decision point. After an interruption
      // initialization finishes the same ref update or restores the old index.
      if (event) await appendEvent(event);
      await this.finishPendingMerge(id, directory, true);
      this.lastProjects.set(id, merged); this.lastHashes.set(id, contentFingerprint(merged)); this.lastError = '';
      return { revision, parentRevisions: [first, context.sourceRevision] };
    });
  }
  // Selecting an older point creates a new named branch. The old branch tip
  // remains reachable, including when the app closes before any new edit.
  async activateRevision(id, revision) {
    await this.flush(id);
    return this.serialize(async () => {
      const directory = await this.initialize(id);
      if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid Git revision.');
      const selected = JSON.parse(await this.run(directory, ['show', `${revision}:manuscript.json`]));
      validateProject(selected);
      if (selected.id !== id) throw new Error('This revision belongs to a different manuscript.');
      const name = `wraiter/branch-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      await this.run(directory, ['checkout', '--quiet', '-b', name, revision]);
      this.lastProjects.set(id, selected); this.lastHashes.set(id, contentFingerprint(selected));
      return { revision, branch: name };
    });
  }
  async readLabels(directory) {
    try {
      const labels = JSON.parse(await readLimited(path.join(directory, 'checkpoint-labels.json'), 20 * 1024 * 1024));
      return labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {};
    } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  updateLabel(id, revision, metadata) {
    return this.serialize(async () => {
      const directory = await this.initialize(id);
      if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid Git revision.');
      const selected = JSON.parse(await this.run(directory, ['show', `${revision}:manuscript.json`]));
      validateProject(selected);
      if (selected.id !== id) throw new Error('This revision belongs to a different manuscript.');
      const allowed = { title: 200, summary: 2000, location: 300, chapterId: 200 }, next = {};
      for (const [key, limit] of Object.entries(allowed)) if (metadata?.[key] != null) {
        if (typeof metadata[key] !== 'string') throw new Error(`Invalid checkpoint ${key}.`);
        next[key] = metadata[key].trim().slice(0, limit);
      }
      const labels = await this.readLabels(directory);
      labels[revision] = { ...(labels[revision] || {}), ...next };
      await atomicWrite(path.join(directory, 'checkpoint-labels.json'), JSON.stringify(labels, null, 2) + '\n');
      return { revision, ...labels[revision] };
    });
  }
}
module.exports = { GitHistory, contentFingerprint, gitEnvironment, textOf, shouldCheckpoint };
