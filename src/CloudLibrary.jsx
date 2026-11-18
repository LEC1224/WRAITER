import React, { useEffect, useState } from 'react';
import { Cloud, Download, Upload, RefreshCw } from 'lucide-react';

const api = window.wraiter;
const size = bytes => `${((bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
export default function CloudLibrary({ Modal, onClose, project, onOpen, onUpload }) {
  const [status, setStatus] = useState(null), [library, setLibrary] = useState(null), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [oldSecret, setOldSecret] = useState(''), [accountPassword, setAccountPassword] = useState(''), [useRecoveryKey, setUseRecoveryKey] = useState(false);
  async function refresh() { const next = await api.cloudStatus(); setStatus(next); setLibrary(next.connected && next.vault?.unlocked ? await api.cloudList() : null); }
  useEffect(() => { refresh().catch(error => setError(error.message)); }, []);
  async function perform(action) { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (error) { setError(String(error.message || error)); } finally { setBusy(false); } }
  async function signOut() { if (status?.user?.email) setEmail(status.user.email); await api.cloudLogout(); setPassword(''); setOldSecret(''); setAccountPassword(''); setUseRecoveryKey(false); await refresh(); }
  async function recover(event) {
    event.preventDefault(); await perform(async () => {
      await api.cloudVaultRecover({ oldSecret, ...(accountPassword ? { accountPassword } : {}), recovery: useRecoveryKey });
      setOldSecret(''); setAccountPassword(''); setUseRecoveryKey(false); await refresh();
      setMessage('Existing documents recovered. Future sign-ins unlock encryption automatically.');
    });
  }
  return <Modal title="WRAITER cloud library" subtitle="Documents and titles are encrypted on your device before upload." onClose={busy ? () => {} : onClose} wide>
    {!status ? <p role="status">Checking your cloud account…</p> : !status.connected ? <form className="cloud-login" onSubmit={event => { event.preventDefault(); perform(async () => { await api.cloudLogin({ email, password }); setPassword(''); await refresh(); }); }}>
      <label>Email<input className="field-input" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
      <label>Password<input className="field-input" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
      <p className="small-muted">Register and confirm your email at <button type="button" className="text-button" onClick={() => api.openLink('https://wraiter.lecani.se')}>wraiter.lecani.se</button>. Encryption unlocks automatically when you sign in. This device protects your sign-in and document key with Windows secure storage.</p>
      <button className="primary-button" disabled={busy}>Sign in</button>
    </form> : <>
      <div className="cloud-account-row"><div><Cloud size={18} /><strong>{status.user?.email}</strong><small>{size(library?.usedBytes ?? status.usedBytes)} of 1 GB used</small></div><button className="secondary-button" disabled={busy} onClick={() => perform(refresh)}><RefreshCw size={14} />Refresh</button><button className="secondary-button" disabled={busy} onClick={() => perform(signOut)}>Sign out</button></div>
      {!status.vault?.unlocked ? <div className="cloud-login">
        {!status.vault?.exists ? <><h3>Finish updating this device</h3><p>Document encryption is set up automatically when you sign in.</p><button className="primary-button" disabled={busy} onClick={() => perform(signOut)}>Return to sign-in</button></> : <>
          <h3>{status.vault.needsLegacyMigration ? 'Update earlier document encryption' : 'Recover existing encrypted documents'}</h3>
          <p className="small-muted">{status.vault.needsLegacyMigration ? 'An earlier beta used a separate document passphrase. Enter it once to switch this account to automatic encryption. Your existing documents will be preserved.' : 'Sign in again to unlock this device. If you reset a forgotten account password, use the previous password to recover the existing encryption key. Existing documents will be preserved.'}</p>
          <form onSubmit={recover}>
            <label>{useRecoveryKey ? 'Existing recovery key' : status.vault.needsLegacyMigration ? 'Earlier document passphrase' : 'Previous account password'}<input className="field-input" type="password" autoComplete="off" required value={oldSecret} onChange={event => setOldSecret(event.target.value)}/></label>
            {status.vault.needsAccountPassword && <label>Current account password<input className="field-input" type="password" autoComplete="current-password" required value={accountPassword} onChange={event => setAccountPassword(event.target.value)}/></label>}
            <div className="cloud-upload-actions"><button className="primary-button" disabled={busy}>{status.vault.needsLegacyMigration ? 'Continue with automatic encryption' : 'Recover documents'}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => perform(signOut)}>Return to sign-in</button></div>
            {status.vault.canUseRecoveryKey && <button className="text-button" type="button" disabled={busy} onClick={() => { setUseRecoveryKey(!useRecoveryKey); setOldSecret(''); }}>{useRecoveryKey ? 'Use the earlier password instead' : 'Use an earlier recovery key instead'}</button>}
          </form>
        </>}
      </div> : <>
        {status.vault.migration?.failures?.length > 0 && <div className="connection-status error" role="alert"><p>Some earlier documents could not be encrypted. Their existing cloud copies were preserved. Download important drafts and retry before treating those copies as private.</p><button className="secondary-button" disabled={busy} onClick={() => perform(async () => { await api.cloudVaultMigrate(); await refresh(); })}>Retry encrypting earlier documents</button></div>}
        <div className="cloud-upload-actions"><button className="primary-button" disabled={busy || !project} onClick={() => perform(async () => { await onUpload(false); await refresh(); setMessage('Encrypted cloud copy saved. Local file saving remains separate.'); })}><Upload size={15} />Upload / update current manuscript</button><button className="secondary-button" disabled={busy || !project} onClick={() => perform(async () => { await onUpload(true); await refresh(); setMessage('Saved as a separate encrypted cloud document.'); })}>Upload as new copy</button></div>
        <p className="small-muted">Uploads are explicit. Open creates a separate local draft. Each desktop upload starts fresh cloud undo history; your complete desktop undo history and embedded checkpoints stay preserved. Use Upload / update to send changes.</p>
        <div className="cloud-document-list">{library?.documents?.length ? library.documents.map(document => <div className="cloud-document-row" key={document.id}><div><strong>{document.title || 'Untitled manuscript'}</strong><small>{new Date(document.updatedAt).toLocaleString()} · {size(document.bytes)}{document.legacy ? ' · Earlier unencrypted copy' : ''}</small></div><button className="secondary-button" disabled={busy || document.unreadable} onClick={() => perform(async () => { await onOpen(document.id); onClose(); })}><Download size={15} />Open local copy</button></div>) : <p>Your cloud library is empty.</p>}</div>
      </>}
    </>}
    {message && <p className="connection-status" role="status">{message}</p>}{error && <p className="connection-status error" role="alert">{error}</p>}
  </Modal>;
}
