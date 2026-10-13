import { useState } from 'react';
import { applyCloudSession, useCloudStore, refreshCloudSession, refreshCloudProjects, saveToCloud, loadCloudProject } from '../lib/cloud';
import { authClient } from '../lib/auth-client';
import { Dialog } from './UI';
import './cloud.css';

export function CloudPanel({ onClose }: { onClose: () => void }) {
  const { configured, session, status, error, busy, projects } = useCloudStore();
  const [kind, setKind] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  async function authenticate() {
    if (authBusy) return;
    if (!configured || !email.trim()) { setMessage('Enter your email address.'); return; }
    if (kind === 'signup' && !name.trim()) { setMessage('Enter the name you want to use.'); return; }
    if (password.length < 8 || password.length > 128) { setMessage('Use a password between 8 and 128 characters.'); return; }
    setAuthBusy(true); setMessage('');
    try {
      const response = kind === 'signup'
        ? await authClient.signUp.email({ email: email.trim(), password, name: name.trim() })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (response.error) { setMessage(response.error.message || 'Sign-in failed. Please try again.'); return; }
      setPassword('');
      await refreshCloudSession();
      setMessage(useCloudStore.getState().session ? 'Signed in. Your local drafts stay on this device until you save them to cloud.' : 'Sign-in could not be verified. Please try again.');
    } catch { setMessage('Sign-in is unavailable. Your local draft is safe.'); } finally { setAuthBusy(false); }
  }
  async function signOut() {
    if (authBusy) return;
    setAuthBusy(true); setMessage('');
    // Stop pending automatic saves before making the sign-out request.
    applyCloudSession(null);
    try {
      const response = await authClient.signOut();
      if (response.error) { await refreshCloudSession(); setMessage(response.error.message || 'Sign-out failed. Please try again.'); }
      else setMessage('Signed out. Your local manuscripts are still available on this device.');
    } catch { await refreshCloudSession(); setMessage('Sign-out could not be confirmed. Please try again.'); } finally { setAuthBusy(false); }
  }
  return <Dialog title="Private cloud library" onClose={onClose}><div className="cloud-panel">
    <span className="cloud-eyebrow">YOUR MANUSCRIPT</span>
    <p className="cloud-status" role="status">{status}</p>
    {error && <p className="cloud-error" role="alert">{error}</p>}
    {configured === null ? <p role="status">Checking cloud availability…</p> : !configured ? <div><p>Cloud saving is unavailable. Every edit still saves on this device. Export a JSON backup to carry your manuscript elsewhere.</p></div> : !session ? <form onSubmit={e => { e.preventDefault(); void authenticate(); }}>
      <p>Sign in to keep private manuscripts across devices. Local drafts upload only when you choose Save this project.</p>
      {kind === 'signup' && <label className="cloud-field">Your name<input type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={100} required disabled={authBusy} /></label>}
      <label className="cloud-field">Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={authBusy} /></label>
      <label className="cloud-field">Password<input type="password" autoComplete={kind === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={128} required disabled={authBusy} aria-describedby="cloud-password-help" /></label>
      <p id="cloud-password-help" className="cloud-small">Use 8 to 128 characters.</p>
      <div className="cloud-actions"><button type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : kind === 'signup' ? 'Create account' : 'Sign in'}</button><button type="button" disabled={authBusy} onClick={() => { setKind(kind === 'signup' ? 'signin' : 'signup'); setMessage(''); }}>{kind === 'signup' ? 'Already have an account? Sign in' : 'Create an account'}</button></div>
    </form> : <div>
      <p className="cloud-small">Signed in as {session.user.email}</p>
      <div className="cloud-actions"><button disabled={busy || authBusy} onClick={() => void saveToCloud()}>{busy ? 'Saving…' : 'Save this project'}</button><button disabled={busy || authBusy} onClick={() => void refreshCloudProjects()}>Refresh library</button><button disabled={authBusy} onClick={() => void signOut()}>Sign out</button></div>
      <p className="cloud-small">Cloud writes check the server revision. Loading a different revision keeps a local recovery copy of unsaved work.</p>
      <ul className="cloud-list">{projects.map(row => <li key={row.id}><div><strong>{row.title}</strong><span>Revision {row.cloud_version} · {new Date(row.updated_at).toLocaleString()}</span></div><button disabled={busy || authBusy} onClick={() => { loadCloudProject(row); onClose(); }}>Load</button></li>)}</ul>
      {projects.length === 0 && <p>No cloud manuscripts yet. Save this project to start.</p>}
    </div>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </div></Dialog>;
}
