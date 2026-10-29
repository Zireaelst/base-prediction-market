'use client';

import { useState, type FormEvent } from 'react';
import { api, invalidate } from './api';
import { Field, FormFeedback } from './ui';

export function RoomInvite({ path, onInvite }: { path: string; onInvite: () => void }) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    try {
      await api(`${path}/invite`, { method: 'POST', body: JSON.stringify({ handle: handle.trim() }) });
      invalidate(path, '/api/rooms'); onInvite();
      setSuccess(`@${handle.trim()} can now access this room.`); setHandle('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not invite this account.'); }
    finally { setBusy(false); }
  }
  return <section className="invite-panel"><div><p className="eyebrow">OWNER / INVITATIONS</p><h2>Bring someone in.</h2><p className="small muted">Invite an existing account by handle. Private rooms are visible to members only; guests cannot join without an invitation.</p></div><form className="invite-form" onSubmit={invite}><Field label="Account handle" name="handle" value={handle} onChange={setHandle} required placeholder="their-handle"/><button className="button button-small" type="submit" disabled={busy}>{busy ? 'Inviting…' : 'Invite member ↗'}</button><FormFeedback message={error}/>{success && <p role="status" className="success-note">{success}</p>}</form></section>;
}
