const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { GitHistory, contentFingerprint, gitEnvironment } = require('../electron/git-history.cjs');
const { defaults, DEFAULT_HOTKEYS, validateSettings, resolveTask, keySlot, mergeSettings } = require('../electron/preferences.cjs');
const { spellLanguage, normalizeFonts, menuTemplate } = require('../electron/desktop.cjs');

function draft(id = 'alpha', text = 'An author’s beginning. Åäö.') {
  return { format: 'wraiter', version: 1, id, title: 'Test manuscript', language: 'en-GB', chapters: [{ id: 'chapter', title: 'First chapter', status: 'Draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'Cambria', fontSize: '20px' } }] }] }] } }], references: [], notes: 'Author notes', snapshots: [], updatedAt: '2026-09-12T00:00:00Z' };
}
async function temporary(t) {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'wraiter-desktop-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('wraiter-desktop-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return directory;
}
test('task model profiles, credentials, and hotkeys persist independently', () => {
  const first = mergeSettings(defaults, { taskProfiles: { continue: { provider: 'codex', model: 'author-model' }, correct: { provider: 'compatible', baseUrl: 'https://one.example/v1', model: 'small' } }, hotkeys: { complete: 'Ctrl+Space', save: 'Ctrl+Alt+S' } });
  const second = mergeSettings(first, { taskProfiles: { correct: { model: 'cheaper' } }, hotkeys: { acceptWord: 'Ctrl+ArrowRight' } });
  assert.equal(resolveTask(second, 'continue').model, 'author-model');
  assert.equal(resolveTask(second, 'correct').model, 'cheaper');
  assert.equal(resolveTask(second, 'correct').provider, 'compatible');
  assert.equal(second.hotkeys.complete, 'Ctrl+Space');
  assert.equal(second.hotkeys.save, 'Ctrl+Alt+S');
  assert.equal(second.hotkeys.new, DEFAULT_HOTKEYS.new);
  const key = keySlot(resolveTask(second, 'correct'));
  assert.notEqual(key, keySlot({ ...resolveTask(second, 'correct'), baseUrl: 'https://two.example/v1' }));
  assert.equal(key, keySlot({ ...resolveTask(second, 'correct'), baseUrl: ' https://one.example/v1/ ' }));
  assert.throws(() => resolveTask(second, 'unknown'), /Unknown/);
});
test('settings reject malformed task profiles, languages, and out-of-range AI knobs', () => {
  for (const settings of [{ taskProfiles: [] }, { taskProfiles: { __bad: {} } }, { taskProfiles: { correct: { provider: 'other' } } }, { hotkeys: { badAction: 'Q' } }, { fontSize: Infinity }, { nativeLanguage: '<script>' }, { contextWords: 0 }, { tokenCap: 100000 }, { allowReasoning: 'yes' }]) assert.throws(() => validateSettings(settings), /invalid|unknown/i);
  assert.equal(validateSettings({ nativeLanguage: '', predictionWords: 500, ollamaMode: 'guided' }).predictionWords, 500);
});
test('suggestion targets have independent defaults and survive partial settings updates', () => {
  const migrated = mergeSettings(defaults, { predictionWords: 60 });
  assert.equal(migrated.translationSuggestions, 3);
  assert.equal(migrated.correctionSuggestions, 1);
  assert.equal(migrated.rephraseSuggestions, 3);
  const first = mergeSettings(migrated, { translationSuggestions: 4, correctionSuggestions: 2, rephraseSuggestions: 5 });
  const second = mergeSettings(first, { translationSuggestions: 8, theme: 'dark' });
  assert.equal(second.translationSuggestions, 8);
  assert.equal(second.correctionSuggestions, 2);
  assert.equal(second.rephraseSuggestions, 5);
  assert.equal(second.predictionWords, 60);
  assert.equal(resolveTask(second, 'correct').correctionSuggestions, 2);
  assert.equal(resolveTask(second, 'rewrite').rephraseSuggestions, 5);
});
test('suggestion settings accept only whole targets from one through eight', () => {
  for (const field of ['translationSuggestions', 'correctionSuggestions', 'rephraseSuggestions']) {
    for (const value of [1, 3, 8]) assert.equal(validateSettings({ [field]: value })[field], value);
    for (const value of [0, 9, -1, 1.5, '3', '', null, true, NaN, Infinity]) assert.throws(() => validateSettings({ [field]: value }), /invalid|whole numbers/i);
  }
});
test('native menu owns document hotkeys and leaves editor AI shortcuts to renderer', () => {
  const sent = []; let closed = false;
  const menu = menuTemplate(command => sent.push(command), () => { closed = true; }, { ...DEFAULT_HOTKEYS, save: 'Ctrl+Alt+W' });
  assert.deepEqual(menu.map(item => item.label), ['&File', '&Edit', '&View', '&Tools', '&Settings', '&Help']);
  const items = menu.flatMap(item => item.submenu);
  const save = items.find(item => item.label === '&Save');
  assert.equal(save.accelerator, 'Ctrl+Alt+W'); save.click(); assert.deepEqual(sent, ['save']);
  assert.equal(items.find(item => item.label === 'Suggest / rephrase selection').accelerator, undefined);
  const tools = menu.find(item => item.label === '&Tools').submenu;
  tools.find(item => item.label === '&Proofread…').click(); assert.deepEqual(sent, ['save', 'proofread']);
  const spelling = tools.find(item => item.label === 'Spelling').submenu[0]; assert.equal(spelling.checked, true); spelling.click(); assert.equal(sent.at(-1), 'toggle-spellcheck');
  items.find(item => item.label === 'E&xit').click(); assert.equal(closed, true);
});
test('spell dictionaries use exact regional matches and safe base fallback', () => {
  assert.equal(spellLanguage('en-GB', ['en-US', 'en-GB', 'sv']), 'en-GB');
  assert.equal(spellLanguage('sv-SE', ['en-US', 'sv']), 'sv');
  assert.equal(spellLanguage('fr-FR', ['en-US', 'sv']), null);
  assert.throws(() => spellLanguage('../evil', []), /language/);
  assert.deepEqual(normalizeFonts([' Georgia ', 'Georgia', '@Vertical', 'Arial', 'Bad\nFont']), ['Arial', 'Georgia']);
});
test('Git history preserves meaningful versions and formatting without touching manuscript directories', async t => {
  const directory = await temporary(t); const history = new GitHistory(path.join(directory, 'app-data'));
  const manuscript = path.join(directory, 'author'); await fs.mkdir(manuscript);
  const first = draft(); const actualFile = path.join(manuscript, 'Book.wraiter'); await fs.writeFile(actualFile, JSON.stringify(first));
  await history.record(first, 'First save');
  const timestampOnly = { ...first, updatedAt: '2026-09-12T01:00:00Z' };
  assert.equal(contentFingerprint(first), contentFingerprint(timestampOnly));
  assert.equal((await history.record(timestampOnly, 'Autosave')).committed, false);
  const second = draft('alpha', 'A corrected sentence.'); await history.record(second, 'Second save');
  await history.record(second, 'Before a major rewrite', true);
  const listing = await history.list(first.id);
  assert.equal(listing.available, true); assert.equal(listing.entries.length, 3);
  assert.equal(listing.entries[0].message, 'Before a major rewrite');
  assert.deepEqual(await history.revision(first.id, listing.entries.at(-1).revision), first);
  assert.deepEqual(JSON.parse(await fs.readFile(actualFile, 'utf8')), first);
  await assert.rejects(fs.stat(path.join(manuscript, '.git')), { code: 'ENOENT' });
  const restarted = new GitHistory(path.join(directory, 'app-data'));
  assert.equal((await restarted.record(second, 'Reopened')).committed, false);
  await assert.rejects(history.revision(first.id, 'HEAD; echo unsafe'), /Invalid Git revision/);
});
test('Git checkpoints flush the latest edit and isolate manuscript identifiers', async t => {
  const directory = await temporary(t); const history = new GitHistory(directory, { debounce: 60000 });
  history.schedule(draft('one', 'old')); history.schedule(draft('one', 'latest'));
  const listing = await history.list('one');
  assert.equal(listing.entries.length, 1);
  assert.deepEqual(await history.revision('one', listing.entries[0].revision), draft('one', 'latest'));
  await history.record(draft('two', 'different'), 'Another manuscript');
  assert.notEqual(history.repository('one'), history.repository('two'));
  assert.equal((await history.list('two')).entries.length, 1);
  await assert.rejects(history.revision('two', listing.entries[0].revision));
});
test('missing Git reports a useful status without changing source or recovery', async t => {
  const directory = await temporary(t); const history = new GitHistory(directory, { executable: 'wraiter-nonexistent-git-test' });
  const result = await history.list('new'); assert.equal(result.available, false); assert.match(result.error, /Git is not installed/);
  const environment = gitEnvironment(directory); assert.equal(environment.GIT_TERMINAL_PROMPT, '0'); assert.equal(environment.GIT_CONFIG_NOSYSTEM, '1'); assert.equal(environment.GIT_DIR, undefined);
});
