const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { chromium } = require('playwright');
const { createApplication } = require('../cloud/server.cjs');

(async () => {
  const { newProject } = await import('../src/document.js');
  const { unlockAccountVault, sealDocument, openDocument } = await import('../src/cloud-vault.js');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wraiter-web-ui-'));
  const messages = [], origin = 'http://127.0.0.1:3038', headers = { 'X-Wraiter-Request': '1', Origin: origin };
  const app = createApplication({ env: { WRAITER_DATA_DIR: data, WRAITER_ORIGIN: origin, WRAITER_SECURE_COOKIES: '0' }, sendMail: async (email, kind, link) => messages.push({ email, kind, link }) });
  await new Promise(resolve => app.server.listen(3038, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  await context.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  const page = await context.newPage(), errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (new URL(req.url()).origin === origin && ['POST', 'PUT'].includes(req.method()) && /\/api\/(documents|vault)/.test(req.url())) writes.push({ path: new URL(req.url()).pathname, user: req.headers()['x-wraiter-user'], body: req.postDataJSON() }); });
  const output = path.join(__dirname, '../test-output/web-cloud'); fs.mkdirSync(output, { recursive: true });
  const shot = name => page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  const library = () => page.getByRole('heading', { name: 'Document library', exact: true }).waitFor();
  let key, userId;
  const unlock = async () => { await library(); assert.equal(await page.locator('input[name=vault-passphrase]').count(), 0); };
  const list = async () => (await context.request.get(origin + '/api/documents')).json();
  const detail = async id => { const row = await (await context.request.get(origin + '/api/documents/' + id)).json(); return { ...row, ...await openDocument(key, userId, id, row.sealed) }; };
  try {
    await page.goto(origin); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.locator('.web-auth-story .web-brand-mark').evaluate(node => node.tagName), 'IMG');
    const brandImage = await page.locator('.web-auth-story .web-brand-mark').getAttribute('src'); assert.ok(brandImage.startsWith('data:image/svg+xml') || /icon-.*\.svg$/.test(brandImage));
    assert.equal(await page.locator('.web-submit').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(23, 92, 170)');
    assert.match(await page.locator('.web-auth').evaluate(node => getComputedStyle(node).fontFamily), /Segoe UI/); await shot('login-desktop');
    assert.doesNotMatch(await page.locator('body').innerText(), /next chapter|little room|quiet place|fresh start|way back|your words|workspace is waiting/i);
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await shot('login-mobile');
    await page.getByRole('button', { name: 'Create an account', exact: true }).click(); await shot('register-mobile');
    await page.setViewportSize({ width: 320, height: 568 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('input[name=email]').fill('web-test@example.com'); await page.locator('input[name=password]').fill('myfirstdraft2026'); await page.locator('input[name=password-confirmation]').fill('myfirstdraft2026');
    await page.getByRole('button', { name: 'Create account', exact: true }).click(); await page.getByText('Check your email for the confirmation link.', { exact: false }).waitFor();
    assert.equal(messages.length, 1); assert.equal(messages[0].kind, 'verify'); userId = app.store.user('web-test@example.com').id;
    const legacy = newProject(); legacy.title = 'Legacy private title'; legacy.chapters[0].content.content[0].content = [{ type: 'text', text: 'Legacy content retained during encryption.' }];
    app.store.db.prepare('INSERT INTO documents(id,user_id,title,project,journal,revision,bytes,updated_at,sealed) VALUES(?,?,?,?,?,?,?,?,NULL)').run(legacy.id, userId, legacy.title, JSON.stringify(legacy), '[]', 1, JSON.stringify(legacy).length, new Date().toISOString());
    await page.goto(messages[0].link); await page.getByRole('button', { name: 'Confirm my email' }).click(); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); assert.equal(await page.locator('input[name=email]').inputValue(), 'web-test@example.com');
    // Seed a previous release's plaintext browser recovery and ensure unlock rewrites it.
    await page.evaluate(async ({ userId, legacy }) => new Promise((resolve, reject) => { const req = indexedDB.open('wraiter-cloud-recovery', 1); req.onupgradeneeded = () => req.result.createObjectStore('documents', { keyPath: 'key' }); req.onsuccess = () => { const tx = req.result.transaction('documents', 'readwrite'); tx.objectStore('documents').put({ key: userId + ':' + legacy.id, userId, project: legacy, journal: [], revision: 1, cloudId: legacy.id, pending: false }); tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = reject; }; req.onerror = reject; }), { userId, legacy });
    await page.locator('input[name=password]').fill('myfirstdraft2026'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await library();
    const vault = await (await context.request.get(origin + '/api/vault')).json(); key = await unlockAccountVault(userId, vault.vault, 'myfirstdraft2026'); assert.equal(vault.vault.version, 2); assert.equal(vault.vault.recovery, null); assert.equal(vault.legacyDocuments, 0);
    assert.match(JSON.stringify((await detail(legacy.id)).project), /Legacy content retained/);
    const legacyRow = app.store.db.prepare('SELECT title,project,journal,sealed FROM documents WHERE user_id=? AND id=?').get(userId, legacy.id); assert.equal(legacyRow.title, 'Encrypted document'); assert.equal(legacyRow.project, '{}'); assert.equal(legacyRow.journal, '[]'); assert.doesNotMatch(legacyRow.sealed, /Legacy private title|Legacy content/);
    await shot('library-desktop');
    // The authenticated browser cache opens documents again without another password.
    await page.reload(); await library(); assert.equal(await page.locator('input[type=password]').count(), 0);
    const cached = await page.evaluate(() => new Promise(resolve => { const r = indexedDB.open('wraiter-session-keys', 1); r.onsuccess = () => { const q = r.result.transaction('keys').objectStore('keys').getAll(); q.onsuccess = () => resolve(q.result.map(item => ({ userId: item.userId, tag: item.sessionCacheTag, keyType: item.key?.constructor.name, fields: Object.keys(item) }))); }; })); assert.equal(cached.length, 1); assert.equal(cached[0].keyType, 'CryptoKey'); assert.ok(cached[0].tag); assert.ok(!cached[0].fields.some(name => /password|secret|raw/i.test(name)));
    await page.getByRole('button', { name: 'New document', exact: true }).click(); const editor = page.locator('.tiptap[contenteditable=true]').first(); await editor.waitFor(); const originalId = await page.evaluate(() => window.wraiter.currentProject().id); await editor.click(); await page.keyboard.type('A story saved from the browser.');
    // Capture MIME payloads without writing to the operator's clipboard.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async items => {
      window.literatureClipboard = Object.fromEntries(await Promise.all(items[0].types.map(async type => [type, await (await items[0].getType(type)).text()])));
    } } }));
    await page.evaluate(() => window.wraiter.emitCommand('export'));
    await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('deviantart');
    await page.getByLabel('Include manuscript title', { exact: true }).uncheck(); await page.getByLabel('Include chapter headings', { exact: true }).uncheck();
    assert.equal(await page.getByRole('combobox', { name: 'Export destination', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click(); await page.getByRole('dialog', { name: 'Export document', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.literatureClipboard), { 'text/html': '<p>A story saved from the browser.</p>', 'text/plain': 'A story saved from the browser.' });
    await page.evaluate(() => { navigator.clipboard.write = async () => { throw new Error('Clipboard access denied'); }; window.literatureClipboard = null; });
    await page.evaluate(() => window.wraiter.emitCommand('export')); await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click();
    await page.getByText('Clipboard access denied', { exact: true }).waitFor(); assert.ok(await page.getByRole('dialog', { name: 'Export document', exact: true }).isVisible());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Library', exact: true }).first().click(); await library(); assert.equal((await list()).documents.length, 2); let current = await detail(originalId); assert.match(JSON.stringify(current.project), /A story saved from the browser/); assert.ok(current.journal.length > 0);
    await page.getByRole('button', { name: /Untitled manuscript.*Continue writing/s }).click(); await editor.waitFor(); await page.reload(); await unlock(); await page.getByRole('button', { name: /Untitled manuscript.*Continue writing/s }).click(); await editor.waitFor();
    await editor.click(); await page.keyboard.press('Control+z'); assert.notEqual((await editor.innerText()).trim(), 'A story saved from the browser.'); await page.keyboard.press('Control+y'); assert.equal((await editor.innerText()).trim(), 'A story saved from the browser.');
    await page.evaluate(() => window.wraiter.emitCommand('save-copy')); await page.waitForFunction(original => window.wraiter.currentProject()?.id !== original, originalId); const copiedId = await page.evaluate(() => window.wraiter.currentProject().id); assert.equal((await detail(copiedId)).project.id, copiedId);
    await page.getByRole('button', { name: 'Library', exact: true }).first().click(); await library();
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download Untitled manuscript', exact: true }).first().click(); const exported = JSON.parse(fs.readFileSync(await (await downloaded).path(), 'utf8')); assert.equal(exported.format, 'wraiter');
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Import document', exact: true }).click(); await (await chooser).setFiles({ name: 'Imported copy.wraiter', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...exported, title: 'Imported copy' })) }); await editor.waitFor(); await page.getByRole('button', { name: 'Library', exact: true }).first().click(); await library(); assert.equal((await list()).documents.length, 4);
    const zipDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download library', exact: true }).click(); const archive = await JSZip.loadAsync(fs.readFileSync(await (await zipDownload).path())); const manuscripts = Object.values(archive.files).filter(file => !file.dir && file.name.endsWith('.wraiter')); assert.equal(manuscripts.length, 4); assert.equal(new Set(manuscripts.map(file => file.name)).size, 4); for (const file of manuscripts) assert.equal(JSON.parse(await file.async('string')).format, 'wraiter'); assert.ok(Object.keys(archive.files).some(name => /history.*\.json$/.test(name)), 'Archive preserves editing history separately');
    for (const [theme, background, accent] of [['paper', 'rgb(227, 229, 232)', 'rgb(23, 92, 170)'], ['dark', 'rgb(26, 28, 31)', 'rgb(139, 188, 255)'], ['contrast', 'rgb(0, 0, 0)', 'rgb(128, 229, 255)']]) {
      assert.equal((await context.request.put(origin + '/api/settings', { headers, data: { theme } })).status(), 200); await page.reload(); await unlock(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme); assert.equal(await page.locator('.web-library').evaluate(node => getComputedStyle(node).backgroundColor), background); assert.equal(await page.locator('.web-submit').evaluate(node => getComputedStyle(node).backgroundColor), accent); await shot('library-' + theme);
    }
    await context.request.put(origin + '/api/settings', { headers, data: { theme: 'paper' } }); await page.reload(); await unlock(); await page.getByRole('button', { name: /Untitled manuscript.*Continue writing/s }).first().click(); await editor.waitFor(); const activeId = await page.evaluate(() => window.wraiter.currentProject().id);
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.locator('.mobile-writing-bar').isVisible()); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await shot('editor-mobile'); await page.setViewportSize({ width: 1440, height: 960 }); assert.ok(await page.locator('.sidebar').isVisible(), 'Desktop sidebar restores after mobile resize'); await page.setViewportSize({ width: 390, height: 844 });
    current = await detail(activeId); const changed = await sealDocument(key, userId, activeId, { project: { ...current.project, title: 'Changed elsewhere' }, journal: current.journal }); assert.equal((await context.request.put(origin + '/api/documents/' + activeId, { headers, data: { sealed: changed, baseRevision: current.revision } })).status(), 200);
    await editor.click(); await page.keyboard.press('End'); await page.keyboard.type(' Keep this local recovery.'); await page.getByText(/This document changed in another window or device/).first().waitFor({ timeout: 15000 }); current = await detail(activeId); assert.equal(current.project.title, 'Changed elsewhere'); assert.doesNotMatch(JSON.stringify(current.project), /Keep this local recovery/);
    await page.getByRole('button', { name: 'Library', exact: true }).first().click(); await page.getByRole('heading', { name: 'Browser recovery drafts' }).waitFor(); assert.ok(await page.getByRole('button', { name: 'Download recovery' }).isVisible());
    const recoveryRecords = await page.evaluate(async () => new Promise((resolve, reject) => { const opening = indexedDB.open('wraiter-cloud-recovery', 1); opening.onsuccess = () => { const tx = opening.result.transaction('documents'), req = tx.objectStore('documents').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = reject; }; opening.onerror = reject; })); assert.ok(recoveryRecords.length > 0); assert.ok(recoveryRecords.every(record => record.sealed && !record.project && !record.journal)); assert.doesNotMatch(JSON.stringify(recoveryRecords), /Keep this local recovery|A story saved|Legacy content|Legacy private title/);
    const copied = await page.evaluate(async () => { const api = window.wraiter, project = api.currentProject(), target = await api.chooseSaveTarget({ copy: true }); return api.saveEncoded(project, null, { token: target.token }, []); }); assert.equal(copied.revision, 1); assert.equal((await list()).documents.length, 5); const recoveryCopyId = await page.evaluate(() => window.wraiter.currentProject().id); assert.match(JSON.stringify((await detail(recoveryCopyId)).project), /Keep this local recovery/);
    const rawList = await list(); assert.ok(rawList.documents.every(item => item.encrypted && !item.title)); assert.doesNotMatch(JSON.stringify(rawList), /Untitled manuscript|Legacy private title|Changed elsewhere|Imported copy/);
    assert.ok(writes.filter(item => item.path.startsWith('/api/documents')).every(item => item.body.sealed && !item.body.project && !item.body.journal)); assert.doesNotMatch(JSON.stringify(writes), /A story saved|Keep this local recovery|Legacy content|separate document passphrase|WRAITER-RECOVERY-1-/);
    assert.ok(writes.every(item => item.user === userId), 'Every browser vault/document mutation is bound to its key owner');
    const damagedProject = newProject(); damagedProject.title = 'Corrupt metadata source'; const damaged = await sealDocument(key, userId, damagedProject.id, { project: damagedProject, journal: [] }); damaged.metadata.ciphertext = (damaged.metadata.ciphertext[0] === 'A' ? 'B' : 'A') + damaged.metadata.ciphertext.slice(1); app.store.save(userId, damagedProject.id, { sealed: damaged }, true);
    app.store.db.prepare('INSERT INTO documents(id,user_id,title,project,journal,revision,bytes,updated_at,sealed) VALUES(?,?,?,?,?,?,?,?,NULL)').run('invalid-legacy', userId, 'Invalid earlier document', '{}', '{}', 1, 4, new Date().toISOString());
    await page.evaluate(async ({ userId, sealed }) => new Promise(resolve => { const req = indexedDB.open('wraiter-cloud-recovery', 1); req.onsuccess = () => { const tx = req.result.transaction('documents', 'readwrite'); tx.objectStore('documents').put({ key: userId + ':damaged-recovery', userId, projectId: 'damaged-recovery', sealed, pending: true, savedAt: new Date().toISOString() }); tx.oncomplete = resolve; }; }), { userId, sealed: damaged });
    await page.reload(); await unlock(); await page.getByRole('heading', { name: 'Unable to decrypt document', exact: true }).waitFor(); await page.getByRole('heading', { name: 'Imported copy', exact: true }).waitFor(); await page.getByText(/^Unable to decrypt browser recovery/).waitFor(); await page.getByRole('heading', { name: 'Earlier unencrypted documents', exact: true }).waitFor(); assert.ok(await page.getByRole('button', { name: 'Retry encryption', exact: true }).isVisible());
    const damagedDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download encrypted ' + damagedProject.id, exact: true }).click(); assert.deepEqual(JSON.parse(fs.readFileSync(await (await damagedDownload).path(), 'utf8')).sealed, damaged, 'Damaged encrypted record can be downloaded unchanged');
    const storedRecovery = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download recovery', exact: true }).last().click(); assert.deepEqual(JSON.parse(fs.readFileSync(await (await storedRecovery).path(), 'utf8')).sealed, damaged, 'Damaged recovery remains downloadable unchanged');
    const legacyDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download Invalid earlier document', exact: true }).click(); const invalidStored = JSON.parse(fs.readFileSync(await (await legacyDownload).path(), 'utf8')); assert.deepEqual(invalidStored.project, {}); assert.deepEqual(invalidStored.journal, {});
    // A second tab's account cookie must not redirect the first tab's encrypted saves.
    const { hashPassword } = require('../cloud/auth.cjs'), other = app.store.createUser('other-web@example.com', await hashPassword('otherpassword2026')); app.store.verify(other.id);
    const delayedProject = newProject(); delayedProject.title = 'Delayed private document';
    await page.evaluate(project => {
      const prototype = Object.getPrototypeOf(crypto.subtle), original = prototype.encrypt; let payloads = 0;
      window.delayedAdapter = window.wraiter;
      prototype.encrypt = async function(algorithm, ...args) {
        const result = await original.call(this, algorithm, ...args);
        const context = algorithm.additionalData && JSON.parse(new TextDecoder().decode(algorithm.additionalData));
        if (context?.[2] === 'document-payload' && ++payloads === 2) { window.encryptionHeld = true; await new Promise(resolve => { window.releaseEncryption = () => { prototype.encrypt = original; resolve(); }; }); }
        return result;
      };
      window.delayedWork = window.wraiter.newProject(project).then(() => { window.delayedResult = { ok: true }; }, error => { window.delayedResult = { ok: false, message: error.message }; });
    }, delayedProject);
    await page.waitForFunction(() => window.encryptionHeld === true);
    assert.equal((await context.request.post(origin + '/api/auth/login', { headers, data: { email: other.email, password: 'otherpassword2026' } })).status(), 200);
    await page.evaluate(() => window.delayedAdapter.settings({ theme: 'paper' }).catch(() => {})); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); await page.getByText('Your account changed in another tab. Sign in again.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.wraiter), undefined, 'Account mismatch releases the old adapter');
    await page.locator('input[name=email]').fill(other.email); await page.locator('input[name=password]').fill('otherpassword2026'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await library();
    await page.evaluate(() => window.releaseEncryption()); await page.waitForFunction(() => window.delayedResult); assert.equal((await page.evaluate(() => window.delayedResult)).ok, false);
    assert.equal(app.store.list(other.id).documents.length, 0, 'Old encryption finishing after disposal and B sign-in cannot upload into B'); assert.equal(app.store.db.prepare('SELECT 1 FROM documents WHERE user_id=? AND id=?').get(userId, delayedProject.id), undefined);
    assert.equal(writes.find(item => item.body.id === delayedProject.id)?.user, userId, 'Delayed adapter request retains A even after global identity becomes B'); await library();
    await page.locator('.web-header-actions > button').last().click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await page.locator('input[name=email]').fill('web-test@example.com'); await page.locator('input[name=password]').fill('myfirstdraft2026'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await unlock();
    await page.locator('.web-header-actions > button').last().click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.wraiter), undefined);
    await page.locator('input[name=email]').fill('web-test@example.com'); await page.locator('input[name=password]').fill('myfirstdraft2026'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await library();
    await page.locator('.web-header-actions > button').last().click(); await page.getByRole('button', { name: 'Delete account…', exact: true }).click(); await page.locator('.web-delete-form input').fill('myfirstdraft2026'); await page.getByRole('button', { name: 'Delete my account and data', exact: true }).click(); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); assert.equal(app.store.user('web-test@example.com'), undefined, 'Account deletion removes the signed-in account');
    await page.goto(origin + '/privacy.html'); await page.getByRole('heading', { name: 'Your writing and your data' }).waitFor(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await shot('privacy-mobile');
    assert.deepEqual(errors, []); console.log('PASS encrypted vault/recovery/migration, opaque storage, cloud editor/import/undo/conflicts, ZIP, themes/resize, damaged-record isolation, delayed stale-account request binding and locked-account deletion');
  } catch (error) { await shot('integration-failure').catch(() => {}); console.error('Browser state:', (await page.locator('body').innerText().catch(() => '')).slice(0, 1800)); throw error; }
  finally { await browser.close(); await new Promise(resolve => app.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
