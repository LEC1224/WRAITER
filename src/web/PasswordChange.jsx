import React, { useState } from 'react';
import { bindVaultToAccount } from '../cloud-vault.js';
import { request } from './api.js';

export default function PasswordChange({ user, sessionTag, documentKey, onChanged }) {
  const [currentPassword, setCurrentPassword] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setDone(false);
    try {
      if (password.length < 10 || !/[\p{L}]/u.test(password) || !/\d/.test(password)) throw new Error('Use at least 10 characters, including a letter and a number.');
      if (password !== confirmation) throw new Error('The passwords do not match.');
      const state = await request('/api/vault', { expectedUser: user.id, expectedSession: sessionTag });
      const vault = await bindVaultToAccount(user.id, state.vault, documentKey, password);
      const result = await request('/api/account/password', { method: 'POST', expectedUser: user.id, expectedSession: sessionTag, body: { currentPassword, newPassword: password, vault, baseRevision: state.revision } });
      await onChanged(result, documentKey); setCurrentPassword(''); setPassword(''); setConfirmation(''); setDone(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <details className="web-locked-account"><summary>Change password</summary><form onSubmit={submit}><p>Your documents remain encrypted with the same document key. Other sessions will be signed out.</p><label>Current password<input name="change-current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/></label><label>New password<input name="change-new-password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={event => setPassword(event.target.value)}/></label><label>Confirm new password<input name="change-confirmation" type="password" autoComplete="new-password" required minLength={10} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>{error && <div className="web-message error" role="alert">{error}</div>}{done && <p role="status">Password changed. Your documents are available.</p>}<button disabled={busy}>Change password</button></form></details>;
}
