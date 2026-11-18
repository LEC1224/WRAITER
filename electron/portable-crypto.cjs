// Shared document fingerprints run on the user's device in both applications.
// Vault encryption uses WebCrypto separately; no secret key is used here.
const { sha256 } = require('@noble/hashes/sha2.js');
const encoder = new TextEncoder();
const hash = value => Array.from(sha256(typeof value === 'string' ? encoder.encode(value) : value), byte => byte.toString(16).padStart(2, '0')).join('');
const randomUUID = () => globalThis.crypto.randomUUID();
module.exports = { hash, randomUUID };
