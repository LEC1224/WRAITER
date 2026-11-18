let connection;
function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const opening = indexedDB.open('wraiter-session-keys', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('keys', { keyPath: 'userId' });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(new Error('This browser could not remember the current sign-in.'));
  });
  return connection;
}
async function transaction(mode, run) {
  const db = await database();
  return new Promise((resolve, reject) => { const tx = db.transaction('keys', mode), store = tx.objectStore('keys'); let result; run(store, value => { result = value; }); tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('The browser sign-in cache is unavailable.')); });
}
async function fingerprint(vault) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(vault))); return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''); }
export async function rememberSessionKey(account, state, key) {
  if (!account.user?.id || !account.sessionCacheTag || !state.vault || !key) throw new Error('The server did not provide a valid sign-in session. Sign in again.');
  const record = { userId: account.user.id, sessionCacheTag: account.sessionCacheTag, revision: state.revision, fingerprint: await fingerprint(state.vault), key };
  await transaction('readwrite', (store, done) => { store.put(record); done(true); });
}
export async function recalledSessionKey(account, state) {
  if (!account.user?.id || !account.sessionCacheTag) return null;
  await transaction('readwrite', (store, done) => { const reading = store.getAll(); reading.onsuccess = () => { for (const record of reading.result) if (record.userId !== account.user.id || record.sessionCacheTag !== account.sessionCacheTag) store.delete(record.userId); done(true); }; });
  if (!state.vault) return null;
  const record = await transaction('readonly', (store, done) => { const reading = store.get(account.user.id); reading.onsuccess = () => done(reading.result); });
  if (!record) return null;
  if (record.sessionCacheTag !== account.sessionCacheTag || record.revision !== state.revision || record.fingerprint !== await fingerprint(state.vault) || record.key?.type !== 'secret' || record.key?.algorithm?.name !== 'AES-GCM') { await forgetSessionKey(account.user.id, record.sessionCacheTag); return null; }
  return record.key;
}
export function forgetSessionKey(userId, sessionCacheTag) {
  return transaction('readwrite', (store, done) => { const reading = store.get(userId); reading.onsuccess = () => { if (reading.result && (!sessionCacheTag || reading.result.sessionCacheTag === sessionCacheTag)) store.delete(userId); done(true); }; });
}
export function forgetAllSessionKeys() { return transaction('readwrite', (store, done) => { store.clear(); done(true); }); }
