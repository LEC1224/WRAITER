import { openDocument, sealDocument } from '../cloud-vault.js';

let connection;
function database() {
  if (!connection) connection = new Promise((resolve, reject) => { const opening = indexedDB.open('wraiter-cloud-recovery', 1); opening.onupgradeneeded = () => opening.result.createObjectStore('documents', { keyPath: 'key' }); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(new Error('Browser recovery storage is unavailable. Check your browser storage settings before editing.')); });
  return connection;
}
async function transaction(mode, run) {
  const db = await database();
  return new Promise((resolve, reject) => { const tx = db.transaction('documents', mode), store = tx.objectStore('documents'); let value; run(store, result => { value = result; }); tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Your browser could not preserve the recovery copy.')); });
}
function requireKey(key) { if (!key) throw new Error('Unlock your documents before accessing browser recovery.'); }
export async function saveRecovery(userId, record, key) {
  requireKey(key);
  const projectId = record.project.id, sealed = await sealDocument(key, userId, projectId, { project: record.project, journal: record.journal || [] });
  const stored = { key: `${userId}:${projectId}`, userId, projectId, sealed, revision: record.revision, cloudId: record.cloudId, pending: Boolean(record.pending), savedAt: new Date().toISOString() };
  return transaction('readwrite', (store, done) => { store.put(stored); done(true); });
}
async function openRecovery(userId, record, key) {
  if (!record) return undefined;
  if (record.sealed) return { ...record, ...await openDocument(key, userId, record.projectId, record.sealed) };
  if (!record.project?.id) throw new Error('A browser recovery record could not be opened. Its stored copy has been preserved.');
  await saveRecovery(userId, record, key);
  return record;
}
export async function readRecovery(userId, projectId, key) {
  requireKey(key);
  const record = await transaction('readonly', (store, done) => { const req = store.get(`${userId}:${projectId}`); req.onsuccess = () => done(req.result); });
  try { return await openRecovery(userId, record, key); }
  catch { throw new Error('This browser recovery copy cannot be decrypted. Download or discard it from Library before opening this document. Its stored record has been preserved.'); }
}
export async function listRecovery(userId, key) {
  requireKey(key);
  const records = await transaction('readonly', (store, done) => { const req = store.getAll(); req.onsuccess = () => done(req.result.filter(record => record.userId === userId)); });
  const opened = [];
  for (const record of records) {
    try { const value = await openRecovery(userId, record, key); if (value.pending) opened.push(value); }
    catch { opened.push({ ...record, raw: record, unreadable: true, project: { id: record.projectId || record.key.slice(userId.length + 1), title: 'Unable to decrypt browser recovery' } }); }
  }
  return opened;
}
export function deleteRecovery(userId, projectId) { return transaction('readwrite', (store, done) => { store.delete(`${userId}:${projectId}`); done(true); }); }
