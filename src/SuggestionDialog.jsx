import React, { useRef, useState } from 'react';

export default function SuggestionDialog({ Modal, submit, signIn, onClose, onSent }) {
  const [description, setDescription] = useState(''), [includeDiagnostics, setInclude] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requestId = useRef(null), submitting = useRef(false);
  async function send(event) {
    event.preventDefault();
    if (submitting.current || !description.trim()) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (needsLogin) { await signIn({ email, password }); setNeedsLogin(false); setPassword(''); }
      requestId.current ??= crypto.randomUUID();
      const result = await submit({ id: requestId.current, description: description.trim(), includeDiagnostics });
      if (result?.signInRequired) setNeedsLogin(true);
      else onSent();
    } catch (err) { setError(err.message); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title="Suggest a feature or fix to the developer" onClose={() => { if (!submitting.current) onClose(); }}>
    <form className="suggestion-form" onSubmit={send}>
      <label>Description<textarea className="field-input" data-initial-focus autoFocus required maxLength={8000} rows={6} disabled={busy} value={description} onChange={e => { requestId.current = null; setDescription(e.target.value); }}/></label>
      <label className="suggestion-consent"><input type="checkbox" checked={includeDiagnostics} disabled={busy} onChange={e => { requestId.current = null; setInclude(e.target.checked); }}/>Include recent logs and crash reports</label>
      {needsLogin && <fieldset><legend>Sign in to submit and receive a reply</legend>
        <label>Email<input className="field-input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label>
        <label>Password<input className="field-input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label>
      </fieldset>}
      {error && <p className="suggestion-error" role="alert">{error}</p>}
      <div className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !description.trim()}>{busy ? 'Submitting…' : 'Submit'}</button></div>
    </form>
  </Modal>;
}
