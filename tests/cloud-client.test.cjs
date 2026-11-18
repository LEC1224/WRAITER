const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CloudClient, CLOUD_ORIGIN } = require('../electron/cloud-client.cjs');

const secure = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from([...text].reverse().join('')), decryptString: bytes => [...bytes.toString()].reverse().join('') };
const manuscript = id => ({ format: 'wraiter', version: 1, id, title: 'Cloud test', language: 'en-US', createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z', chapters: [{ id: 'chapter1', title: 'Chapter one', content: { type: 'doc', content: [{ type: 'paragraph' }] } }], references: [], notes: '', style: '', snapshots: [], chats: [] });
const response = (result, status = 200) => ({ ok: status < 400, status, json: async () => result });
const cryptography = import('../src/cloud-vault.js');
async function unlockFixture(client) { client.vaultKey = (await (await cryptography).createVault('user1', 'independent document passphrase')).key; client.vaultUserId = 'user1'; }

test('cloud credentials stay in the main process, encrypt at rest and restrict all requests to HTTPS service', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-cloud-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [], token = 'synthetic-device-token'; let vault = null, revision = 0;
  const client = new CloudClient(directory, { safeStorage: secure, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/vault')) { if (options.method === 'PUT') { vault = JSON.parse(options.body).vault; revision++; } return response({ vault, revision, legacyDocuments: 0 }); }
    if (url.endsWith('/documents')) return response({ documents: [] });
    return response(url.endsWith('/login') ? { user: { id: 'user1', email: 'test@example.test' }, token } : { user: { id: 'user1', email: 'test@example.test' }, quotaBytes: 1000000000, usedBytes: 0 });
  } });
  const status = await client.login({ email: 'test@example.test', password: 'synthetic123' });
  assert.equal(status.connected, true); assert.equal(status.token, undefined); assert.equal(status.vault.unlocked, true); assert.equal(vault.version, 2); assert.equal(vault.recovery, null); assert.equal(client.pendingAccountPassword, null);
  assert.equal(calls[0].url, CLOUD_ORIGIN + '/api/auth/login'); assert.equal(JSON.parse(calls[0].options.body).device, true);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${token}`); assert.equal(calls[1].options.redirect, 'error');
  const saved = await fs.readFile(client.filename, 'utf8'); assert.ok(!saved.includes(token)); assert.ok(!saved.includes('synthetic123'));
  const reloaded = new CloudClient(directory, { safeStorage: secure, fetch: client.fetch }); assert.equal((await reloaded.status()).vault.unlocked, true);
  const cached = await reloaded.load(); await reloaded.persist({ ...cached, token: 'different-device-session' }); reloaded.clearUnlocked();
  assert.equal((await reloaded.status()).vault.unlocked, false, 'A key cache cannot be reused by a different session token');
  await reloaded.persist({ ...cached, keyCache: { ...cached.keyCache, userId: 'another-user' } });
  assert.equal((await reloaded.status()).vault.unlocked, false, 'A key cache cannot be reused by a different user');
  await reloaded.persist(cached); vault = (await (await cryptography).createAccountVault('user1', 'replacement123')).vault;
  assert.equal((await reloaded.status()).vault.unlocked, false, 'A changed vault descriptor invalidates the saved key');
  await client.logout(); assert.equal(client.vaultKey, null); await assert.rejects(fs.access(client.filename));
});

test('cloud snapshot updates require known revision, retain their own identity and preserve source history', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-cloud-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [], client = new CloudClient(directory, { safeStorage: secure, fetch: async (url, options) => { calls.push({ url, options }); return response({ id: JSON.parse(options.body).id, revision: calls.length + 4 }); } });
  await client.persist({ token: 'test', userId: 'user1', links: {} }); await unlockFixture(client);
  const project = manuscript('local1'), journal = [{ version: 1, kind: 'init', sequence: 1, projectId: 'local1' }];
  await client.upload(project, journal); assert.equal(calls[0].options.method, 'POST');
  await client.upload(project, journal); assert.equal(calls[1].options.method, 'PUT'); assert.equal(JSON.parse(calls[1].options.body).baseRevision, 5);
  await client.link('local2', 'cloud1', 7, 'cloud-original');
  const downloaded = manuscript('local2'), history = [{ ...journal[0], projectId: 'local2' }];
  await client.upload(downloaded, history); const uploaded = JSON.parse(calls[2].options.body);
  const decoded = await (await cryptography).openDocument(client.vaultKey, 'user1', uploaded.id, uploaded.sealed);
  assert.equal(decoded.project.id, 'cloud-original'); assert.deepEqual(decoded.journal, []); assert.equal(uploaded.baseRevision, 7); assert.equal(downloaded.id, 'local2'); assert.equal(history[0].projectId, 'local2');
  await client.upload(downloaded, history, true); assert.equal(calls[3].options.method, 'POST'); const copy = JSON.parse(calls[3].options.body), decodedCopy = await (await cryptography).openDocument(client.vaultKey, 'user1', copy.id, copy.sealed); assert.notEqual(decodedCopy.project.id, decoded.project.id); assert.notEqual(decodedCopy.project.id, downloaded.id); assert.deepEqual(decodedCopy.journal, []); assert.equal(downloaded.id, 'local2');
  for (const call of calls) { assert.equal(JSON.parse(call.options.body).project, undefined); assert.ok(!call.options.body.includes('Cloud test')); }
  await assert.rejects(client.get('../settings'), /Invalid cloud document/);
});

test('failed revision checks leave association unchanged and provide a preserve-both message', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-cloud-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const client = new CloudClient(directory, { safeStorage: secure, fetch: async () => response({ error: 'Conflict' }, 409) });
  await client.persist({ token: 'test', userId: 'user1', links: { local1: { id: 'cloud1', revision: 2 } } }); await unlockFixture(client);
  await assert.rejects(client.upload(manuscript('local1'), []), /preserve both/);
  assert.equal((await client.load()).links.local1.revision, 2);
});

test('cloud sign-in refuses to persist a token when operating-system encryption is unavailable', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-cloud-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const client = new CloudClient(directory, { safeStorage: { ...secure, isEncryptionAvailable: () => false } });
  await assert.rejects(client.persist({ token: 'secret' }), /Secure account storage is unavailable/); await assert.rejects(fs.access(client.filename));
});

test('an earlier asynchronous vault bind cannot borrow a later sign-in for the same user', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-cloud-session-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const earlier = await (await cryptography).createVault('user1', 'synthetic123'), calls = [];
  const client = new CloudClient(directory, { safeStorage: secure, fetch: async (url, options) => {
    calls.push({ url, options });
    return { ...response(null), json: async () => {
      await client.persist({ token: 'later-session', userId: 'user1', links: {} });
      return { vault: earlier.vault, revision: 1, legacyDocuments: 0 };
    } };
  } });
  await client.persist({ token: 'earlier-session', userId: 'user1', links: {} });
  await assert.rejects(client.prepareAccountVault('synthetic123'), /sign-in changed/);
  assert.equal(calls.length, 1); assert.equal(calls[0].options.headers.Authorization, 'Bearer earlier-session');
  assert.equal((await client.load()).token, 'later-session'); assert.equal((await client.load()).keyCache, undefined); assert.equal(client.vaultKey, null);
});

test('desktop snapshot copies stay distinct on the real cloud API and stale uploads preserve server data', async t => {
  const { Store } = require('../cloud/store.cjs'), { createApplication } = require('../cloud/server.cjs'), auth = require('../cloud/auth.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-cloud-api-'));
  const store = new Store(path.join(directory, 'data'));
  const user = store.createUser('desktop@example.test', await auth.hashPassword('synthetic123')); store.verify(user.id);
  const sent = [], { server } = createApplication({ store, env: { WRAITER_ORIGIN: 'http://127.0.0.1', WRAITER_SECURE_COOKIES: '0' }, sendMail: async (...args) => sent.push(args) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const client = new CloudClient(path.join(directory, 'desktop'), { safeStorage: secure, fetch: (url, options) => fetch(`http://127.0.0.1:${server.address().port}` + url.slice(CLOUD_ORIGIN.length), options) });
  await client.login({ email: 'desktop@example.test', password: 'synthetic123' });
  assert.equal((await client.status()).vault.unlocked, true); assert.equal(store.vault(user.id).vault.version, 2);
  const project = manuscript('original-local-id'); project.historySequence = 2;
  const journal = [{ sequence: 1, kind: 'init', projectId: project.id }, { sequence: 2, kind: 'edit', projectId: project.id }];
  const first = await client.upload(project, journal), second = await client.upload(project, journal, true);
  assert.notEqual(first.id, second.id); assert.notEqual(first.id, project.id); assert.equal((await client.list()).documents.length, 2);
  assert.equal(project.historySequence, 2); assert.equal(journal.length, 2);
  project.title = 'Updated desktop draft'; await client.upload(project, journal);
  assert.equal((await client.get(first.id)).project.title, 'Cloud test'); assert.equal((await client.get(second.id)).project.title, project.title);
  const current = await client.get(second.id); current.project.title = 'Newer browser draft';
  store.save(user.id, second.id, { sealed: await (await cryptography).sealDocument(client.vaultKey, user.id, second.id, { project: current.project, journal: current.journal }), baseRevision: current.revision });
  await assert.rejects(client.upload(project, journal), /preserve both/);
  assert.equal((await client.get(second.id)).project.title, 'Newer browser draft'); assert.equal(project.title, 'Updated desktop draft');
  assert.ok(!JSON.stringify(store.document(user.id, second.id)).includes('Newer browser draft'));
  const storedAccount = JSON.parse(secure.decryptString(Buffer.from(JSON.parse(await fs.readFile(client.filename, 'utf8')).encrypted, 'base64')));
  assert.deepEqual(Object.keys(storedAccount).sort(), ['keyCache', 'links', 'token', 'userId']); assert.ok(!JSON.stringify(storedAccount).includes('synthetic123'));
  assert.equal(storedAccount.keyCache.userId, user.id); assert.equal(Buffer.from(storedAccount.keyCache.key, 'base64').length, 32);
  const reloaded = new CloudClient(path.join(directory, 'desktop'), { safeStorage: secure, fetch: client.fetch });
  assert.equal((await reloaded.get(first.id)).project.title, 'Cloud test', 'Restarted client restores its OS-protected key without another prompt');
  const otherDevice = new CloudClient(path.join(directory, 'other-device'), { safeStorage: secure, fetch: client.fetch });
  assert.equal((await otherDevice.login({ email: user.email, password: 'synthetic123' })).vault.unlocked, true);
  assert.equal((await otherDevice.get(first.id)).project.title, 'Cloud test');

  const authRequest = async (route, body) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/` + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wraiter-Request': '1' }, body: JSON.stringify(body) });
  await authRequest('forgot', { email: user.email }); const resetToken = new URLSearchParams(new URL(sent.at(-1)[2]).hash.slice(1)).get('token');
  const earlierVault = JSON.stringify(store.vault(user.id).vault), earlierCiphertext = JSON.stringify(store.document(user.id, first.id).sealed);
  assert.equal((await authRequest('reset', { token: resetToken, password: 'replacement123' })).status, 200);
  assert.equal((await client.status()).connected, false); assert.equal(client.vaultKey, null); assert.equal((await client.load()).keyCache, undefined);
  await client.login({ email: user.email, password: 'replacement123' }); assert.equal((await client.status()).vault.unlocked, false);
  assert.equal(JSON.stringify(store.vault(user.id).vault), earlierVault); assert.equal(JSON.stringify(store.document(user.id, first.id).sealed), earlierCiphertext);
  await assert.rejects(client.recoverVault({ oldSecret: 'replacement123' }), /did not unlock/);
  await client.recoverVault({ oldSecret: 'synthetic123' }); assert.equal((await client.get(first.id)).project.title, 'Cloud test');
  assert.equal(client.pendingAccountPassword, null); assert.equal(JSON.stringify(store.document(user.id, first.id).sealed), earlierCiphertext);
  const afterRecovery = new CloudClient(path.join(directory, 'after-recovery'), { safeStorage: secure, fetch: client.fetch });
  assert.equal((await afterRecovery.login({ email: user.email, password: 'replacement123' })).vault.unlocked, true);
  assert.equal((await afterRecovery.get(first.id)).project.title, 'Cloud test');
});

test('desktop legacy migration encrypts content and history locally and preserves a conflicted copy', async t => {
  const { Store } = require('../cloud/store.cjs'), { createApplication } = require('../cloud/server.cjs'), auth = require('../cloud/auth.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-cloud-migration-')), store = new Store(path.join(directory, 'data'));
  const user = store.createUser('migration@example.test', await auth.hashPassword('synthetic123')); store.verify(user.id);
  const history = [{ sequence: 1, kind: 'init' }, { sequence: 2, kind: 'edit', text: 'Earlier private editing history' }];
  for (const id of ['legacy-success', 'legacy-conflict']) {
    const project = { ...manuscript(id), historySequence: 2, notes: 'Earlier private note' }, projectJSON = JSON.stringify(project), journalJSON = JSON.stringify(history);
    store.db.prepare('INSERT INTO documents(id,user_id,title,project,journal,revision,bytes,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, user.id, project.title, projectJSON, journalJSON, 1, Buffer.byteLength(projectJSON) + Buffer.byteLength(journalJSON), new Date().toISOString());
  }
  const { server } = createApplication({ store, env: { WRAITER_ORIGIN: 'http://127.0.0.1', WRAITER_SECURE_COOKIES: '0' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  let rejectMigration = true; const wire = [];
  const client = new CloudClient(path.join(directory, 'desktop'), { safeStorage: secure, fetch: async (url, options) => {
    if (options.method === 'PUT' && url.includes('/api/documents/')) {
      wire.push(JSON.parse(options.body));
      if (rejectMigration && url.endsWith('/legacy-conflict')) return response({ error: 'A newer copy exists.' }, 409);
    }
    return fetch(`http://127.0.0.1:${server.address().port}` + url.slice(CLOUD_ORIGIN.length), options);
  } });
  const loggedIn = await client.login({ email: user.email, password: 'synthetic123' });
  assert.equal(loggedIn.vault.migration.migrated, 1); assert.equal(loggedIn.vault.migration.failures.length, 1);
  assert.ok(store.document(user.id, 'legacy-success').sealed);
  assert.equal(store.document(user.id, 'legacy-conflict').legacy, true);
  assert.equal(store.document(user.id, 'legacy-conflict').project.notes, 'Earlier private note');
  const restored = await client.get('legacy-success'); assert.equal(restored.project.historySequence, 2); assert.deepEqual(restored.journal, history);
  assert.ok(!JSON.stringify(wire).includes('Earlier private')); assert.ok(wire.every(body => body.sealed && !body.project && !body.journal));
  rejectMigration = false; assert.equal((await client.migrateLegacy()).failures.length, 0);
  assert.equal((await client.vaultStatus()).legacyDocuments, 0);
  assert.deepEqual((await client.get('legacy-conflict')).journal, history);
});

test('earlier passphrase vaults bind the same document key once, preserve recovery and then unlock with account sign-in', async t => {
  const { Store } = require('../cloud/store.cjs'), { createApplication } = require('../cloud/server.cjs'), auth = require('../cloud/auth.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-cloud-v1-')), store = new Store(path.join(directory, 'data')), crypto = await cryptography;
  const user = store.createUser('earlier-vault@example.test', await auth.hashPassword('synthetic123')); store.verify(user.id);
  const earlier = await crypto.createVault(user.id, 'earlier independent document passphrase');
  store.saveVault(user.id, { vault: earlier.vault, baseRevision: 0 });
  const project = manuscript('earlier-document'), journal = [{ sequence: 1, kind: 'init', text: 'Existing private history' }];
  store.save(user.id, project.id, { sealed: await crypto.sealDocument(earlier.key, user.id, project.id, { project, journal }) }, true);
  const descriptor = JSON.stringify(store.vault(user.id).vault), ciphertext = JSON.stringify(store.document(user.id, project.id).sealed);
  const { server } = createApplication({ store, env: { WRAITER_ORIGIN: 'http://127.0.0.1', WRAITER_SECURE_COOKIES: '0' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const request = (url, options) => fetch(`http://127.0.0.1:${server.address().port}` + url.slice(CLOUD_ORIGIN.length), options);
  const client = new CloudClient(path.join(directory, 'desktop'), { safeStorage: secure, fetch: request });
  const status = await client.login({ email: user.email, password: 'synthetic123' });
  assert.equal(status.vault.unlocked, false); assert.equal(status.vault.needsLegacyMigration, true); assert.equal(status.vault.needsAccountPassword, false);
  assert.equal(JSON.stringify(store.vault(user.id).vault), descriptor);
  await assert.rejects(client.recoverVault({ oldSecret: 'incorrect earlier secret' }), /did not unlock/);
  assert.equal(JSON.stringify(store.vault(user.id).vault), descriptor); assert.equal(JSON.stringify(store.document(user.id, project.id).sealed), ciphertext);
  const resumed = new CloudClient(path.join(directory, 'desktop'), { safeStorage: secure, fetch: request });
  assert.equal((await resumed.status()).vault.needsAccountPassword, true);
  await assert.rejects(resumed.recoverVault({ oldSecret: earlier.recoveryKey, recovery: true }), /current account password/);
  await resumed.recoverVault({ oldSecret: earlier.recoveryKey, accountPassword: 'synthetic123', recovery: true });
  const bound = store.vault(user.id).vault; assert.equal(bound.version, 2); assert.deepEqual(bound.recovery, earlier.vault.recovery);
  assert.equal(JSON.stringify(store.document(user.id, project.id).sealed), ciphertext); assert.deepEqual((await resumed.get(project.id)).journal, journal); assert.equal(resumed.pendingAccountPassword, null);
  const other = new CloudClient(path.join(directory, 'other'), { safeStorage: secure, fetch: request });
  assert.equal((await other.login({ email: user.email, password: 'synthetic123' })).vault.unlocked, true); assert.deepEqual((await other.get(project.id)).journal, journal);

  // A v1 vault that already used the account password needs no migration form.
  const matching = store.createUser('matching-vault@example.test', await auth.hashPassword('synthetic123')); store.verify(matching.id);
  const matchingVault = await crypto.createVault(matching.id, 'synthetic123'); store.saveVault(matching.id, { vault: matchingVault.vault, baseRevision: 0 });
  const automatic = new CloudClient(path.join(directory, 'matching'), { safeStorage: secure, fetch: request });
  assert.equal((await automatic.login({ email: matching.email, password: 'synthetic123' })).vault.unlocked, true);
  assert.equal(store.vault(matching.id).vault.version, 2); assert.deepEqual(store.vault(matching.id).vault.recovery, matchingVault.vault.recovery);
});
