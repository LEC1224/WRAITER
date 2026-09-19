const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceSession, cleanView } = require('../electron/workspace-session.cjs');
const { DocumentStore, hash } = require('../electron/core.cjs');
const { defaults, mergeSettings, validateSettings } = require('../electron/preferences.cjs');
const { menuTemplate } = require('../electron/desktop.cjs');
const project = (id, text = id) => ({ format: 'wraiter', version: 1, id, title: id, chapters: [{ id: id + '-chapter', title: 'Opening', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }] });
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-tabs-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); return fs.rm(directory, { recursive: true, force: true }); });
  await new DocumentStore(directory).writeRecovery(project('Alpha'), null, null);
  const session = new WorkspaceSession(directory); await session.boot(); return { directory, session };
}

test('single-project recovery migrates to separate tab stores and all tabs restore in order', async t => {
  const { directory, session } = await fixture(t), alpha = session.activeId;
  const beta = await session.create(project('Beta')); assert.notEqual(session.active.store.recoveryPath, session.legacy.recoveryPath);
  await session.active.files.persist(project('Beta', 'Independent beta edits'));
  await session.activate(alpha); assert.equal(session.active.store.project.title, 'Alpha');
  session.rememberView({ chapterId: 'Alpha-chapter', scrollTop: 250, selection: { from: 2, to: 4 } }); await session.checkpoint();
  const restored = new WorkspaceSession(directory), result = await restored.boot();
  assert.equal(result.workspace.activeId, alpha); assert.deepEqual(result.workspace.tabs.map(tab => tab.title), ['Alpha', 'Beta']);
  assert.equal(result.workspace.tabs[0].view.scrollTop, 250);
  await restored.activate(beta.workspace.activeId); assert.match(JSON.stringify(restored.active.store.project), /Independent beta edits/);
  await assert.rejects(restored.active.files.persist(project('Alpha')), /another document/);
});
test('a completed background chat is persisted into its originating project', async t => {
  const { directory, session } = await fixture(t), alphaTab = session.activeId;
  await session.create(project('Beta'));
  const chat = { id: 'chat-1', title: 'Background question', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [{ id: 'user-1', role: 'user', text: 'Can this finish elsewhere?' }, { id: 'assistant-1', role: 'assistant', text: 'Yes, the reply is saved.' }] };
  await session.persistChat('Alpha', chat);
  assert.equal(session.active.store.project.id, 'Beta');
  const restored = new WorkspaceSession(directory); await restored.boot(); await restored.activate(alphaTab);
  assert.equal(restored.active.store.project.activeChatId, 'chat-1');
  assert.equal(restored.active.store.project.chats[0].messages[1].text, 'Yes, the reply is saved.');
});
test('reopening an open file activates its tab and saves cannot target another open file', async t => {
  const { directory, session } = await fixture(t), target = path.join(directory, 'Book & sequel.wraiter');
  await fs.writeFile(target, JSON.stringify(project('Book'))); const first = await session.open(target);
  await session.activate(session.entries[0].id); assert.throws(() => session.assertSaveTarget(target), /another tab/);
  const duplicate = await session.open(target); assert.equal(duplicate.workspace.activeId, first.workspace.activeId); assert.equal(session.entries.length, 2);
  const bytes = await fs.readFile(target); await assert.rejects(session.open(path.join(directory, 'missing.wraiter')), /ENOENT/);
  assert.equal(session.activeId, first.workspace.activeId); assert.deepEqual(await fs.readFile(target), bytes);
});
test('native import is staged independently and a changed source leaves the active tab intact', async t => {
  const { directory, session } = await fixture(t), previous = session.activeId, target = path.join(directory, 'Native.txt');
  await fs.writeFile(target, 'Original'); const pending = await session.open(target); assert.ok(pending.import); assert.equal(session.activeId, previous);
  await fs.writeFile(target, 'Changed externally'); await assert.rejects(session.bind(project('Native'), { openToken: pending.openToken }), /changed while opening/);
  assert.equal(session.entries.length, 1); assert.equal(session.activeId, previous);
  const again = await session.open(target); await session.bind(project('Native', 'Changed externally'), { openToken: again.openToken });
  assert.equal(session.active.files.binding.format, 'txt'); assert.equal(session.entries.length, 2);
});
test('clean startup archives unnamed drafts and closing the last tab does not resurrect it', async t => {
  const { directory, session } = await fixture(t); await session.create(project('Beta'));
  const clean = new WorkspaceSession(directory), result = await clean.boot('new');
  assert.equal(result.project, null); assert.equal(result.workspace.tabs.length, 1); assert.equal(result.archivedPaths.length, 2);
  assert.deepEqual(await Promise.all(result.archivedPaths.map(async target => JSON.parse(await fs.readFile(target, 'utf8')).title)), ['Alpha', 'Beta']);
  const next = new WorkspaceSession(directory); assert.equal((await next.boot()).project, null);
  await next.active.store.writeRecovery(project('Fresh'), null, null); await next.checkpoint();
  const closed = await next.close(next.activeId); assert.equal(closed.project, null); assert.ok(closed.archivedPath);
  assert.equal((await new WorkspaceSession(directory).boot()).project, null);
});
test('closing a named native tab with unreviewed edits preserves its recovery separately', async t => {
  const { directory, session } = await fixture(t), target = path.join(directory, 'Unreviewed.txt'); await fs.writeFile(target, 'Original');
  const opened = await session.open(target); await session.bind(project('Native', 'Original'), { openToken: opened.openToken, fidelity: { requiresReview: true, warnings: ['Fixture review'] } });
  await session.active.files.persist(project('Native', 'New recovery text'), { format: 'txt', data: 'New recovery text' });
  const closed = await session.close(session.activeId); assert.ok(closed.archivedPath); assert.match(await fs.readFile(closed.archivedPath, 'utf8'), /New recovery text/); assert.equal(await fs.readFile(target, 'utf8'), 'Original');
});
test('copied manuscript identifiers receive independent histories when opened together', async t => {
  const { directory, session } = await fixture(t), target = path.join(directory, 'Copy.wraiter'); await fs.writeFile(target, JSON.stringify(project('Alpha')));
  const result = await session.open(target); assert.notEqual(result.project.id, 'Alpha'); assert.equal(result.project.title, 'Alpha'); assert.equal(session.entries[0].store.project.id, 'Alpha');
});
test('a corrupt manifest uses its preceding backup and failed tab changes retain the active project', async t => {
  const { directory, session } = await fixture(t), alpha = session.activeId; await session.create(project('Beta')); await session.activate(alpha);
  await fs.writeFile(session.manifest, '{broken'); const restored = new WorkspaceSession(directory), result = await restored.boot();
  assert.equal(result.workspace.tabs.length, 2); assert.match(result.warning, /recovery copy/);
  const previous = restored.activeId, other = restored.entries.find(entry => entry.id !== previous).id;
  restored.checkpoint = async () => { throw new Error('Simulated full disk'); };
  await assert.rejects(restored.activate(other), /full disk/); assert.equal(restored.activeId, previous);
  await assert.rejects(restored.close(previous), /full disk/); assert.equal(restored.activeId, previous); assert.equal(restored.entries.length, 2);
  await assert.rejects(restored.create(project('Third')), /full disk/); assert.equal(restored.entries.length, 2);
});
test('recent menu entries open exact paths and startup/tab shortcuts preserve saved choices', () => {
  const sent = [], target = path.resolve('A & B.wraiter'), menu = menuTemplate(value => sent.push(value), () => {}, defaults.hotkeys, [target]);
  const recent = menu[0].submenu.find(item => item.label === 'Open &recent'); recent.submenu[0].click(); assert.deepEqual(sent, ['open-recent:' + target]); assert.match(recent.submenu[0].label, /&&/);
  assert.equal(mergeSettings(defaults, { startup: 'new' }).startup, 'new'); assert.throws(() => validateSettings({ startup: 'unknown' }), /restore projects/);
  const updated = mergeSettings(defaults, { hotkeys: { accept: 'Ctrl+Tab', complete: 'Ctrl+W' } }); assert.equal(updated.hotkeys.nextTab, ''); assert.equal(updated.hotkeys.closeTab, ''); assert.equal(updated.hotkeys.accept, 'Ctrl+Tab');
  assert.deepEqual(cleanView({ chapterId: 'chapter', scrollTop: -10, selection: { from: 2, to: 3 }, project: 'ignored' }), { chapterId: 'chapter', scrollTop: 0, selection: { from: 2, to: 3 } });
  assert.deepEqual(cleanView(null), {});
});

test('reloading an external WRAITER edit replaces the tab, preserves the draft and starts a separate journal', async t => {
  const { directory, session } = await fixture(t), target = path.join(directory, 'Book.wraiter');
  const original = { ...project('Book', 'Original'), historySequence: 7 };
  await fs.writeFile(target, JSON.stringify(original)); await session.open(target);
  const count = session.entries.length, oldId = session.activeId;
  const external = { ...original, chapters: project('Book', 'Edited elsewhere').chapters };
  await fs.writeFile(target, JSON.stringify(external));
  const draft = { ...original, chapters: project('Book', 'Local unsaved edits').chapters };
  const loaded = await session.reload(draft);
  assert.equal(session.entries.length, count); assert.notEqual(session.activeId, oldId);
  assert.match(JSON.stringify(loaded.project), /Edited elsewhere/); assert.notEqual(loaded.project.id, 'Book'); assert.equal(loaded.project.historySequence, undefined);
  assert.deepEqual(JSON.parse(await fs.readFile(loaded.preservedPath, 'utf8')), draft);
  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), external);
  await session.active.files.persist(loaded.project); // No stale-hash conflict.
  const restored = await new WorkspaceSession(directory).boot(); assert.equal(restored.project.id, loaded.project.id);
});

test('native reload reimports disk content and failed or racing reloads retain local edits', async t => {
  const { directory, session } = await fixture(t), target = path.join(directory, 'Book.txt');
  await fs.writeFile(target, 'Original'); const opening = await session.open(target);
  await session.bind(project('Book', 'Original'), { openToken: opening.openToken });
  const draft = project('Book', 'Unsaved draft'), oldId = session.activeId;
  await fs.writeFile(target, 'External version'); const pending = await session.reload(draft);
  assert.equal(Buffer.from(pending.bytes).toString(), 'External version'); assert.equal(session.activeId, oldId);
  await fs.writeFile(target, 'Second external version');
  await assert.rejects(session.bind(project('Imported', 'External version'), { openToken: pending.openToken }), /changed while opening/);
  assert.equal(session.activeId, oldId); assert.deepEqual(session.active.store.project, draft);
  const retry = await session.reload(draft), result = await session.bind(project('Imported', 'Second external version'), { openToken: retry.openToken });
  assert.equal(result.binding.format, 'txt'); assert.equal(result.path, target); assert.match(await fs.readFile(result.preservedPath, 'utf8'), /Unsaved draft/);
  await session.active.files.persist(result.project, { format: 'txt', data: 'Second external version' });
  await fs.unlink(target); const id = session.activeId;
  await assert.rejects(session.reload(result.project), /ENOENT/); assert.equal(session.activeId, id);
});

test('invalid disk documents and checkpoint failures leave the original reload tab recoverable', async t => {
  const { directory, session } = await fixture(t), target = path.join(directory, 'Book.wraiter');
  await fs.writeFile(target, JSON.stringify(project('Book'))); await session.open(target);
  const before = session.activeId, draft = project('Book', 'Keep this draft');
  await fs.writeFile(target, '{invalid'); await assert.rejects(session.reload(draft));
  assert.equal(session.activeId, before); assert.deepEqual(session.active.store.project, draft);
  await fs.writeFile(target, JSON.stringify(project('Book', 'External')));
  session.checkpoint = async () => { throw new Error('Simulated full disk'); };
  await assert.rejects(session.reload(draft), /full disk/); assert.equal(session.activeId, before); assert.deepEqual(session.active.store.project, draft);
});

test('numbering settings are independent, validated and reflected by native checkbox menu items', () => {
  const prefs = mergeSettings(defaults, { showRowNumbers: true, showParagraphNumbers: true }), sent = [];
  assert.equal(prefs.showPageNumbers, false); assert.throws(() => validateSettings({ showRowNumbers: 'yes' }), /Invalid/);
  const menu = menuTemplate(value => sent.push(value), () => {}, {}, [], prefs);
  const items = menu.find(item => item.label === '&View').submenu.find(item => item.label === 'Text numbering').submenu;
  assert.deepEqual(items.map(item => [item.label, item.type, item.checked]), [['Row numbers', 'checkbox', true], ['Page numbers', 'checkbox', false], ['Paragraph numbers', 'checkbox', true]]);
  items.forEach(item => item.click()); assert.deepEqual(sent, ['toggle-row-numbers', 'toggle-page-numbers', 'toggle-paragraph-numbers']);
});
