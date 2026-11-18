const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { CloudError } = require('./store.cjs');
const derive = promisify(scrypt);
const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const token = () => randomBytes(32).toString('base64url');
function email(value) { const result = String(value || '').trim().toLowerCase(); if (result.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) || /[\r\n]/.test(result)) throw new CloudError(400,'Enter a valid email address.'); return result; }
function validatePassword(value) { if (typeof value !== 'string' || [...value].length < 10 || value.length > 1024 || !/\p{L}/u.test(value) || !/\p{N}/u.test(value)) throw new CloudError(400,'Use at least 10 characters, including a letter and a number. Capitals and special characters are optional.'); return value; }
async function hashPassword(password) { validatePassword(password); const salt = randomBytes(16).toString('hex'), hash = await derive(password,salt,64,SCRYPT); return `scrypt$131072$8$1$${salt}$${hash.toString('hex')}`; }
async function checkPassword(password, encoded) { if (typeof password !== 'string' || password.length > 1024) return false; const parts = String(encoded).split('$'); if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '131072') return false; const hash = await derive(password,parts[4],64,SCRYPT), expected = Buffer.from(parts[5],'hex'); return expected.length === hash.length && timingSafeEqual(hash,expected); }
module.exports = { digest, token, email, validatePassword, hashPassword, checkPassword };
