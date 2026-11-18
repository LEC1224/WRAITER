const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { atomicWrite, validateProject } = require('./core.cjs');
const vaultCrypto = import('../src/cloud-vault.js');

const CLOUD_ORIGIN = 'https://wraiter.lecani.se';
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const documentId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new Error('Invalid cloud document.');
  return encodeURIComponent(value);
};

// The browser never receives the device token. Only an encrypted token is kept
// on disk, and requests can only go to the first-party HTTPS service.
class CloudClient {
  constructor(directory, { safeStorage, fetch: request = globalThis.fetch } = {}) {
    this.filename = path.join(directory, 'cloud-account.json'); this.safeStorage = safeStorage;
    this.fetch = request; this.state = null; this.pendingAccountPassword = null; this.clearUnlocked();
  }
  clearUnlocked() { this.vaultKey = null; this.vaultUserId = null; this.vaultFingerprint = null; this.migration = null; }
  async lockVault() {
    this.clearUnlocked(); this.pendingAccountPassword = null;
    const state = await this.load();
    if (state?.keyCache) {
      const { keyCache, ...withoutCache } = state;
      try { await this.persist(withoutCache); }
      catch (error) { this.state = null; await fs.rm(this.filename, { force: true }); throw error; }
    }
    return { unlocked: false };
  }
  async load() {
    if (this.state) return this.state;
    try {
      const saved = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (saved.version !== 1 || typeof saved.encrypted !== 'string') throw new Error('Invalid saved cloud account.');
      this.state = JSON.parse(this.safeStorage.decryptString(Buffer.from(saved.encrypted, 'base64')));
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Your saved cloud sign-in could not be unlocked. Sign out and sign in again.'); }
    return this.state;
  }
  async persist(state) {
    if (!this.safeStorage?.isEncryptionAvailable()) throw new Error('Secure account storage is unavailable. Your cloud sign-in was not saved.');
    await atomicWrite(this.filename, JSON.stringify({ version: 1, encrypted: this.safeStorage.encryptString(JSON.stringify(state)).toString('base64') }));
    this.state = state;
  }
  async request(route, { method = 'GET', body, anonymous = false, expectedUserId, expectedToken } = {}) {
    const state = anonymous ? null : await this.load();
    if (!anonymous && !state?.token) throw new Error('Sign in to your WRAITER cloud account first.');
    if (expectedUserId && state?.userId !== expectedUserId) throw new Error('Your cloud account changed. Sign in and unlock its document vault again.');
    if (expectedToken && state?.token !== expectedToken) throw new Error('Your cloud sign-in changed. Try again from its current session.');
    const response = await this.fetch(CLOUD_ORIGIN + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { 'X-Wraiter-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(state?.token ? { Authorization: `Bearer ${state.token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !anonymous && this.state?.token === state.token) await this.lockVault();
      const error = new Error(response.status === 409 ? 'This cloud document changed on another device. Open its current cloud copy, or upload this draft as a new document to preserve both.' : String(result.error || result.message || `Cloud request failed (${response.status}).`));
      error.code = response.status; throw error;
    }
    return result;
  }
  async status() {
    const state = await this.load();
    if (!state?.token) return { connected: false, origin: CLOUD_ORIGIN };
    try { return { ...(await this.request('/api/auth/me')), connected: true, origin: CLOUD_ORIGIN, vault: await this.vaultStatus() }; }
    catch (error) { if (error.code === 401) return { connected: false, origin: CLOUD_ORIGIN, message: 'Your cloud sign-in expired. Sign in again.' }; throw error; }
  }
  async login({ email, password } = {}) {
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 320 || password.length > 1024) throw new Error('Enter your email and password.');
    const result = await this.request('/api/auth/login', { method: 'POST', anonymous: true, body: { email, password, device: true } });
    if (typeof result.token !== 'string' || !result.user?.id) throw new Error('The cloud server did not return a device sign-in.');
    const old = await this.load().catch(() => null);
    this.clearUnlocked();
    await this.persist({ token: result.token, userId: result.user.id, links: old?.userId === result.user.id ? old.links || {} : {} });
    this.pendingAccountPassword = password;
    await this.prepareAccountVault(password);
    return this.status();
  }
  async logout() {
    try { const state = await this.load().catch(() => null); if (state?.token) await this.request('/api/auth/logout', { method: 'POST', body: {}, expectedUserId: state.userId, expectedToken: state.token }); }
    finally { this.clearUnlocked(); this.pendingAccountPassword = null; this.state = null; await fs.rm(this.filename, { force: true }); }
    return { connected: false, origin: CLOUD_ORIGIN };
  }
  async vaultStatus() {
    const state = await this.load(), result = await this.request('/api/vault', { expectedUserId: state?.userId, expectedToken: state?.token });
    await this.sameAccount(state);
    const fingerprint = result.vault && digest(JSON.stringify(result.vault));
    if (this.vaultKey && (this.vaultUserId !== state.userId || this.vaultFingerprint !== fingerprint)) await this.lockVault();
    if (!this.vaultKey && result.vault?.version === 2 && state.keyCache?.userId === state.userId && state.keyCache.session === digest(state.token) && state.keyCache.vault === fingerprint) {
      const raw = Buffer.from(state.keyCache.key, 'base64');
      try {
        if (raw.length !== 32) throw new Error('Invalid cached document key.');
        const key = await globalThis.crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
        await this.sameAccount(state); this.vaultKey = key;
        this.vaultUserId = state.userId; this.vaultFingerprint = fingerprint;
      } catch (error) { await this.sameAccount(state); await this.lockVault(); }
      finally { raw.fill(0); }
    }
    return { exists: Boolean(result.vault), version: result.vault?.version, unlocked: Boolean(this.vaultKey && this.vaultUserId === state.userId), revision: result.revision, legacyDocuments: result.legacyDocuments || 0, migration: this.migration, needsLegacyMigration: result.vault?.version === 1, canUseRecoveryKey: Boolean(result.vault?.recovery), needsAccountPassword: !this.pendingAccountPassword };
  }
  async unlocked() {
    const state = await this.load();
    if (state?.token && !this.vaultKey) await this.status();
    if (!state?.token || !this.vaultKey || this.vaultUserId !== state.userId) throw new Error('Sign in again to unlock encrypted documents, or recover them with your earlier password.');
    return { state, key: this.vaultKey };
  }
  async sameAccount(state) {
    const current = await this.load();
    if (current?.userId !== state.userId || current?.token !== state.token) throw new Error('Your cloud account changed. Unlock its document vault again.');
  }
  async cacheVaultKey(state, vault, key) {
    const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key));
    try {
      await this.sameAccount(state); const latest = await this.load();
      await this.persist({ ...latest, keyCache: { userId: state.userId, session: digest(state.token), vault: digest(JSON.stringify(vault)), key: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('base64') } });
    } finally { raw.fill(0); }
  }
  async installVaultKey(state, vault, key) {
    await this.sameAccount(state); await this.cacheVaultKey(state, vault, key);
    this.vaultKey = key; this.vaultUserId = state.userId; this.vaultFingerprint = digest(JSON.stringify(vault)); this.pendingAccountPassword = null;
    try { await this.migrateLegacy(); }
    catch (error) { this.migration = { migrated: 0, failures: [{ message: error.message }] }; }
  }
  async prepareAccountVault(password) {
    const state = await this.load(), crypto = await vaultCrypto;
    let current = await this.request('/api/vault', { expectedUserId: state.userId, expectedToken: state.token }), key;
    if (!current.vault) {
      const created = await crypto.createAccountVault(state.userId, password);
      try { await this.request('/api/vault', { method: 'PUT', expectedUserId: state.userId, expectedToken: state.token, body: { vault: created.vault, baseRevision: current.revision } }); current.vault = created.vault; key = created.key; }
      catch (error) { if (error.code !== 409) throw error; current = await this.request('/api/vault', { expectedUserId: state.userId, expectedToken: state.token }); }
    }
    if (!key) {
      try { key = current.vault.version === 1 ? await crypto.unlockVault(state.userId, current.vault, password) : await crypto.unlockAccountVault(state.userId, current.vault, password); }
      catch { return; } // Existing data stays intact; the UI offers one-time recovery.
    }
    if (current.vault.version === 1) {
      const vault = await crypto.bindVaultToAccount(state.userId, current.vault, key, password);
      await this.request('/api/vault', { method: 'PUT', expectedUserId: state.userId, expectedToken: state.token, body: { vault, baseRevision: current.revision } }); current.vault = vault;
    }
    await this.installVaultKey(state, current.vault, key);
  }
  async recoverVault({ oldSecret, accountPassword, recovery = false } = {}) {
    let state = await this.load(); const account = await this.request('/api/auth/me', { expectedUserId: state?.userId, expectedToken: state?.token });
    await this.sameAccount(state);
    const password = accountPassword || this.pendingAccountPassword;
    if (!password) throw new Error('Enter your current account password to finish the one-time recovery.');
    if (accountPassword) {
      const result = await this.request('/api/auth/login', { method: 'POST', anonymous: true, body: { email: account.user.email, password, device: true } });
      if (result.user?.id !== state.userId || typeof result.token !== 'string') throw new Error('The account changed during recovery. Sign in again.');
      await this.sameAccount(state);
      this.clearUnlocked(); await this.persist({ token: result.token, userId: state.userId, links: state.links || {} }); state = await this.load(); this.pendingAccountPassword = password;
    }
    const current = await this.request('/api/vault', { expectedUserId: state.userId, expectedToken: state.token });
    if (!current.vault) throw new Error('No earlier encrypted documents need recovery. Sign out and sign in again.');
    const crypto = await vaultCrypto, key = await crypto.unlockVault(state.userId, current.vault, oldSecret, { recovery });
    const vault = await crypto.bindVaultToAccount(state.userId, current.vault, key, password);
    await this.request('/api/vault', { method: 'PUT', expectedUserId: state.userId, expectedToken: state.token, body: { vault, baseRevision: current.revision } });
    await this.installVaultKey(state, vault, key); return this.vaultStatus();
  }
  createVault() { throw new Error('Document encryption is set up automatically when you sign in. Sign out and sign in again.'); }
  unlockVault(oldSecret, recovery = false) { return this.recoverVault({ oldSecret, recovery }); }
  changeVaultPassphrase() { throw new Error('Documents now use your account password. Change it from account settings in WRAITER web.'); }
  async migrateLegacy() {
    const { state, key } = await this.unlocked(), crypto = await vaultCrypto;
    const listing = await this.request('/api/documents', { expectedUserId: state.userId, expectedToken: state.token }), report = { migrated: 0, failures: [] };
    for (const row of listing.documents.filter(row => row.legacy)) {
      try {
        const saved = await this.request('/api/documents/' + documentId(row.id), { expectedUserId: state.userId, expectedToken: state.token });
        if (saved.encrypted || saved.sealed) continue;
        validateProject(saved.project);
        const journal = Array.isArray(saved.journal) ? saved.journal : saved.journal?.events;
        if (!Array.isArray(journal)) throw new Error('The existing editing history is invalid. Download this document before continuing.');
        const sealed = await crypto.sealDocument(key, state.userId, row.id, { project: saved.project, journal });
        const result = await this.request('/api/documents/' + documentId(row.id), { method: 'PUT', expectedUserId: state.userId, expectedToken: state.token, body: { id: row.id, sealed, baseRevision: saved.revision } });
        await this.sameAccount(state);
        const latest = await this.load(), links = Object.fromEntries(Object.entries(latest.links || {}).map(([id, link]) => [id, link.id === row.id && link.revision === saved.revision ? { ...link, revision: result.revision } : link]));
        await this.persist({ ...latest, links }); report.migrated++;
      } catch (error) { report.failures.push({ id: row.id, message: error.message }); }
    }
    await this.sameAccount(state); this.migration = report; return report;
  }
  async list() {
    const { state, key } = await this.unlocked(), result = await this.request('/api/documents', { expectedUserId: state.userId, expectedToken: state.token }), crypto = await vaultCrypto;
    const documents = await Promise.all(result.documents.map(async row => {
      if (row.legacy) return { ...row, title: row.title || 'Earlier unencrypted document' };
      try { return { ...row, ...(await crypto.openMetadata(key, state.userId, row.id, row.metadata)) }; }
      catch { return { ...row, title: 'Unable to decrypt document', unreadable: true }; }
    }));
    await this.sameAccount(state); return { ...result, documents };
  }
  async get(id) {
    const { state, key } = await this.unlocked(), saved = await this.request('/api/documents/' + documentId(id), { expectedUserId: state.userId, expectedToken: state.token });
    if (saved.legacy) { validateProject(saved.project); await this.sameAccount(state); return saved; }
    const document = await (await vaultCrypto).openDocument(key, state.userId, id, saved.sealed || saved);
    validateProject(document.project); await this.sameAccount(state); return { ...saved, ...document };
  }
  async upload(project, journal, asNew = false) {
    validateProject(project);
    const { state, key } = await this.unlocked(), link = !asNew && state.links && Object.hasOwn(state.links, project.id) ? state.links[project.id] : null;
    // A desktop transfer is a content snapshot with a fresh cloud undo baseline.
    // Its distinct cloud identity avoids overwriting another local/cloud draft;
    // the source manuscript and its complete local journal remain untouched.
    const cloudProject = { ...project, id: link?.projectId || randomUUID() };
    delete cloudProject.historySequence;
    const safeJournal = [];
    const cloudId = link?.id || cloudProject.id, sealed = await (await vaultCrypto).sealDocument(key, state.userId, cloudId, { project: cloudProject, journal: safeJournal });
    const result = await this.request(link ? '/api/documents/' + documentId(cloudId) : '/api/documents', { method: link ? 'PUT' : 'POST', expectedUserId: state.userId, expectedToken: state.token, body: { id: cloudId, sealed, ...(link ? { baseRevision: link.revision } : {}) } });
    const id = result.id || result.document?.id;
    if (!id || !Number.isSafeInteger(result.revision)) throw new Error('The cloud save did not return a document revision.');
    await this.sameAccount(state); const current = await this.load();
    await this.persist({ ...current, links: { ...(current.links || {}), [project.id]: { id, revision: result.revision, projectId: cloudProject.id } } });
    return result;
  }
  async link(localId, cloudId, revision, projectId) {
    const state = await this.load();
    await this.persist({ ...state, links: { ...(state.links || {}), [localId]: { id: cloudId, revision, projectId } } });
  }
}
module.exports = { CloudClient, CLOUD_ORIGIN };
