import React, { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { unlockVault, unlockAccountVault, bindVaultToAccount } from '../cloud-vault.js';
import { request } from './api.js';
import appIcon from '../../assets/icon.svg';

function LockedAccountControls({ disabled, userId, sessionTag }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function remove(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await request('/api/account', { method: 'DELETE', expectedUser: userId, expectedSession: sessionTag, body: { password } }); location.assign('/'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <details className="web-locked-account"><summary>Account controls</summary><form onSubmit={remove}><p>Delete your account and its cloud documents even if you cannot unlock them. Downloaded files and browser recovery copies are separate.</p><label>Current account password<input type="password" autoComplete="current-password" required disabled={disabled || busy} value={password} onChange={event => setPassword(event.target.value)}/></label>{error && <div className="web-message error" role="alert">{error}</div>}<button className="secondary-button" disabled={disabled || busy}>Delete my account and data</button></form></details>;
}

export default function VaultGate({ user, vaultState, sessionTag, kind, accountPassword, onRecovered, onSignOut }) {
  const [secret, setSecret] = useState(''), [password, setPassword] = useState(''), [recovery, setRecovery] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const legacy = vaultState.vault?.version === 1;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const currentPassword = accountPassword || password;
      let account;
      if (!accountPassword) account = await request('/api/auth/login', { method: 'POST', expectedUser: user.id, body: { email: user.email, password: currentPassword } });
      const key = recovery || legacy ? await unlockVault(user.id, vaultState.vault, secret, { recovery }) : await unlockAccountVault(user.id, vaultState.vault, secret);
      const vault = await bindVaultToAccount(user.id, vaultState.vault, key, currentPassword);
      const state = await request('/api/vault', { method: 'PUT', expectedUser: user.id, expectedSession: account?.sessionCacheTag || sessionTag, body: { vault, baseRevision: vaultState.revision } });
      setSecret(''); setPassword(''); await onRecovered(key, state, account);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="web-vault-screen"><section className="web-vault-card"><div className="web-brand compact"><img className="web-brand-mark" src={appIcon} alt=""/><span>WRAITER<small>Document access</small></span></div><p className="web-vault-account">{user.email}</p><form onSubmit={submit}><h1>{legacy ? 'Update document access' : 'Recover document access'}</h1><p>{legacy ? 'This account used a separate document passphrase in an earlier release. Enter it once to connect the same encrypted documents to your account password. Future sign-ins will open your library automatically.' : 'Your account password was changed or reset, but the existing documents are still protected by the previous password. Enter that previous password to preserve access and connect the documents to your current password.'}</p><p className="web-vault-warning">Existing documents have been preserved. If you cannot provide the previous password{legacy ? ', the old document passphrase' : ''}{vaultState.vault?.recovery ? ' or an existing recovery key' : ''}, they cannot be decrypted. No documents will be replaced.</p>{!accountPassword && <label>Current account password<input name="recovery-current-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>}<label>{recovery ? 'Existing recovery key' : legacy ? 'Previous document passphrase' : 'Previous account password'}<input name="document-recovery-secret" type="password" autoComplete="off" required value={secret} onChange={event => setSecret(event.target.value)}/></label>{error && <div className="web-message error" role="alert">{error}</div>}<button className="web-submit" disabled={busy}>{busy && <LoaderCircle className="spin" size={16}/>} {legacy ? 'Update and open documents' : 'Recover and open documents'}</button>{vaultState.vault?.recovery && <button className="web-text-button" type="button" disabled={busy} onClick={() => { setRecovery(!recovery); setSecret(''); setError(''); }}>{recovery ? 'Use previous password' : 'Use existing recovery key'}</button>}</form><button className="web-text-button" type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onSignOut(); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>Sign out</button><LockedAccountControls disabled={busy} userId={user.id} sessionTag={sessionTag}/><a className="web-privacy-link" href="/privacy.html" target="_blank" rel="noreferrer">Privacy & data</a></section></main>;
}
