import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createVault, unlockVault, rewrapVault, createAccountVault, unlockAccountVault, bindVaultToAccount, sealDocument, openDocument, openMetadata } from '../src/cloud-vault.js';

const userId = 'vault-test-user';
const passphrase = 'a distinct document passphrase 123';
const document = { project: { id: 'document1', title: 'Private title', chapters: [{ content: 'Private manuscript words.' }], notes: 'Private note', references: [{ text: 'Private reference' }], chats: [{ content: 'Private chat' }], snapshots: [{ content: 'Private checkpoint' }] }, journal: [{ sequence: 1, change: 'Private history' }] };
const change = box => ({ ...box, ciphertext: (box.ciphertext[0] === 'A' ? 'B' : 'A') + box.ciphertext.slice(1) });

test('vault wraps a random key separately for passphrase and recovery without serializing secrets', async () => {
  const created = await createVault(userId, passphrase);
  assert.equal(created.key.type, 'secret'); assert.equal(created.key.algorithm.name, 'AES-GCM'); assert.equal(created.key.algorithm.length, 256);
  assert.equal(JSON.stringify(created.key), '{}');
  assert.match(created.recoveryKey, /^WRAITER-RECOVERY-1-[A-Za-z0-9_-]{43}$/);
  assert.equal(created.vault.kdf.iterations, 600000);
  assert.equal(Buffer.from(created.vault.kdf.salt, 'base64').length, 16);
  assert.equal(Buffer.from(created.vault.wrappedKey.iv, 'base64').length, 12);
  assert.equal(Buffer.from(created.vault.wrappedKey.ciphertext, 'base64').length, 48);
  const serialized = JSON.stringify(created.vault); assert.ok(!serialized.includes(passphrase)); assert.ok(!serialized.includes(created.recoveryKey));
  const byPass = await unlockVault(userId, JSON.parse(serialized), passphrase), byRecovery = await unlockVault(userId, created.vault, created.recoveryKey, { recovery: true });
  const sealed = await sealDocument(created.key, userId, 'document1', document);
  assert.deepEqual(await openDocument(byPass, userId, 'document1', sealed), document);
  assert.deepEqual(await openDocument(byRecovery, userId, 'document1', sealed), document);
  const ciphertext = JSON.stringify(sealed); for (const text of ['Private title', 'Private manuscript words.', 'Private reference', 'Private history']) assert.ok(!ciphertext.includes(text));
});

test('wrong passphrase, recovery key, account identity, document identity and tampering fail closed', async () => {
  const created = await createVault(userId, passphrase), sealed = await sealDocument(created.key, userId, 'document1', document);
  await assert.rejects(unlockVault(userId, created.vault, 'a wrong passphrase 123'), /did not unlock/);
  await assert.rejects(unlockVault('other-user', created.vault, passphrase), /did not unlock/);
  await assert.rejects(unlockVault(userId, created.vault, 'WRAITER-RECOVERY-1-' + 'A'.repeat(43), { recovery: true }), /did not unlock/);
  await assert.rejects(unlockVault(userId, { ...created.vault, wrappedKey: change(created.vault.wrappedKey) }, passphrase), /did not unlock/);
  await assert.rejects(openDocument(created.key, 'other-user', 'document1', sealed), /could not be decrypted/);
  await assert.rejects(openDocument(created.key, userId, 'another-document', sealed), /could not be decrypted/);
  await assert.rejects(openDocument(created.key, userId, 'document1', { ...sealed, payload: change(sealed.payload) }), /could not be decrypted/);
  await assert.rejects(openDocument(created.key, userId, 'document1', { ...sealed, metadata: change(sealed.metadata) }), /could not be decrypted/);
  await assert.rejects(openMetadata(created.key, userId, 'document1', sealed.payload), /could not be decrypted/);
});

test('passphrase rewrap preserves documents and recovery while invalidating the old passphrase', async () => {
  const created = await createVault(userId, passphrase), sealed = await sealDocument(created.key, userId, 'document1', document);
  const next = await rewrapVault(userId, created.vault, created.key, 'new independent document passphrase 456');
  assert.deepEqual(next.recovery, created.vault.recovery); assert.notEqual(next.kdf.salt, created.vault.kdf.salt);
  await assert.rejects(unlockVault(userId, next, passphrase), /did not unlock/);
  assert.deepEqual(await openDocument(await unlockVault(userId, next, 'new independent document passphrase 456'), userId, 'document1', sealed), document);
  assert.deepEqual(await openDocument(await unlockVault(userId, next, created.recoveryKey, { recovery: true }), userId, 'document1', sealed), document);
});

test('fresh IVs are used for every payload and metadata encryption and unsupported KDFs are rejected', async () => {
  await assert.rejects(createVault(userId, 'too short'), /12 characters/);
  const created = await createVault(userId, passphrase), first = await sealDocument(created.key, userId, 'document1', document), second = await sealDocument(created.key, userId, 'document1', document);
  assert.equal(new Set([first.metadata.iv, first.payload.iv, second.metadata.iv, second.payload.iv]).size, 4);
  await assert.rejects(unlockVault(userId, { ...created.vault, kdf: { ...created.vault.kdf, iterations: 1 } }, passphrase), /not supported/);
});

test('account password wraps a random document key and opens the same documents on another device', async () => {
  const password = 'lowercase1', created = await createAccountVault(userId, password);
  assert.equal(created.vault.version, 2); assert.equal(created.vault.credential, 'account-password'); assert.equal(created.vault.recovery, null);
  const sealed = await sealDocument(created.key, userId, 'document1', document);
  const descriptor = JSON.parse(JSON.stringify(created.vault));
  const otherDevice = await unlockAccountVault(userId, descriptor, password);
  assert.deepEqual(await openDocument(otherDevice, userId, 'document1', sealed), document);
  assert.equal(JSON.stringify(descriptor).includes(password), false);
  await assert.rejects(unlockAccountVault(userId, descriptor, 'different1'), /did not unlock/);
  await assert.rejects(unlockAccountVault('other-user', descriptor, password), /did not unlock/);
  await assert.rejects(createAccountVault(userId, 'short1'), /10 characters/);
  // A server authentication verifier is not a document-decryption credential.
  const { hashPassword } = await import('../cloud/auth.cjs');
  await assert.rejects(unlockAccountVault(userId, descriptor, await hashPassword(password)), /did not unlock/);
  await assert.rejects(unlockVault(userId, { ...descriptor, version: 1, recovery: descriptor.wrappedKey }, password), /did not unlock/);
});

test('binding a legacy vault to the account password preserves the key, all ciphertext and saved recovery access', async () => {
  const old = await createVault(userId, passphrase), sealed = await sealDocument(old.key, userId, 'document1', document), original = JSON.stringify(sealed);
  const migrated = await bindVaultToAccount(userId, old.vault, await unlockVault(userId, old.vault, passphrase), 'account1234');
  assert.deepEqual(migrated.recovery, old.vault.recovery); assert.notEqual(migrated.kdf.salt, old.vault.kdf.salt);
  assert.deepEqual(await openDocument(await unlockAccountVault(userId, migrated, 'account1234'), userId, 'document1', sealed), document);
  assert.deepEqual(await openDocument(await unlockVault(userId, migrated, old.recoveryKey, { recovery: true }), userId, 'document1', sealed), document);
  assert.equal(JSON.stringify(sealed), original);
  await assert.rejects(unlockAccountVault(userId, migrated, passphrase), /did not unlock/);
});

test('account password changes rewrap the same key without changing document/history or allowing the old password', async () => {
  const created = await createAccountVault(userId, 'oldaccount1'), sealed = await sealDocument(created.key, userId, 'document1', document);
  const next = await bindVaultToAccount(userId, created.vault, created.key, 'newaccount2');
  assert.equal(next.recovery, null); assert.notEqual(next.wrappedKey.iv, created.vault.wrappedKey.iv);
  await assert.rejects(unlockAccountVault(userId, next, 'oldaccount1'), /did not unlock/);
  assert.deepEqual(await openDocument(await unlockAccountVault(userId, next, 'newaccount2'), userId, 'document1', sealed), document);
  assert.deepEqual(await openDocument(await unlockAccountVault(userId, created.vault, 'oldaccount1'), userId, 'document1', sealed), document, 'resetting authentication alone never changes the stored encryption key');
  await assert.rejects(unlockAccountVault(userId, { ...next, credential: 'unknown' }, 'newaccount2'), /not supported/);
});

test('browser WebCrypto and desktop Node WebCrypto read each other’s encrypted documents', async t => {
  const { chromium } = await import('playwright'), moduleSource = await readFile(new URL('../src/cloud-vault.js', import.meta.url));
  const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(moduleSource); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ channel: 'msedge', headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const created = await createVault(userId, passphrase), sealed = await sealDocument(created.key, userId, 'document1', document);
  const fromBrowser = await page.evaluate(async input => {
    const crypto = await import('/cloud-vault.js'), key = await crypto.unlockVault(input.userId, input.vault, input.passphrase);
    const original = await crypto.openDocument(key, input.userId, 'document1', input.sealed);
    original.project.title = 'Browser encrypted title';
    return { sealed: await crypto.sealDocument(key, input.userId, 'document1', original), serializedKey: JSON.stringify(key) };
  }, { userId, vault: created.vault, passphrase, sealed });
  assert.equal(fromBrowser.serializedKey, '{}');
  assert.equal((await openDocument(created.key, userId, 'document1', fromBrowser.sealed)).project.title, 'Browser encrypted title');
  const account = await createAccountVault(userId, 'tenletters1'), encrypted = await sealDocument(account.key, userId, 'document1', document);
  const accountBrowser = await page.evaluate(async input => {
    const crypto = await import('/cloud-vault.js'), key = await crypto.unlockAccountVault(input.userId, input.vault, input.password);
    const value = await crypto.openDocument(key, input.userId, 'document1', input.sealed);
    const fresh = await crypto.createAccountVault(input.userId, input.password);
    return { value, vault: fresh.vault, sealed: await crypto.sealDocument(fresh.key, input.userId, 'document1', value) };
  }, { userId, vault: account.vault, password: 'tenletters1', sealed: encrypted });
  assert.deepEqual(accountBrowser.value, document);
  assert.deepEqual(await openDocument(await unlockAccountVault(userId, accountBrowser.vault, 'tenletters1'), userId, 'document1', accountBrowser.sealed), document);
});
