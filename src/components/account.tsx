'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Forecast, Notice, PaperOrder, User } from '@/lib/contracts';
import { api, clearSnapshots, invalidate, useResource, useSession } from './api';
import { formatCents, formatDate, formatProbability } from './display';
import { AuthGate, Field, FormFeedback, InlineStatus, SectionHead } from './ui';
import { WalletSignIn } from './wallet-sign-in';

function ForecastRows({ forecasts }: { forecasts: Forecast[] }) {
  return <div className="list-stack">{forecasts.map(forecast => <article className="list-item" key={forecast.id}><div>
    <Link className="item-title" href={`/markets/${encodeURIComponent(forecast.marketSlug)}`}>{forecast.marketQuestion || forecast.marketSlug} ↗</Link>
    <p className="small muted">Pick: {forecast.selectedOutcomeLabel ?? `venue outcome ${forecast.outcomeId}`} · {forecast.destinationKind === 'personal' ? <Link href={`/rooms/${forecast.roomId}`}>Private · My forecasts ↗</Link> : <Link href={`/rooms/${forecast.roomId}`}>Room #{forecast.roomId} ↗</Link>} · {formatDate(forecast.revisedAt)}</p>
    <p>{forecast.rationale}</p>
    {forecast.termsAtEntry && <details className="revision-history"><summary>Terms at forecast time</summary><p>{forecast.termsAtEntry}</p><p className="small muted">Resolution source: {forecast.resolutionSourceAtEntry || 'Not stated by venue'} · Deadline: {forecast.deadlineAtEntry ? formatDate(forecast.deadlineAtEntry) : 'Not recorded'}</p></details>}
    {forecast.scoreHistory.length > 0 && <details className="revision-history"><summary>Resolution and score history</summary><ol>{forecast.scoreHistory.map(entry => <li key={entry.version}>{formatDate(entry.correctedAt)} · venue outcome {entry.outcomeId} · {entry.score === null ? 'Unscored (ambiguous)' : `score ${entry.score.toFixed(3)}`} · version {entry.version}</li>)}</ol></details>}
  </div><div className="list-value"><small>Chance of {forecast.selectedOutcomeLabel ?? forecast.firstOutcomeLabel ?? 'first outcome'}</small><strong>{formatProbability(forecast.selectedOutcomeLabel && forecast.firstOutcomeLabel && forecast.selectedOutcomeLabel !== forecast.firstOutcomeLabel ? 1 - forecast.probability : forecast.probability)}</strong><small>{forecast.score === null ? 'Unscored' : forecast.scoreState === 'last-known' ? `Last confirmed score ${forecast.score.toFixed(3)} · latest venue result ambiguous` : `Score ${forecast.score.toFixed(3)}`}</small></div></article>)}</div>;
}
function PositionRows({ orders }: { orders: PaperOrder[] }) {
  return <div className="list-stack">{orders.map(order => <article className="list-item" key={order.id}><div>
    <Link className="item-title" href={`/markets/${encodeURIComponent(order.marketSlug)}`}>{order.marketQuestion || order.marketSlug} ↗</Link>
    <p className="small muted">{formatDate(order.createdAt)} · {order.model} · paper {order.state}</p>
    <p className="small muted">Local simulation · {order.shares.toFixed(2)} synthetic shares at {formatProbability(order.price)} · {order.side}</p>
    {order.settlementHistory.length > 0 && <details className="revision-history"><summary>Simulated settlement history</summary><ol>{order.settlementHistory.map(entry => <li key={entry.version}>{formatDate(entry.correctedAt)} · {entry.settlementCents === null ? 'Settlement pending' : formatCents(entry.settlementCents)} · version {entry.version}</li>)}</ol></details>}
  </div><div className="list-value"><strong>{formatCents(order.stakeCents)}</strong><small>{order.settlementCents === null ? 'Not settled' : order.settlementState === 'last-known' ? `Last confirmed settlement ${formatCents(order.settlementCents)} · latest venue result ambiguous` : `Settlement ${formatCents(order.settlementCents)}`}</small></div></article>)}</div>;
}

export function ActivityScreen() {
  const { user } = useSession();
  const resource = useResource<{ forecasts: Forecast[]; orders: PaperOrder[]; notices: Notice[] }>(user ? '/api/activity' : null);
  const [tab, setTab] = useState<'forecasts' | 'positions' | 'notices'>('forecasts');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function markRead(id: number) {
    setBusy(id); setError(null);
    try { await api(`/api/notices/${id}`, { method: 'PATCH', body: JSON.stringify({ read: true }) }); invalidate('/api/activity'); resource.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark notice as read.'); }
    finally { setBusy(null); }
  }
  return <div className="page-wrap"><SectionHead eyebrow="03 / ACTIVITY" title="Your thinking, over time." description="Your forecasts, local paper positions, and updates. Nothing here represents a real-money trade."/><AuthGate message="Sign in to see your forecasts, simulations and notices."><div className="tabs" role="tablist" aria-label="Activity view">{(['forecasts', 'positions', 'notices'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} type="button" onClick={() => setTab(value)}>{value === 'positions' ? 'Paper positions' : value[0].toUpperCase() + value.slice(1)}</button>)}</div><InlineStatus loading={resource.loading} error={resource.error} stale={resource.stale} retry={resource.reload}>{resource.data && <div role="tabpanel" aria-label={tab}>{tab === 'forecasts' ? resource.data.forecasts.length ? <ForecastRows forecasts={resource.data.forecasts}/> : <div className="status-card">No forecasts yet. <Link href="/rooms">Find a room ↗</Link></div> : tab === 'positions' ? resource.data.orders.length ? <><p className="simulation-note">Paper positions are local simulations, not venue orders. Prices are hypothetical observed midpoints with zero fees or slippage.</p><PositionRows orders={resource.data.orders}/></> : <div className="status-card">No paper positions yet. <Link href="/explore">Explore questions ↗</Link></div> : <><FormFeedback message={error}/>{resource.data.notices.length ? <div className="list-stack">{resource.data.notices.map(notice => <article className={`list-item ${notice.readAt ? '' : 'unread'}`} key={notice.id}><div><span className="eyebrow">{notice.kind}</span><p>{notice.message}</p><p className="small muted">{formatDate(notice.createdAt)}</p></div>{!notice.readAt && <button type="button" className="button button-small button-secondary" disabled={busy === notice.id} onClick={() => markRead(notice.id)}>{busy === notice.id ? 'Saving…' : 'Mark read'}</button>}</article>)}</div> : <div className="status-card">All caught up. No notices yet.</div>}</>}</div>}</InlineStatus></AuthGate></div>;
}

export function ProfileScreen({ handle }: { handle?: string }) {
  const session = useSession();
  const current = !handle;
  const path = handle ? `/api/profile/${encodeURIComponent(handle)}` : session.user ? `/api/profile/${encodeURIComponent(session.user.handle)}` : null;
  const resource = useResource<{ user: User; forecasts: Forecast[]; orders: PaperOrder[] }>(path);
  const settings = useResource<{ notifications: boolean }>(current && session.user ? '/api/settings' : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  async function update(enabled: boolean) {
    setBusy(true); setError(null); setSuccess(null);
    try { await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ notifications: enabled }) }); invalidate('/api/settings'); settings.reload(); setSuccess('Preference saved.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save preference.'); }
    finally { setBusy(false); }
  }
  return <div className="page-wrap"><SectionHead eyebrow="04 / PROFILE" title={resource.data ? `@${resource.data.user.handle}` : current ? 'Your corner of the internet.' : `@${handle}`} description="A record of forecasts and paper simulations — not a trading account."/>{current && !session.user ? <AuthGate message="Sign in to see your profile and preferences."><></></AuthGate> : <InlineStatus loading={resource.loading} error={resource.error} stale={resource.stale} retry={resource.reload}>{resource.data && <><div className="profile-banner"><span className="profile-avatar" aria-hidden="true">{resource.data.user.handle.slice(0, 1).toUpperCase()}</span><div><h2>@{resource.data.user.handle}</h2><p>Here since {formatDate(resource.data.user.createdAt)}</p></div></div><div className="profile-columns"><section><div className="section-head"><div><p className="eyebrow">01 / THINKING</p><h2>Forecasts</h2></div></div>{resource.data.forecasts.length ? <ForecastRows forecasts={resource.data.forecasts}/> : <div className="status-card">No forecasts to show.</div>}</section><section><div className="section-head"><div><p className="eyebrow">02 / SIMULATIONS</p><h2>Paper positions</h2></div></div>{resource.data.orders.length ? <><p className="simulation-note">Local simulations only; no real-money orders or venue fills.</p><PositionRows orders={resource.data.orders}/></> : <div className="status-card">No paper positions to show.</div>}</section></div>{current && <section className="settings-panel"><div><p className="eyebrow">03 / PREFERENCES</p><h2>Notifications</h2><p>Choose whether to receive in-app notices about your activity.</p></div><InlineStatus loading={settings.loading} error={settings.error} stale={settings.stale} retry={settings.reload}>{settings.data && <label className="toggle-label"><input type="checkbox" checked={settings.data.notifications} disabled={busy} onChange={event => update(event.target.checked)}/><span>In-app notifications {settings.data.notifications ? 'on' : 'off'}</span></label>}</InlineStatus><FormFeedback message={error}/>{success && <p role="status" className="success-note">{success}</p>}</section>}</>}</InlineStatus>}</div>;
}

export function AuthScreen() {
  const { user, loading, refresh } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ handle: handle.trim(), password }) });
      clearSnapshots(); refresh(); window.location.assign('/rooms');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in.'); setBusy(false); }
  }
  return <div className="auth-page"><div className="auth-art" aria-hidden="true"><span>✳</span><p>THE FUTURE<br/>IS A QUESTION.</p><div>· : * . · ✳ . : * ·</div></div><div className="auth-content"><p className="eyebrow">JOIN THE CONVERSATION</p><h1>Think out loud<span className="accent">.</span></h1><p className="lead">A local account for forecasts, rooms and paper simulations. No wallet or funds required.</p>{loading ? <p role="status">Checking your account…</p> : user ? <div className="callout"><p>Signed in as @{user.handle}.</p>{user.walletAddress && <p className="small muted wallet-address">Base Sepolia wallet: <span className="mono">{user.walletAddress}</span></p>}<Link href="/profile" className="button">Your profile ↗</Link></div> : <><div className="tabs auth-tabs" role="tablist" aria-label="Account action"><button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(null); }}>Create account</button><button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(null); }}>Sign in</button></div><form className="form-stack" onSubmit={submit}><Field label="Handle" name="handle" autoComplete="username" required value={handle} onChange={setHandle} placeholder="yourname"/><label className="field"><span>Password</span><input type="password" name="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required value={password} onChange={event => setPassword(event.target.value)}/></label><FormFeedback message={error}/><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'One moment…' : mode === 'register' ? 'Create account ↗' : 'Sign in ↗'}</button></form><p className="small muted">Your account and all predictions are stored locally by this app. Forecasts are opinions; paper positions are simulations.</p><WalletSignIn/></>}</div></div>;
}
