// Synthetic manuscript and private test profile; no external AI requests.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');

async function waitFor(predicate, name, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate().catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${name}`);
}

(async () => {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'version-tree-ui-'));
  const project = {
    format: 'wraiter', version: 1, id: 'version-tree-ui', title: 'Version tree test',
    chapters: [{ id: 'opening', title: 'Opening', status: 'Draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Starting point.' }] }] } }],
    references: [], snapshots: [], comments: [], notes: '', style: '', language: 'en-US'
  };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, continuous: false }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const requests = [];
  let slowResponse = false;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.setHeader('Content-Type', 'application/json');
      const answer = () => { if (!response.destroyed) response.end(JSON.stringify({ response: JSON.stringify({ title: 'Added the clock tower', summary: 'Added a clock tower detail in Opening.' }) })); };
      if (slowResponse) { const timer = setTimeout(answer, 10000); response.on('close', () => clearTimeout(timer)); }
      else answer();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  const app = await electron.launch(options);
  let closed = false;
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor({ timeout: 30000 });
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label.replace(/&/g, '') === 'View').submenu.items.find(item => item.label.replace(/&/g, '') === 'Revision history').click());
    await page.getByRole('tab', { name: /^Checkpoints/ }).click();
    const write = async text => { await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(text); };
    const saveVersion = async label => {
      await page.getByRole('button', { name: 'Save version', exact: true }).click();
      await page.getByRole('textbox', { name: 'Version description' }).fill(label);
      await page.getByRole('dialog').getByRole('button', { name: 'Save version' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.locator('.checkpoint-node').filter({ hasText: label }).first().waitFor();
    };
    await write('The first path is warm and bright.'); await saveVersion('First path');
    await write('The first path ends beside a frozen river.'); await saveVersion('River ending');
    const first = (await page.evaluate(() => window.wraiter.listGitHistory())).entries.find(item => item.message === 'First path');
    const river = (await page.evaluate(() => window.wraiter.listGitHistory())).entries.find(item => item.message === 'River ending');
    assert.ok(first && river);
    await page.locator('.checkpoint-node').filter({ hasText: 'First path' }).getByRole('button', { name: 'Continue here' }).click();
    await page.getByRole('dialog', { name: 'Continue from this version?' }).getByRole('button', { name: 'Continue here' }).click();
    await waitFor(async () => (await editor.innerText()).includes('warm and bright'), 'older manuscript restored');
    await write('A different path leads toward the orchard.'); await saveVersion('Orchard path');
    const history = await page.evaluate(() => window.wraiter.listGitHistory());
    const orchard = history.entries.find(item => item.message === 'Orchard path');
    assert.ok(orchard);
    assert.equal(orchard.parentRevision, first.revision, 'new writing must branch from the selected version');
    assert.equal(river.parentRevision, first.revision, 'the earlier path remains in history');
    assert.equal(history.headRevision, orchard.revision);
    assert.ok(history.entries.some(item => item.revision === river.revision), 'alternate path is retained');
    const sidebar = page.locator('.checkpoint-tree');
    assert.equal(await sidebar.locator('.checkpoint-node').first().locator('.checkpoint-title').innerText(), 'Orchard path', 'newest checkpoint is first');
    assert.equal(await sidebar.locator('.checkpoint-node').filter({ hasText: 'River ending' }).count(), 0, 'other branches stay out of the current path');
    await page.getByRole('button', { name: /Open history map/ }).click();
    const tree = page.getByRole('dialog', { name: 'History map' });
    const world = tree.locator('.story-world'), view = tree.getByRole('region', { name: 'Writing history map' });
    const camera = () => world.evaluate(el => { const m = el.transform.baseVal.consolidate().matrix; return { k: m.a, x: m.e, y: m.f }; });
    const fit = await camera(), rect = await view.boundingBox(), anchor = { x: Math.round(rect.width * .67), y: Math.round(rect.height * .35) };
    await page.mouse.move(rect.x + anchor.x, rect.y + anchor.y);
    await page.mouse.wheel(0, -230);
    await waitFor(async () => (await camera()).k > fit.k, 'unmodified wheel zooms');
    const close = await camera();
    for (const axis of ['x', 'y']) assert.ok(Math.abs((anchor[axis] - close[axis]) / close.k - (anchor[axis] - fit[axis]) / fit.k) < 2, 'pointer stays over the same point');
    await page.mouse.down(); await page.mouse.move(rect.x + anchor.x + 68, rect.y + anchor.y - 40, { steps: 5 }); await page.mouse.up();
    const pan = await camera(); assert.ok(Math.abs(pan.x - close.x - 68) < 2 && Math.abs(pan.y - close.y + 40) < 2);
    await tree.getByRole('button', { name: 'Fit all' }).click();
    assert.deepEqual(await camera(), fit);
    await tree.screenshot({ path: path.join(userData, 'history-map.png') });
    const search = tree.getByRole('searchbox', { name: 'Find a passage or version' });
    await search.fill('frozen river');
    await tree.locator('.map-results button').filter({ hasText: 'River ending' }).first().click();
    const chosen = await camera();
    const inspector = tree.getByRole('complementary', { name: 'Selected history' });
    await inspector.getByRole('heading', { name: 'River ending' }).waitFor();
    await inspector.getByText('Alternate draft').waitFor();
    await inspector.getByRole('button', { name: 'Read this version' }).click();
    const preview = page.getByRole('dialog', { name: 'River ending' });
    assert.match(await preview.locator('.checkpoint-preview mark').innerText(), /frozen river/);
    await preview.getByRole('button', { name: 'Back to map' }).click();
    await inspector.getByRole('heading', { name: 'River ending' }).waitFor();
    assert.deepEqual(await camera(), chosen, 'return from preview restores the camera');
    await tree.getByRole('button', { name: 'Close dialog' }).click();
    assert.match(await editor.innerText(), /orchard/, 'preview must not change the active draft');
    assert.ok(await page.locator('.checkpoint-node.current').filter({ hasText: 'Orchard path' }).count());
    await page.evaluate(baseUrl => window.wraiter.settings({ enabled: true, ollamaMode: 'raw', taskProfiles: { checkpoint: { provider: 'ollama', baseUrl, model: 'checkpoint-test-model' } } }), baseUrl);
    await write('A different path leads toward the silver clock tower.'); await saveVersion('AI labeled path');
    await waitFor(async () => (await page.evaluate(() => window.wraiter.listGitHistory())).entries.some(item => item.message === 'AI labeled path' && item.summary === 'Added a clock tower detail in Opening.'), 'AI checkpoint summary');
    await page.locator('.checkpoint-node').filter({ hasText: 'AI labeled path' }).filter({ hasText: 'Added a clock tower detail in Opening.' }).waitFor();
    assert.equal(requests.at(-1)?.model, 'checkpoint-test-model');
    assert.match(requests.at(-1)?.prompt || '', /silver clock tower/);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(userData, 'version-tree.png') });
    slowResponse = true;
    await write('The silver clock tower has an open gate.'); await saveVersion('Before closing');
    await waitFor(() => Promise.resolve(requests.some(request => request.prompt?.includes('open gate'))), 'slow background label started');
    const pending = (await page.evaluate(() => window.wraiter.listGitHistory())).entries.find(item => item.message === 'Before closing');
    assert.ok(pending?.summary && pending.summary !== 'Added a clock tower detail in Opening.', 'factual label is saved before AI finishes');
    await app.close(); closed = true;
    const { GitHistory } = require('../electron/git-history.cjs');
    const persisted = await new GitHistory(userData).list(project.id);
    assert.equal(persisted.entries.find(item => item.revision === pending.revision)?.summary, pending.summary, 'closing preserves the factual checkpoint label');
    console.log(JSON.stringify({ passed: true, revisions: persisted.entries.length, userData }, null, 2));
  } finally { if (!closed) await app.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
