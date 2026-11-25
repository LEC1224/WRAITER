// Synthetic account and isolated desktop profile; no production requests or AI.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Store } = require('../cloud/store.cjs');
const { createApplication } = require('../cloud/server.cjs');
const auth = require('../cloud/auth.cjs');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'cloud-vault-desktop-')), profile = path.join(directory, 'profile');
  await fs.mkdir(profile); await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, continuous: false, localGrammar: false, aiGrammar: false, spellcheck: false, startup: 'restore' }));
  const store = new Store(path.join(directory, 'server')), user = store.createUser('vault-ui@example.test', await auth.hashPassword('synthetic123')); store.verify(user.id);
  const crypto = await import('../src/cloud-vault.js'), earlierUser = store.createUser('earlier-ui@example.test', await auth.hashPassword('synthetic123')); store.verify(earlierUser.id);
  const earlierSecret = 'earlier independent document passphrase', earlier = await crypto.createVault(earlierUser.id, earlierSecret);
  store.saveVault(earlierUser.id, { vault: earlier.vault, baseRevision: 0 });
  const earlierMarker = 'An existing encrypted beta manuscript survives automatic account access.', earlierId = 'earlier-encrypted-document';
  const earlierProject = { format: 'wraiter', version: 1, id: earlierId, title: 'Earlier encrypted manuscript', language: 'en-US', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), chapters: [{ id: 'earlier-chapter', title: 'Earlier chapter', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: earlierMarker }] }] } }], references: [], notes: '', style: '', snapshots: [], chats: [] };
  const earlierSealed = await crypto.sealDocument(earlier.key, earlierUser.id, earlierId, { project: earlierProject, journal: [] });
  store.save(earlierUser.id, earlierId, { sealed: earlierSealed }, true);
  const { server } = createApplication({ store, env: { WRAITER_ORIGIN: 'http://127.0.0.1', WRAITER_SECURE_COOKIES: '0' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`, env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const build = path.resolve(root, process.env.WRAITER_EDITOR_DIST || 'tmp/cloud-vault-desktop-build');
  const executable = process.env.WRAITER_EXECUTABLE && path.resolve(process.env.WRAITER_EXECUTABLE);
  let app, page; const errors = [];
  async function stop() { await app?.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app?.close().catch(() => {}); app = null; }
  async function launch() {
    app = await _electron.launch({ ...(executable ? { executablePath: executable, args: [] } : { args: [root] }), env, timeout: 60000 });
    const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(async ({ BrowserWindow, app }, input) => {
      const clientPath = process.getBuiltinModule('node:path').join(app.getAppPath(), 'electron/cloud-client.cjs');
      const require = process.getBuiltinModule('node:module').createRequire(clientPath);
      const { CloudClient, CLOUD_ORIGIN } = require(clientPath), originalRequest = CloudClient.prototype.request, network = globalThis.fetch;
      globalThis.__vaultTestWire = [];
      CloudClient.prototype.request = function (...args) {
        this.fetch = async (url, init) => {
          if (init.body && !url.endsWith('/auth/login')) globalThis.__vaultTestWire.push(init.body);
          return network(input.baseURL + url.slice(CLOUD_ORIGIN.length), init);
        };
        return originalRequest.apply(this, args);
      };
      // A packaged check must exercise its actual bundled UI. Source checks can
      // use the isolated Vite test build without touching dist or app sources.
      if (!app.isPackaged) await BrowserWindow.getAllWindows()[0].loadFile(input.index);
      const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus();
    }, { baseURL, index: path.join(build, 'index.html') });
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(executable));
    return page;
  }
  try {
    if (executable) await fs.access(executable);
    page = await launch();
    let editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await page.getByRole('button', { name: 'Cloud library', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'WRAITER cloud library', exact: true }); await dialog.waitFor();
    await dialog.getByLabel('Email', { exact: true }).fill(user.email); await dialog.getByLabel('Password', { exact: true }).fill('synthetic123');
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await dialog.getByRole('button', { name: 'Upload / update current manuscript', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Create document vault', exact: true }).count(), 0);
    assert.equal(await dialog.getByLabel('Document passphrase', { exact: true }).count(), 0);
    assert.equal(store.vault(user.id).vault.version, 2); assert.equal(store.vault(user.id).vault.recovery, null);
    assert.equal((await page.evaluate(() => window.wraiter.cloudStatus())).vault.unlocked, true);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const marker = 'A private desktop vault manuscript for the beta integration test.';
    await editor.fill(marker);
    await page.getByRole('button', { name: 'Cloud library', exact: true }).click();
    await dialog.getByRole('button', { name: 'Upload / update current manuscript', exact: true }).click();
    await dialog.getByText('Encrypted cloud copy saved. Local file saving remains separate.', { exact: true }).waitFor();
    const rows = store.list(user.id).documents; assert.equal(rows.length, 1); assert.equal(rows[0].encrypted, true);
    assert.equal(JSON.stringify(store.document(user.id, rows[0].id)).includes(marker), false);
    await dialog.getByRole('button', { name: 'Open local copy', exact: true }).click();
    await dialog.waitFor({ state: 'detached' }); assert.ok((await editor.innerText()).includes(marker));
    const wire = await app.evaluate(() => globalThis.__vaultTestWire);
    const savedAccount = await fs.readFile(path.join(profile, 'cloud-account.json'), 'utf8');
    assert.equal(savedAccount.includes('synthetic123'), false); assert.equal(savedAccount.includes(marker), false);
    await stop(); page = await launch(); editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await page.getByRole('button', { name: 'Cloud library', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'WRAITER cloud library', exact: true }); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Open local copy', exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Password', { exact: true }).count(), 0);
    assert.equal(await dialog.getByLabel('Document passphrase', { exact: true }).count(), 0);
    const status = await page.evaluate(() => window.wraiter.cloudStatus());
    assert.equal(status.vault.unlocked, true); assert.equal(Object.keys(status).some(key => /token|key|passphrase/i.test(key)), false);
    await dialog.getByRole('button', { name: 'Open local copy', exact: true }).click();
    await dialog.waitFor({ state: 'detached' }); assert.ok((await editor.innerText()).includes(marker));
    await page.getByRole('button', { name: 'Cloud library', exact: true }).click();
    await dialog.getByRole('button', { name: 'Open local copy', exact: true }).waitFor();
    await page.screenshot({ path: path.join(directory, 'encrypted-cloud-library.png') });
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await assert.rejects(fs.access(path.join(profile, 'cloud-account.json'))); assert.equal((await page.evaluate(() => window.wraiter.cloudStatus())).connected, false);

    // Only earlier beta accounts see the one-time conversion form.
    await dialog.getByLabel('Email', { exact: true }).fill(earlierUser.email); await dialog.getByLabel('Password', { exact: true }).fill('synthetic123');
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Update earlier document encryption', exact: true }).waitFor();
    await dialog.getByLabel('Earlier document passphrase', { exact: true }).fill(earlierSecret);
    await dialog.getByRole('button', { name: 'Continue with automatic encryption', exact: true }).click();
    await dialog.getByRole('button', { name: 'Upload / update current manuscript', exact: true }).waitFor();
    assert.equal(store.vault(earlierUser.id).vault.version, 2); assert.deepEqual(store.vault(earlierUser.id).vault.recovery, earlier.vault.recovery);
    assert.deepEqual(store.document(earlierUser.id, earlierId).sealed, earlierSealed);
    await dialog.getByRole('button', { name: 'Open local copy', exact: true }).click();
    await dialog.waitFor({ state: 'detached' }); assert.ok((await editor.innerText()).includes(earlierMarker));
    await page.getByRole('button', { name: 'Cloud library', exact: true }).click();
    await dialog.getByRole('button', { name: 'Open local copy', exact: true }).waitFor();
    wire.push(...await app.evaluate(() => globalThis.__vaultTestWire));
    assert.equal(wire.some(text => text.includes(earlierSecret) || text.includes(earlier.recoveryKey) || text.includes(marker) || text.includes(earlierMarker)), false);
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); await assert.rejects(fs.access(path.join(profile, 'cloud-account.json')));
    assert.deepEqual(errors, []);
    const report = { directory, executable: executable || null, packaged: await app.evaluate(({ app }) => app.isPackaged), version: await app.evaluate(({ app }) => app.getVersion()), checks: ['Account sign-in automatically creates and unlocks encryption without another password or recovery setup.', 'Upload sends encrypted content; opening decrypts into a separate local draft.', 'Restart restores the OS-protected device key and opens encrypted documents without another prompt.', 'Earlier beta passphrase accounts convert once, preserve recovery and open unchanged document ciphertext with the same key.', 'Document secrets and manuscript are absent from network bodies.', 'Sign-out removes saved device credentials and locks the vault.'], errors };
    await fs.writeFile(path.join(output, 'cloud-vault-desktop-ui-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); throw error; }
  finally { await stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
