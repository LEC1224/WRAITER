// Shared by the browser and Electron's main process. Only encrypted envelopes
// leave the client. Current vaults use the account password; version 1 retains
// support for the earlier separate-passphrase vault during one-time migration.
const VERSION = 1;
const ITERATIONS = 600000;
const RECOVERY_PREFIX = 'WRAITER-RECOVERY-1-';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const fail = message => { throw new Error(message); };

function webCrypto() {
  if (!globalThis.crypto?.subtle) fail('Document encryption requires a secure HTTPS connection or the WRAITER desktop app.');
  return globalThis.crypto;
}
function identifier(value) {
  if (typeof value !== 'string' || !value.length || value.length > 200) fail('Invalid encrypted document identity.');
  return value;
}
function passphrase(value) {
  if (typeof value !== 'string' || [...value].length < 12 || value.length > 4096) fail('Use a document passphrase of at least 12 characters. Choose a different passphrase from your account password.');
  return value;
}
function accountPassword(value) {
  if (typeof value !== 'string' || [...value].length < 10 || value.length > 1024) fail('Use your account password of at least 10 characters.');
  return value;
}
function base64(bytes) {
  let text = '';
  for (let start = 0; start < bytes.length; start += 32768) text += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(text);
}
function unbase64(value, length) {
  if (typeof value !== 'string' || !value.length || value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('Invalid encrypted document encoding.');
  const binary = atob(value), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if ((length !== undefined && bytes.length !== length) || base64(bytes) !== value) fail('Invalid encrypted document encoding.');
  return bytes;
}
function aad(userId, id, purpose) {
  return encoder.encode(JSON.stringify(['WRAITER-CLOUD', VERSION, purpose, identifier(userId), id === '' ? '' : identifier(id)]));
}
function validateBox(value, length) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid encrypted document envelope.');
  const iv = unbase64(value.iv, 12), ciphertext = unbase64(value.ciphertext, length);
  if (ciphertext.length < 16) fail('Invalid encrypted document envelope.');
  return { iv, ciphertext };
}
function validateVault(vault) {
  if (!vault || ![1, 2].includes(vault.version) || (vault.version === 2 && vault.credential !== 'account-password') || vault.kdf?.name !== 'PBKDF2' || vault.kdf.hash !== 'SHA-256' || vault.kdf.iterations !== ITERATIONS) fail('This document vault format is not supported.');
  unbase64(vault.kdf.salt, 16); validateBox(vault.wrappedKey, 48);
  if (vault.version === 1 || vault.recovery != null) validateBox(vault.recovery, 48);
}
async function importAES(raw) {
  return webCrypto().subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function derive(pass, salt, account = false) {
  const material = encoder.encode(account ? accountPassword(pass) : passphrase(pass));
  try {
    const key = await webCrypto().subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
    return webCrypto().subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { material.fill(0); }
}
async function encrypt(key, userId, id, purpose, bytes) {
  const iv = webCrypto().getRandomValues(new Uint8Array(12));
  const ciphertext = await webCrypto().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, id, purpose), tagLength: 128 }, key, bytes);
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) };
}
async function decrypt(key, userId, id, purpose, box, length) {
  const { iv, ciphertext } = validateBox(box, length);
  return new Uint8Array(await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, id, purpose), tagLength: 128 }, key, ciphertext));
}
function recoveryBytes(secret) {
  if (typeof secret !== 'string') fail('Enter your full WRAITER recovery key.');
  const text = secret.trim();
  if (!text.startsWith(RECOVERY_PREFIX) || !/^[A-Za-z0-9_-]{43}$/.test(text.slice(RECOVERY_PREFIX.length))) fail('Enter your full WRAITER recovery key.');
  return unbase64(text.slice(RECOVERY_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/') + '=', 32);
}
function parseDocument(bytes) {
  const value = JSON.parse(decoder.decode(bytes));
  if (!value?.project || typeof value.project !== 'object' || Array.isArray(value.project) || !Array.isArray(value.journal)) fail('The decrypted document is invalid.');
  return value;
}

export async function createVault(userId, secret) {
  identifier(userId); passphrase(secret);
  const raw = webCrypto().getRandomValues(new Uint8Array(32)), recovery = webCrypto().getRandomValues(new Uint8Array(32)), salt = webCrypto().getRandomValues(new Uint8Array(16));
  try {
    const key = await importAES(raw), wrapping = await derive(secret, salt), recoveryWrapping = await importAES(recovery);
    const vault = {
      version: VERSION,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: base64(salt) },
      wrappedKey: await encrypt(wrapping, userId, '', 'vault-passphrase', raw),
      recovery: await encrypt(recoveryWrapping, userId, '', 'vault-recovery', raw)
    };
    return { vault, key, recoveryKey: RECOVERY_PREFIX + base64(recovery).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
  } finally { raw.fill(0); recovery.fill(0); }
}

export async function unlockVault(userId, vault, secret, { recovery = false } = {}) {
  if (vault?.version === 2 && !recovery) return unlockAccountVault(userId, vault, secret);
  identifier(userId); validateVault(vault);
  let recoveryRaw, raw;
  try {
    const wrapping = recovery ? await importAES(recoveryRaw = recoveryBytes(secret)) : await derive(secret, unbase64(vault.kdf.salt, 16));
    raw = await decrypt(wrapping, userId, '', recovery ? 'vault-recovery' : 'vault-passphrase', recovery ? vault.recovery : vault.wrappedKey, 48);
    if (raw.length !== 32) fail('Invalid document vault key.');
    return await importAES(raw);
  } catch { fail(recovery ? 'The recovery key did not unlock this account’s document vault.' : 'The document passphrase did not unlock this account’s vault.'); }
  finally { raw?.fill(0); recoveryRaw?.fill(0); }
}

export async function rewrapVault(userId, vault, key, newPassphrase) {
  if (vault?.version === 2) return bindVaultToAccount(userId, vault, key, newPassphrase);
  identifier(userId); validateVault(vault); passphrase(newPassphrase);
  const raw = new Uint8Array(await webCrypto().subtle.exportKey('raw', key));
  try {
    if (raw.length !== 32 || key.algorithm.name !== 'AES-GCM') fail('Invalid document vault key.');
    const salt = webCrypto().getRandomValues(new Uint8Array(16)), wrapping = await derive(newPassphrase, salt);
    return { version: VERSION, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: base64(salt) }, wrappedKey: await encrypt(wrapping, userId, '', 'vault-passphrase', raw), recovery: { ...vault.recovery } };
  } finally { raw.fill(0); }
}

// The password protects a random document key rather than encrypting each
// document directly. Changing the password rewraps that same key and never
// replaces documents, histories or their authenticated identities.
export async function createAccountVault(userId, password) {
  identifier(userId); accountPassword(password);
  const raw = webCrypto().getRandomValues(new Uint8Array(32));
  try {
    const key = await importAES(raw);
    return { key, vault: await accountWrappedVault(userId, key, password, null) };
  } finally { raw.fill(0); }
}

async function accountWrappedVault(userId, key, password, recovery) {
  accountPassword(password);
  const raw = new Uint8Array(await webCrypto().subtle.exportKey('raw', key));
  try {
    if (raw.length !== 32 || key.algorithm.name !== 'AES-GCM') fail('Invalid document vault key.');
    const salt = webCrypto().getRandomValues(new Uint8Array(16)), wrapping = await derive(password, salt, true);
    return { version: 2, credential: 'account-password', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: base64(salt) }, wrappedKey: await encrypt(wrapping, userId, '', 'account-password', raw), recovery: recovery ? { ...recovery } : null };
  } finally { raw.fill(0); }
}

export async function unlockAccountVault(userId, vault, password) {
  identifier(userId); validateVault(vault);
  if (vault.version !== 2 || vault.credential !== 'account-password') fail('This account needs a one-time document password migration.');
  let raw;
  try {
    const wrapping = await derive(password, unbase64(vault.kdf.salt, 16), true);
    raw = await decrypt(wrapping, userId, '', 'account-password', vault.wrappedKey, 48);
    if (raw.length !== 32) fail('Invalid document vault key.');
    return await importAES(raw);
  } catch { fail('Your account password did not unlock these documents. If you reset it, recover access with your previous password or saved recovery key.'); }
  finally { raw?.fill(0); }
}

export async function bindVaultToAccount(userId, vault, key, password) {
  identifier(userId); validateVault(vault);
  return accountWrappedVault(userId, key, password, vault.recovery);
}

export async function sealDocument(key, userId, id, { project, journal = [] }) {
  identifier(userId); identifier(id);
  if (!project || typeof project !== 'object' || Array.isArray(project) || !Array.isArray(journal)) fail('A document and its editing history are required.');
  const metadata = encoder.encode(JSON.stringify({ title: typeof project.title === 'string' ? project.title : 'Untitled manuscript' }));
  const payload = encoder.encode(JSON.stringify({ project, journal }));
  try {
    return { version: VERSION, metadata: await encrypt(key, userId, id, 'document-metadata', metadata), payload: await encrypt(key, userId, id, 'document-payload', payload) };
  } finally { metadata.fill(0); payload.fill(0); }
}

export async function openDocument(key, userId, id, sealed) {
  if (sealed?.version !== VERSION) fail('This encrypted document format is not supported.');
  let raw;
  try {
    const metadata = await openMetadata(key, userId, id, sealed.metadata);
    raw = await decrypt(key, userId, id, 'document-payload', sealed.payload);
    const document = parseDocument(raw);
    if (metadata.title !== (typeof document.project.title === 'string' ? document.project.title : 'Untitled manuscript')) fail('The encrypted document title changed.');
    return document;
  }
  catch { fail('This document could not be decrypted. It may belong to another account, or its encrypted data changed.'); }
  finally { raw?.fill(0); }
}

export async function openMetadata(key, userId, id, metadata) {
  let raw;
  try {
    raw = await decrypt(key, userId, id, 'document-metadata', metadata);
    const value = JSON.parse(decoder.decode(raw));
    if (typeof value?.title !== 'string') fail('Invalid document title.');
    return { title: value.title };
  } catch { fail('This encrypted document title could not be decrypted.'); }
  finally { raw?.fill(0); }
}

// Grammar exceptions can contain exact phrases from a private manuscript.
export async function sealGrammarDictionary(key, userId, json) {
  const bytes = encoder.encode(json);
  try { return await encrypt(key, userId, '', 'personal-grammar-dictionary', bytes); }
  finally { bytes.fill(0); }
}
export async function openGrammarDictionary(key, userId, box) {
  const bytes = await decrypt(key, userId, '', 'personal-grammar-dictionary', box);
  try { return decoder.decode(bytes); } finally { bytes.fill(0); }
}
