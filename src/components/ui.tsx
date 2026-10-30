'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, clearSnapshots, useSession } from './api';
import { formatDate, formatProbability, marketProvenance } from './display';
import type { Market } from '@/lib/contracts';

const links = [ { href: '/', label: 'Home', glyph: '⌂' }, { href: '/explore', label: 'Explore', glyph: '◇' }, { href: '/rooms', label: 'Rooms', glyph: '▦' }, { href: '/activity', label: 'Activity', glyph: '≡' } ];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading, refresh } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try { await api('/api/auth/logout', { method: 'POST' }); clearSnapshots(); refresh(); window.location.assign('/'); }
    catch { setSigningOut(false); window.alert('Could not sign out. Please try again.'); }
  }
  return <><a className="skip-link" href="#content">Skip to content</a><header className="site-header"><div className="header-inner"><Link className="wordmark" href="/" aria-label="PREDICT home"><span aria-hidden="true">✳</span> PREDICT<span className="wordmark-dot">.</span></Link><nav className="desktop-nav" aria-label="Primary navigation">{links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href + '/')) ? 'page' : undefined}>{link.label}</Link>)}</nav><div className="header-account">{loading ? <span className="muted small">Loading account…</span> : user ? <><Link className="account-link" href="/profile">@{user.handle}</Link><button className="text-button small" type="button" onClick={signOut} disabled={signingOut}>Sign out</button></> : <Link className="button button-small" href="/auth">Sign in <span aria-hidden="true">↗</span></Link>}</div></div></header><main id="content">{children}</main><footer className="site-footer"><span>PREDICT<span className="accent">.</span> / A place to think in probabilities</span><span>Research and simulations only. No real-money trading.</span></footer><nav className="mobile-nav" aria-label="Mobile navigation">{links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href + '/')) ? 'page' : undefined}><span aria-hidden="true">{link.glyph}</span><span>{link.label}</span></Link>)}</nav></>;
}

export function SectionHead({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) { return <div className="section-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="lead">{description}</p>}</div>{action}</div>; }
export function InlineStatus({ loading, error, stale, retry, empty, children }: { loading: boolean; error: string | null; stale?: boolean; retry: () => void; empty?: string; children: ReactNode }) {
  if (loading && !stale) return <div className="status-card" role="status"><span className="loading-glyph" aria-hidden="true">◌</span> Loading…</div>;
  if (error && !stale) return <div className="status-card error" role="alert"><p>{error}</p><button className="button button-small" type="button" onClick={retry}>Try again ↗</button></div>;
  return <>{(stale || error) && <div className="status-banner" role="status">Showing last available data. {error || (loading ? 'Checking for updates…' : 'This snapshot may be out of date.')} <button className="text-button" onClick={retry} type="button">Retry</button></div>}{empty ? <div className="status-card">{empty}</div> : children}</>;
}
export function MarketCard({ market, index }: { market: Market; index?: number }) {
  return <Link href={`/markets/${encodeURIComponent(market.slug)}`} className="market-card"><div className="market-card-top"><span className="mono muted">{index !== undefined ? String(index + 1).padStart(2, '0') : '◇'} / LIMITLESS</span><span className={`source-pill ${market.source === 'LIVE_LIMITLESS' ? 'live' : ''}`}>{market.source === 'LIVE_LIMITLESS' ? 'LIVE SNAPSHOT' : market.source === 'STALE_LIMITLESS' ? 'STALE SNAPSHOT' : 'UNAVAILABLE'}</span></div><h3>{market.question}</h3><div className="market-card-bottom"><div><span className="meta-label">{market.outcomeLabels[0]} · {market.priceLabel}</span><strong>{formatProbability(market.midpointYes)}</strong></div><span className="card-arrow" aria-hidden="true">↗</span></div><div className="market-source">{marketProvenance(market)} · {market.status}</div></Link>;
}
export function Field({ label, name, type = 'text', required, min, max, step, value, onChange, placeholder, children, autoComplete }: { label: string; name: string; type?: string; required?: boolean; min?: number; max?: number; step?: number | string; value?: string | number; onChange?: (value: string) => void; placeholder?: string; children?: ReactNode; autoComplete?: string }) {
  return <label className="field"><span>{label}</span>{children ?? <input name={name} type={type} required={required} min={min} max={max} step={step} value={value} onChange={onChange ? event => onChange(event.target.value) : undefined} placeholder={placeholder} autoComplete={autoComplete} />}</label>;
}
export function FormFeedback({ message }: { message: string | null }) { return message ? <p className="form-error" role="alert">{message}</p> : null; }
export function DateMeta({ value }: { value: string }) { return <time dateTime={value}>{formatDate(value)}</time>; }
export function AuthGate({ children, message = 'Sign in to join the conversation.' }: { children: ReactNode; message?: string }) { const { user, loading, error, refresh } = useSession(); if (loading) return <div className="status-card" role="status">Checking your account…</div>; if (error) return <div className="status-card error" role="alert">{error} <button className="button button-small" onClick={refresh}>Try again</button></div>; if (!user) return <div className="callout"><p>{message}</p><Link className="button" href="/auth">Sign in or create account ↗</Link></div>; return <>{children}</>; }
export function ActionForm({ onSubmit, children, submitLabel, busy }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode; submitLabel: string; busy: boolean }) { return <form onSubmit={onSubmit} className="form-stack">{children}<button className="button" type="submit" disabled={busy}>{busy ? 'Working…' : submitLabel}</button></form>; }
