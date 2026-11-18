const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const QUOTA = 1_000_000_000;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024 + 16;
const MAX_METADATA_BYTES = 64 * 1024;
class CloudError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value,key))) throw new CloudError(400,`Invalid ${label}. Reload the updated WRAITER app.`,'INVALID_ENCRYPTED_DATA');
}
function base64(value, minimum, maximum, label) {
  if (typeof value !== 'string' || value.length % 4 || value.length < Math.ceil(minimum / 3) * 4 || value.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new CloudError(400,`Invalid ${label}.`,'INVALID_ENCRYPTED_DATA');
  const bytes = Buffer.from(value,'base64');
  if (bytes.length < minimum || bytes.length > maximum || bytes.toString('base64') !== value) throw new CloudError(400,`Invalid ${label}.`,'INVALID_ENCRYPTED_DATA');
  return value;
}
function box(value, minimum, maximum, label) {
  object(value,['iv','ciphertext'],label);
  return { iv:base64(value.iv,12,12,`${label} nonce`), ciphertext:base64(value.ciphertext,minimum,maximum,`${label} ciphertext`) };
}
function validateVault(value) {
  const accountPassword = value?.version === 2;
  object(value,accountPassword ? ['version','credential','kdf','wrappedKey','recovery'] : ['version','kdf','wrappedKey','recovery'],'document vault');
  object(value.kdf,['name','hash','iterations','salt'],'vault key derivation');
  if ((!accountPassword && value.version !== 1) || (accountPassword && value.credential !== 'account-password') || value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256' || value.kdf.iterations !== 600000) throw new CloudError(400,'Unsupported document vault. Reload the updated WRAITER app.','INVALID_ENCRYPTED_DATA');
  return { version:value.version,...(accountPassword ? {credential:'account-password'} : {}), kdf:{ name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:base64(value.kdf.salt,16,16,'vault salt') }, wrappedKey:box(value.wrappedKey,48,48,'wrapped vault key'), recovery:accountPassword && value.recovery === null ? null : box(value.recovery,48,48,'vault recovery key') };
}
function vaultInput(input) { const vault=validateVault(input?.vault); if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) throw new CloudError(400,'A vault revision is required. Reload your library.','VAULT_CONFLICT'); const json=JSON.stringify(vault); return {vault,json,bytes:Buffer.byteLength(json),baseRevision:input.baseRevision}; }
function validateSealed(value) {
  object(value,['version','metadata','payload'],'encrypted document');
  if (value.version !== 1) throw new CloudError(400,'Unsupported encrypted document. Reload the updated WRAITER app.','INVALID_ENCRYPTED_DATA');
  return { version:1,metadata:box(value.metadata,16,MAX_METADATA_BYTES,'encrypted document metadata'),payload:box(value.payload,16,MAX_PAYLOAD_BYTES,'encrypted document payload') };
}
function encryptedInput(input) {
  if (!input || !Object.hasOwn(input,'sealed') || Object.hasOwn(input,'project') || Object.hasOwn(input,'journal')) throw new CloudError(410,'Cloud documents now require encryption on your device. Reload WRAITER or install the updated desktop app, set up or unlock your document vault, then save again. Your existing document has not been changed.','CLIENT_UPGRADE_REQUIRED');
}
function withoutSecrets(value, depth = 0) {
  if (depth > 24) throw new CloudError(400, 'Settings are too deeply nested.');
  if (Array.isArray(value)) return value.map(item => withoutSecrets(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/api.?key|password|secret|token|credential|^keys$|^__proto__$|^constructor$|^prototype$/i.test(key)).map(([key, item]) => [key, withoutSecrets(item, depth + 1)]));
}
class Store {
  constructor(directory, { quota = QUOTA } = {}) {
    mkdirSync(directory, { recursive: true }); this.filename = path.join(directory, 'wraiter.sqlite'); this.quota = quota;
    this.db = new DatabaseSync(this.filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,settings TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL,kind TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
      CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,project TEXT NOT NULL,journal TEXT NOT NULL,revision INTEGER NOT NULL,bytes INTEGER NOT NULL,updated_at TEXT NOT NULL,sealed TEXT,PRIMARY KEY(user_id,id));
      CREATE TABLE IF NOT EXISTS vaults(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,vault TEXT NOT NULL,revision INTEGER NOT NULL,bytes INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO metadata VALUES('schema','1');`);
    if (!this.db.prepare('PRAGMA table_info(documents)').all().some(column => column.name === 'sealed')) this.db.exec('ALTER TABLE documents ADD COLUMN sealed TEXT');
    this.db.prepare("UPDATE metadata SET value='2' WHERE key='schema'").run();
  }
  transaction(action) { this.db.exec('BEGIN IMMEDIATE'); try { const value = action(); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  user(email) { return this.db.prepare('SELECT * FROM users WHERE email=?').get(email); }
  userById(id) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(id); }
  publicUser(user) { return { id: user.id, email: user.email, verified: Boolean(user.verified), createdAt: user.created_at }; }
  createUser(email, passwordHash) { const user = { id: randomUUID(), email, password_hash: passwordHash, created_at: new Date().toISOString() }; this.db.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(user.id, email, passwordHash, user.created_at); return this.userById(user.id); }
  used(userId) { return this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS used FROM documents WHERE user_id=?').get(userId).used + (this.db.prepare('SELECT bytes FROM vaults WHERE user_id=?').get(userId)?.bytes || 0) + Buffer.byteLength(this.userById(userId)?.settings || '{}'); }
  account(user) { return { user: this.publicUser(user), settings: JSON.parse(user.settings), usedBytes: this.used(user.id), quotaBytes: this.quota }; }
  limited(key, maximum, milliseconds) { const now = Date.now(); return this.transaction(() => { const prior = this.db.prepare('SELECT * FROM limits WHERE key=?').get(key); if (prior && prior.expires > now && prior.count >= maximum) return true; this.db.prepare('INSERT INTO limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires=excluded.expires').run(key, prior?.expires > now ? prior.count + 1 : 1, prior?.expires > now ? prior.expires : now + milliseconds); return false; }); }
  createToken(userId, kind, hash, expires) { this.db.prepare('DELETE FROM tokens WHERE user_id=? AND kind=?').run(userId, kind); this.db.prepare('INSERT INTO tokens VALUES(?,?,?,?)').run(hash, userId, kind, expires); }
  consumeToken(hash, kind, action) { return this.transaction(() => { const token = this.db.prepare('SELECT * FROM tokens WHERE hash=? AND kind=? AND expires>?').get(hash, kind, Date.now()); if (!token) throw new CloudError(400, 'This link has expired or was already used. Request a new one.'); this.db.prepare('DELETE FROM tokens WHERE hash=?').run(hash); return action(token.user_id); }); }
  addSession(hash, userId, expires, kind) { this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash,userId,expires,kind); }
  session(hash) { return this.db.prepare('SELECT u.*,s.kind AS session_kind FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.hash=? AND s.expires>?').get(hash,Date.now()); }
  deleteSession(hash) { this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash); }
  verify(userId) { this.db.prepare('UPDATE users SET verified=1 WHERE id=?').run(userId); return this.userById(userId); }
  password(userId, hash) { this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,userId); this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }
  vault(userId) { const row = this.db.prepare('SELECT vault,revision FROM vaults WHERE user_id=?').get(userId); return { vault:row ? JSON.parse(row.vault) : null,revision:row?.revision || 0,legacyDocuments:this.db.prepare('SELECT COUNT(*) AS count FROM documents WHERE user_id=? AND sealed IS NULL').get(userId).count }; }
  saveVault(userId,input) {
    const prepared=vaultInput(input);
    return this.transaction(() => this.writeVault(userId,prepared));
  }
  writeVault(userId,{json,bytes,baseRevision}) {
      const existing = this.db.prepare('SELECT revision,bytes FROM vaults WHERE user_id=?').get(userId);
      if (baseRevision !== (existing?.revision || 0)) throw new CloudError(409,'Your document vault changed on another device. Reload and unlock its current version before trying again.','VAULT_CONFLICT');
      if (this.used(userId) - (existing?.bytes || 0) + bytes > this.quota) throw new CloudError(413,'Your 1 GB cloud storage is full. Download or remove documents to make space.','QUOTA_EXCEEDED');
      this.db.prepare('INSERT INTO vaults(user_id,vault,revision,bytes,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET vault=excluded.vault,revision=excluded.revision,bytes=excluded.bytes,updated_at=excluded.updated_at').run(userId,json,(existing?.revision || 0)+1,bytes,new Date().toISOString());
      return this.vault(userId);
  }
  changePassword(userId,{sessionHash,expectedPasswordHash,newPasswordHash,vault,baseRevision,newSession}) {
    const prepared=vault === null ? null : vaultInput({vault,baseRevision});
    if (prepared && prepared.vault.version !== 2) throw new CloudError(400,'Rewrap your document vault with the new account password before changing it.','INVALID_ENCRYPTED_DATA');
    if (!prepared && baseRevision !== 0) throw new CloudError(400,'A vault revision is required. Reload your library.','VAULT_CONFLICT');
    return this.transaction(() => {
      const current=this.userById(userId),active=this.session(sessionHash);
      if (!current || !active || active.id !== userId || current.password_hash !== expectedPasswordHash) throw new CloudError(401,'Your account changed. Sign in again before changing its password.','AUTH_REQUIRED');
      const existing=this.db.prepare('SELECT revision FROM vaults WHERE user_id=?').get(userId);
      if (!prepared && existing) throw new CloudError(409,'Unlock and rewrap your existing document vault before changing your account password.','VAULT_CONFLICT');
      const vaultState=prepared ? this.writeVault(userId,prepared) : this.vault(userId);
      this.password(userId,newPasswordHash);
      this.db.prepare('DELETE FROM tokens WHERE user_id=?').run(userId);
      this.addSession(newSession.hash,userId,newSession.expires,newSession.kind);
      return {user:this.userById(userId),vaultState};
    });
  }
  list(userId) {
    // Extract just the small encrypted header inside SQLite. Selecting every
    // sealed payload here would load a near-quota library into Node memory.
    const documents = this.db.prepare('SELECT id,CASE WHEN sealed IS NULL THEN title END AS title,sealed IS NOT NULL AS encrypted,CASE WHEN sealed IS NOT NULL THEN json_extract(sealed,\'$.metadata\') END AS metadata,revision,bytes,updated_at AS updatedAt FROM documents WHERE user_id=? ORDER BY updated_at DESC').all(userId).map(({title,encrypted,metadata,...row}) => encrypted ? { ...row,encrypted:true,metadata:JSON.parse(metadata) } : { ...row,legacy:true,title });
    return { documents,usedBytes:this.used(userId),quotaBytes:this.quota };
  }
  document(userId, id) { const row = this.db.prepare('SELECT * FROM documents WHERE user_id=? AND id=?').get(userId,id); if (!row) throw new CloudError(404, 'Document not found.'); const info = { id:row.id,revision:row.revision,bytes:row.bytes,updatedAt:row.updated_at }; return row.sealed === null ? { ...info,legacy:true,project:JSON.parse(row.project),journal:JSON.parse(row.journal) } : { ...info,sealed:JSON.parse(row.sealed) }; }
  save(userId, id, input, create = false) {
    encryptedInput(input);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new CloudError(400, 'Invalid cloud document identifier.');
    if (input.id != null && input.id !== id) throw new CloudError(400,'Document identifier does not match.');
    const sealedJSON = JSON.stringify(validateSealed(input.sealed)), bytes = Buffer.byteLength(sealedJSON);
    return this.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM vaults WHERE user_id=?').get(userId)) throw new CloudError(409,'Set up your encrypted document vault in the updated WRAITER app before saving cloud documents.','VAULT_REQUIRED');
      const existing = this.db.prepare('SELECT revision,bytes FROM documents WHERE user_id=? AND id=?').get(userId,id);
      if (create && existing) throw new CloudError(409, 'This document already exists. Save as a new copy or reopen the cloud version.', 'REVISION_CONFLICT');
      if (!create && !existing) throw new CloudError(404, 'Document not found.');
      if (existing && input.baseRevision !== existing.revision) throw new CloudError(409, 'This document changed in another tab or device. Your local copy is preserved. Open the latest version or save a separate copy.', 'REVISION_CONFLICT');
      if (this.used(userId) - (existing?.bytes || 0) + bytes > this.quota) throw new CloudError(413, 'Your 1 GB cloud storage is full. Download or remove documents to make space.', 'QUOTA_EXCEEDED');
      const revision = (existing?.revision || 0) + 1, updatedAt = new Date().toISOString();
      this.db.prepare('INSERT INTO documents(id,user_id,title,project,journal,revision,bytes,updated_at,sealed) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET title=excluded.title,project=excluded.project,journal=excluded.journal,revision=excluded.revision,bytes=excluded.bytes,updated_at=excluded.updated_at,sealed=excluded.sealed').run(id,userId,'Encrypted document','{}','[]',revision,bytes,updatedAt,sealedJSON);
      return { id,revision,bytes,updatedAt,usedBytes:this.used(userId),quotaBytes:this.quota };
    });
  }
  remove(userId,id,revision) { return this.transaction(() => { const existing = this.document(userId,id); if (revision !== existing.revision) throw new CloudError(409,'Document changed before deletion. Refresh your library.', 'REVISION_CONFLICT'); this.db.prepare('DELETE FROM documents WHERE user_id=? AND id=?').run(userId,id); return { deleted:true }; }); }
  settings(userId, value) { const clean = withoutSecrets(value); if (!clean || typeof clean !== 'object' || Array.isArray(clean)) throw new CloudError(400,'Invalid settings.'); const json = JSON.stringify(clean); if (Buffer.byteLength(json) > 256 * 1024) throw new CloudError(413,'Settings are too large.'); this.transaction(() => { const old = this.userById(userId); if (this.used(userId) - Buffer.byteLength(old.settings) + Buffer.byteLength(json) > this.quota) throw new CloudError(413,'Your cloud storage is full.', 'QUOTA_EXCEEDED'); this.db.prepare('UPDATE users SET settings=? WHERE id=?').run(json,userId); }); return clean; }
  removeAccount(userId) { this.db.prepare('DELETE FROM users WHERE id=?').run(userId); }
  cleanup() { const now = Date.now(); for (const table of ['sessions','tokens','limits']) this.db.prepare(`DELETE FROM ${table} WHERE expires<?`).run(now); }
  close() { this.db.close(); }
}
module.exports = { Store, CloudError, QUOTA, withoutSecrets, validateVault, validateSealed, encryptedInput, MAX_PAYLOAD_BYTES, MAX_METADATA_BYTES };
