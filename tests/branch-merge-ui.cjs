const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { GitHistory } = require('../electron/git-history.cjs');
const root = path.resolve(__dirname, '..');
const chapter = (id, title, text, marks) => ({ id, title, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(marks && { marks }) }] }] } });

(async () => {
  const dir = path.join(root, 'test-output'); await fs.mkdir(dir, { recursive: true });
  const profile = await fs.mkdtemp(path.join(dir, 'branch-merge-ui-')), git = new GitHistory(profile);
  const base = { format: 'wraiter', version: 1, id: 'branch-merge-test', title: 'The crossing', notes: 'Early notes', references: [], snapshots: [], chapters: [chapter('departure', 'Departure', 'Mara left the village.'), chapter('return', 'Homecoming', 'Mara came home.')] };
  for (let i = 0; i < 20; i++) await git.record({ ...base, notes: 'Draft ' + i }, 'Earlier version ' + i);
  const shared = await git.record(base, 'Fork');
  const gate = chapter('gate', 'At the river gate', 'Mara used the brass key.', [{ type: 'italic' }]);
  const source = await git.record({ ...base, chapters: [base.chapters[0], gate, base.chapters[1]] }, 'Forgotten crossing');
  await git.activateRevision(base.id, shared.revision);
  const other = await git.record({ ...base, notes: 'Use the white flag.', chapters: [...base.chapters, chapter('song', 'Travellers’ song', 'Three voices sang.')] }, 'Song branch');
  await git.activateRevision(base.id, shared.revision);
  const live = { ...base, notes: 'Use the blue flag.', chapters: [base.chapters[0], chapter('market', 'Iron market', 'Mara bought an iron key.'), base.chapters[1]] };
  await git.record(live, 'Market draft');
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const prompt = JSON.parse(body).prompt || ''; requests.push(prompt);
    let result = { title: 'Combined writing', summary: 'Updated manuscript chapters.' };
    if (prompt.includes('STORY DATA\n')) result = { placements: [{ id: 'gate', kind: 'chapter', targetId: 'market', afterBlock: 0, reason: 'The purchase comes before the gate.', continuity: 'The key is iron when Mara buys it.', edits: [{ block: 0, before: 'brass', after: 'iron', reason: 'Match the key bought at the market.' }] }] };
    else if (prompt.includes('Group consecutive')) {
      const count = (prompt.match(/"number":\d+/g) || []).length;
      result = { sections: [{ end: count, title: 'Revising the departure', summary: 'Developed the early draft.' }] };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ response: JSON.stringify(result) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const model = { provider: 'ollama', baseUrl: 'http://127.0.0.1:' + server.address().port, model: 'merge-fixture' };
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: true, continuous: false, aiGrammar: false, ollamaMode: 'raw', ...model, taskProfiles: { chat: model, checkpoint: model } }));
  await fs.writeFile(path.join(profile, 'recovery.json'), JSON.stringify({ project: live, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env } : { args: [root], env });
  let app;
  try {
    app = await launch();
    const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(15000);
    page.on('pageerror', err => errors.push(err.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label.replace(/&/g, '') === 'View').submenu.items.find(item => item.label.replace(/&/g, '') === 'Revision history').click());
    await page.getByRole('tab', { name: /^Checkpoints/ }).click();
    const tree = page.getByRole('dialog', { name: 'Complete version tree' });
    const review = page.getByRole('dialog', { name: 'Merge into current draft' });
    const openTree = () => page.getByRole('button', { name: /Open complete tree/ }).click();
    const card = name => tree.locator('.checkpoint-graph-card').filter({ has: page.getByRole('button', { name, exact: true }) });
    await openTree();
    const grouped = tree.locator('[data-range]').first(); await grouped.scrollIntoViewIfNeeded();
    await grouped.getByRole('button', { name: 'Revising the departure' }).waitFor();
    const count = await tree.locator('.checkpoint-graph-card').count();
    await grouped.getByRole('button', { name: 'Expand versions' }).click();
    assert.ok(await tree.locator('.checkpoint-graph-card').count() > count);
    await tree.getByRole('button', { name: 'Collapse groups' }).click();
    await tree.getByRole('button', { name: 'Zoom in' }).click(); await tree.getByRole('button', { name: 'Zoom in' }).click();
    assert.equal(await tree.locator('[data-range]').count(), 0);
    const openMerge = name => card(name).getByRole('button', { name: 'Merge…' }).click();
    await page.evaluate(() => window.wraiter.settings({ enabled: false }));
    const before = await page.evaluate(() => window.wraiter.listGitHistory());
    await openMerge('Song branch');
    await review.getByRole('radio', { name: /Keep current/ }).check();
    await review.getByRole('button', { name: 'Cancel' }).click();
    assert.equal((await page.evaluate(() => window.wraiter.listGitHistory())).headRevision, before.headRevision);
    await openMerge('Song branch');
    await review.getByRole('radio', { name: /Keep current/ }).check();
    await review.getByRole('button', { name: 'Apply merge' }).click();
    await review.waitFor({ state: 'hidden' });
    const normal = await page.evaluate(() => window.wraiter.listGitHistory());
    const parents = normal.entries.find(row => row.revision === normal.headRevision).parentRevisions;
    assert.equal(parents.length, 2); assert.equal(parents[1], other.revision);
    // Opening the older snapshot can add editor-schema attributes to the live
    // draft. A protective first-parent checkpoint retains that exact snapshot.
    if (parents[0] !== before.headRevision) assert.equal(normal.entries.find(row => row.revision === parents[0]).parentRevision, before.headRevision);
    await page.evaluate(() => window.wraiter.settings({ enabled: true }));
    await openTree(); await openMerge('Forgotten crossing');
    await review.getByRole('tab', { name: 'AI-assisted merge' }).click();
    await review.getByRole('button', { name: 'Suggest placement and edits' }).click();
    await review.getByText('The purchase comes before the gate.').waitFor();
    await review.getByRole('checkbox').uncheck();
    const result = review.locator('.merge-result details').filter({ hasText: 'At the river gate' });
    await result.locator('summary').click(); assert.match(await result.locator('pre').innerText(), /brass key/);
    await review.getByRole('checkbox').check(); assert.match(await result.locator('pre').innerText(), /iron key/);
    await review.getByLabel('After chapter').selectOption('return'); await review.getByLabel('After chapter').selectOption('market');
    await review.screenshot({ path: path.join(profile, 'ai-merge-review.png') });
    await review.getByRole('button', { name: 'Apply merge' }).click(); await review.waitFor({ state: 'hidden' });
    const merged = await page.evaluate(() => window.wraiter.listGitHistory());
    assert.deepEqual(merged.entries.find(item => item.revision === merged.headRevision).parentRevisions, [normal.headRevision, source.revision]);
    const snapshot = await page.evaluate(id => window.wraiter.getGitRevision(id), merged.headRevision);
    assert.deepEqual(snapshot.chapters.map(c => c.id), ['departure', 'market', 'gate', 'return', 'song']);
    assert.equal(snapshot.chapters[2].content.content[0].content[0].marks[0].type, 'italic');
    assert.equal(snapshot.notes, live.notes);
    await openTree();
    await tree.locator('.checkpoint-graph-card.current').filter({ hasText: 'Merge · Forgotten crossing' }).waitFor();
    assert.equal(await tree.locator('path.merge-edge').count(), 2);
    await tree.locator('.checkpoint-graph-card.current').getByRole('button', { name: 'Inspect edits' }).click();
    await tree.getByText('1 individual edit · newest first').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /^Every edit/ }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(errors, []);
    assert.ok(requests.some(p => p.includes('STORY DATA') && p.includes('Mara bought an iron key.')));
    await app.close(); app = null;
    const recovery = JSON.parse(await fs.readFile(path.join(profile, 'recovery.json')));
    assert.equal(recovery.project.chapters.find(c => c.id === 'gate').content.content[0].content[0].text, 'Mara used the iron key.');
    const persisted = await new GitHistory(profile).list(base.id);
    assert.equal(persisted.headRevision, merged.headRevision);
    console.log(JSON.stringify({ passed: true, revisions: persisted.entries.length, profile }));
  } catch (error) {
    if (app) {
      const page = app.windows()[0];
      if (page) console.error((await page.locator('body').innerText().catch(() => '')).slice(-2300));
      await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); app = null;
    }
    throw error;
  } finally { if (app) await app.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
