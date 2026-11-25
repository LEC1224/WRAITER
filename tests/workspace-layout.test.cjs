const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceLayout, windowOptions } = require('../electron/workspace-layout.cjs');

const ALPHA = '716e9e51-d0a8-4973-9fed-a546aca2212d';
const BETA = 'aca19f8b-bba2-43dd-bfb3-0690caceb3de';
const sidebar = { leftOpen: false, panel: 'history', focus: true, historyTab: 'checkpoints' };
const bounds = { x: -1520, y: 120, width: 1220, height: 800 };

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-layout-')), errors = [];
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    return fs.rm(directory, { recursive: true, force: true });
  });
  return { open: () => new WorkspaceLayout(directory, error => errors.push(error)), errors };
}

test('flush retains the latest pending pane and window changes in the profile', async t => {
  const { open, errors } = await fixture(t);
  const first = open();
  first.rememberView({ ...sidebar, panes: [{ id: ALPHA, size: 1 }] });
  first.rememberWindow({ bounds, maximized: true });
  const panes = [{ id: BETA, size: .73 }, { id: ALPHA, size: .27 }];
  first.rememberView({ ...sidebar, panes });
  await first.flush();
  const reopened = open(); await reopened.load();
  assert.deepEqual(reopened.view, { ...sidebar, panes });
  assert.deepEqual(reopened.window, { bounds, maximized: true });
  assert.deepEqual(errors, []);
});

test('a corrupt layout falls back to the backup and invalid panes do not erase sidebar choices', async t => {
  const { open, errors } = await fixture(t);
  const first = open();
  await fs.writeFile(first.file, JSON.stringify({ version: 1, view: {
    ...sidebar, panes: [{ id: BETA, size: .3 }, { id: BETA, size: .7 }, { id: 'bad ID', size: 1 }, { id: ALPHA, size: 0 }],
  }, window: { bounds: { ...bounds, width: -1 }, maximized: true } }));
  await first.load();
  assert.deepEqual(first.view, { ...sidebar, panes: [{ id: BETA, size: .3 }] });
  assert.equal(first.window, null);
  first.rememberView({ panel: 'notes' }); await first.flush();
  await fs.writeFile(first.file, '{truncated');
  const reopened = open(); await reopened.load();
  assert.deepEqual(reopened.view, { ...sidebar, panes: [{ id: BETA, size: .3 }] });
  assert.equal(errors.length, 1);
});

test('window placement fits a remaining display and supports displays beside the primary', () => {
  const saved = { bounds, maximized: true };
  const secondary = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(windowOptions(saved, secondary), { ...bounds, minWidth: 960, minHeight: 650 });
  const remaining = { x: 0, y: 30, width: 1280, height: 720 };
  assert.deepEqual(windowOptions(saved, remaining), { x: 0, y: 30, width: 1220, height: 720, minWidth: 960, minHeight: 650 });
  assert.deepEqual(windowOptions(null, { x: 0, y: 0, width: 800, height: 570 }), { width: 800, height: 570, minWidth: 800, minHeight: 570 });
});
