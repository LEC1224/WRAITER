const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./core.cjs');
const { manuscriptText } = require('./git-history.cjs');
const { passageDelta, makePassages, versionTitle } = require('./story-passages.cjs');

const cacheFile = 'wraiter-story-map-v1.json';
const sha = /^[a-f0-9]{40}$/;
const { scenePrompt, readSections } = require('./story-scenes.cjs');

async function readTexts(git, id, directory, revisions) {
  const refs = [...new Set(revisions.filter(Boolean))];
  const input = refs.map(ref => ref + ':manuscript.txt').join('\n') + '\n';
  const headers = (await git.run(directory, ['cat-file', '--batch-check'], input)).trimEnd().split(/\r?\n/);
  const texts = new Map(), objects = new Map();
  for (let i = 0; i < refs.length; i++) {
    const [oid, kind, size] = headers[i].split(' ');
    if (kind === 'blob' && sha.test(oid)) {
      if (!objects.has(oid)) objects.set(oid, { size: Number(size), refs: [] });
      objects.get(oid).refs.push(refs[i]);
    } else {
      // Early repositories can be missing the small plain-text companion.
      texts.set(refs[i], manuscriptText(await git.readRevision(directory, id, refs[i])));
    }
  }
  let batch = [], bytes = 0;
  async function readBatch() {
    if (!batch.length) return;
    const output = Buffer.from(await git.run(directory, ['cat-file', '--batch'], batch.join('\n') + '\n'));
    let offset = 0;
    for (const oid of batch) {
      const end = output.indexOf(10, offset);
      const info = objects.get(oid);
      if (end < offset || output.toString('ascii', offset, end) !== oid + ' blob ' + info.size || output[end + 1 + info.size] !== 10) throw new Error('Git returned an incomplete manuscript text.');
      const value = output.toString('utf8', end + 1, end + 1 + info.size);
      for (const ref of info.refs) texts.set(ref, value);
      offset = end + 2 + info.size;
    }
    batch = []; bytes = 0;
  }
  for (const [oid, info] of objects) {
    if (bytes + info.size > 4 * 1024 * 1024) await readBatch();
    batch.push(oid); bytes += info.size;
  }
  await readBatch();
  return texts;
}

// A sample represents a numbered version in an unbroken Git chain. The model
// can name several distinct events inside a location-based first approximation.
class StoryHistory {
  constructor(git) { this.git = git; this.projects = new Map(); }
  state(id) {
    if (!this.projects.has(id)) {
      const file = path.join(this.git.repository(id), '.git', cacheFile);
      const ready = fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));
      this.projects.set(id, { file, work: ready.then(data => ({ facts: data?.facts || {}, names: data?.names || {} })), groups: new Map(), pending: new Map() });
    }
    return this.projects.get(id);
  }
  // Serialize only the derived-cache mutation. Writing and model inference
  // stay outside this queue, and a failed refresh remains retryable.
  update(state, fn) {
    const previous = state.work;
    const result = previous.then(async data => {
      const next = { facts: { ...data.facts }, names: { ...data.names } };
      if (!await fn(next)) return data;
      await atomicWrite(state.file, JSON.stringify(next));
      return next;
    });
    state.work = result.catch(() => previous);
    return result;
  }
  async list(id) {
    const history = await this.git.list(id);
    if (!history.entries.length) return history;
    const state = this.state(id), directory = this.git.repository(id);
    try {
      const data = await this.update(state, async data => {
        const missing = history.entries.filter(item => !data.facts[item.revision]);
        for (let i = 0; i < missing.length; i += 32) {
          const batch = missing.slice(i, i + 32);
          const texts = await readTexts(this.git, id, directory, batch.flatMap(item => [item.revision, item.parentRevision]));
          for (const item of batch) data.facts[item.revision] = passageDelta(texts.get(item.parentRevision) || '', texts.get(item.revision));
        }
        return missing.length > 0;
      });
      const entries = history.entries.map(item => {
        const enriched = { ...item, passage: data.facts[item.revision] };
        return { ...enriched, displayTitle: versionTitle(enriched) };
      });
      const passages = makePassages(entries, history.headRevision);
      state.groups = new Map(passages.map(group => [group.key, group]));
      return { ...history, entries, passages: passages.map(group => ({ ...group, sections: data.names[group.key] })) };
    } catch (error) { return { ...history, mapError: 'Passage indexing could not finish. ' + error.message }; }
  }
  async describe(project, groupId, withModel) {
    const state = this.state(project.id), group = state.groups.get(groupId);
    if (!group?.hasProse) return { status: 'unavailable' };
    if (state.pending.has(groupId)) return state.pending.get(groupId);
    const work = (async () => {
      const data = await state.work;
      if (data.names[groupId]) return { status: 'ready', sections: data.names[groupId] };
      return withModel(async (settings, key, providers, signal) => {
        if (!settings) return { status: 'busy' };
        let sections;
        const { prompt, starts, schema } = scenePrompt(project, group, data.facts);
        try {
          const raw = await providers.generateStructured(settings, key, prompt, signal, schema);
          try { sections = readSections(raw, group.revisions.length, starts); }
          catch {
            signal?.throwIfAborted();
            const correction = '\nReturn just the JSON scene list. The first startsAt must be A. For later scenes copy one of these excerpt markers in order: ' + [...starts.keys()].join(', ') + '. Give each scene a concrete story title.';
            sections = readSections(await providers.generateStructured(settings, key, { ...prompt, user: prompt.user + correction }, signal, schema), group.revisions.length, starts);
          }
        }
        catch { return { status: signal?.aborted ? 'busy' : 'unavailable' }; }
        await this.update(state, async cache => { cache.names[groupId] = sections; return true; });
        return { status: 'ready', sections };
      });
    })();
    state.pending.set(groupId, work);
    try { return await work; } finally { state.pending.delete(groupId); }
  }
}
module.exports = { StoryHistory, readSections, scenePrompt };
