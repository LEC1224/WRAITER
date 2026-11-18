import { openDocument, openMetadata, sealDocument } from '../cloud-vault.js';
import { request, getRequestSession } from './api.js';
import { listRecovery } from './recovery.js';
const userRequest = (userId, sessionTag, path, options = {}) => request(path, { ...options, expectedUser: userId, expectedSession: sessionTag });

export async function readCloudDocument(userId, key, id, sessionTag = getRequestSession()) {
  const detail = await userRequest(userId, sessionTag, `/api/documents/${encodeURIComponent(id)}`);
  if (!detail.sealed) throw new Error('This document must be encrypted before it can be opened. Use Retry encryption in your library.');
  return { ...detail, ...await openDocument(key, userId, id, detail.sealed) };
}

export async function readCloudLibrary(userId, key, sessionTag = getRequestSession()) {
  const result = await userRequest(userId, sessionTag, '/api/documents');
  const documents = await Promise.all(result.documents.map(async item => {
    if (item.legacy) return { ...item, title: item.title || 'Earlier unencrypted document' };
    try {
      if (!item.encrypted || !item.metadata) throw new Error('Document encryption is incomplete.');
      return { ...item, ...await openMetadata(key, userId, item.id, item.metadata) };
    } catch { return { ...item, title: 'Unable to decrypt document', unreadable: true }; }
  }));
  return { ...result, documents };
}

export async function migrateLibrary(userId, key, onProgress = () => {}, sessionTag = getRequestSession()) {
  await listRecovery(userId, key);
  const result = await userRequest(userId, sessionTag, '/api/documents'), legacy = result.documents.filter(item => !item.encrypted), report = { migrated: 0, failures: [] };
  for (let index = 0; index < legacy.length; index++) {
    onProgress(`Encrypting document ${index + 1} of ${legacy.length}…`);
    const item = legacy[index];
    try {
      const detail = await userRequest(userId, sessionTag, `/api/documents/${encodeURIComponent(item.id)}`);
      if (detail.sealed) continue;
      if (!detail.project || !Array.isArray(detail.journal)) throw new Error('The older document or its history is invalid.');
      const sealed = await sealDocument(key, userId, item.id, { project: detail.project, journal: detail.journal });
      await userRequest(userId, sessionTag, `/api/documents/${encodeURIComponent(item.id)}`, { method: 'PUT', body: { sealed, baseRevision: detail.revision } }); report.migrated++;
    }
    catch (error) {
      if (error.code === 'ACCOUNT_CHANGED') throw error;
      report.failures.push({ id: item.id, message: error.status === 409 ? 'Document changed during encryption. Retry with its current version.' : error.message });
    }
  }
  return report;
}
