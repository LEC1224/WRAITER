const path = require('node:path');
const { atomicWrite, readLimited } = require('./core.cjs');

const PANELS = new Set(['assist', 'references', 'notes', 'comments', 'review', 'history']);
const WINDOW_KEYS = ['x', 'y', 'width', 'height'];

function cleanLayout(value) {
  const panes = [], seen = new Set();
  if (Array.isArray(value?.panes)) for (const pane of value.panes.slice(0, 200)) {
    if (typeof pane?.id !== 'string' || !/^[a-f0-9-]{36}$/.test(pane.id) || seen.has(pane.id)) continue;
    if (!Number.isFinite(pane.size) || pane.size <= 0 || pane.size > 1) continue;
    seen.add(pane.id);
    panes.push({ id: pane.id, size: pane.size });
  }
  return {
    leftOpen: value?.leftOpen !== false,
    panel: PANELS.has(value?.panel) ? value.panel : null,
    focus: value?.focus === true,
    historyTab: value?.historyTab === 'checkpoints' ? 'checkpoints' : 'edits',
    panes,
  };
}

function cleanWindow(value) {
  const bounds = value?.bounds;
  if (!bounds || WINDOW_KEYS.some(key => !Number.isInteger(bounds[key]) || Math.abs(bounds[key]) > 1e6) || bounds.width < 1 || bounds.height < 1) return null;
  return { bounds: Object.fromEntries(WINDOW_KEYS.map(key => [key, bounds[key]])), maximized: value.maximized === true };
}

function windowOptions(saved, area) {
  const minWidth = Math.min(960, area.width), minHeight = Math.min(650, area.height);
  const width = Math.min(area.width, Math.max(minWidth, saved?.bounds.width ?? 1450));
  const height = Math.min(area.height, Math.max(minHeight, saved?.bounds.height ?? 960));
  if (!saved) return { width, height, minWidth, minHeight };
  const x = Math.max(area.x, Math.min(area.x + area.width - width, saved.bounds.x));
  const y = Math.max(area.y, Math.min(area.y + area.height - height, saved.bounds.y));
  return { x, y, width, height, minWidth, minHeight };
}

// This profile file is independent of the app binary, general preferences
// and project recovery. A failed layout write must never prevent a draft save.
class WorkspaceLayout {
  constructor(directory, onError) {
    this.file = path.join(directory, 'workspace-layout.json');
    this.onError = onError;
    this.view = cleanLayout();
    this.window = null;
    this.writes = Promise.resolve();
    this.saved = null;
  }

  serialize() { return JSON.stringify({ version: 1, view: this.view, window: this.window }); }

  async load() {
    for (const target of [this.file, this.file + '.bak']) {
      try {
        const data = JSON.parse((await readLimited(target, 64 * 1024)).toString('utf8'));
        if (data?.version !== 1) throw new Error('Invalid workspace layout version.');
        this.view = cleanLayout(data.view);
        this.window = cleanWindow(data.window);
        // Keep a good backup if the primary file was unreadable.
        if (target === this.file) this.saved = this.serialize();
        return;
      } catch (error) { if (error.code !== 'ENOENT') this.onError(error); }
    }
  }

  rememberView(view) { this.view = cleanLayout(view); this.schedule(); }
  rememberWindow(state) {
    const checked = cleanWindow(state);
    if (checked) { this.window = checked; this.schedule(); }
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.timer);
    this.writes = this.writes.then(async () => {
      const data = this.serialize();
      if (data === this.saved) return;
      await atomicWrite(this.file, data, this.saved !== null);
      this.saved = data;
    }).catch(this.onError);
    return this.writes;
  }
}

module.exports = { WorkspaceLayout, windowOptions };
