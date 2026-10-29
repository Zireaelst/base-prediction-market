'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@/lib/contracts';

type Resource<T> = { data: T | null; loading: boolean; error: string | null; stale: boolean; reload: () => void };
const snapshots = new Map<string, unknown>();
const maxMarketAgeMs = 120_000;
export function isAgedSnapshot(value: unknown, at = Date.now()): boolean {
  if (!value || typeof value !== 'object' || !('source' in value) || value.source !== 'LIVE_LIMITLESS' || !('observedAt' in value) || typeof value.observedAt !== 'string') return false;
  const age = at - Date.parse(value.observedAt);
  return Number.isFinite(age) && age > maxMarketAgeMs;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers }, cache: 'no-store' });
  } catch {
    throw new Error('Could not reach the local server. Check your connection and try again.');
  }
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}). Please try again.`);
  if (body === null) throw new Error('The server returned an unreadable response. Please try again.');
  return body;
}

export function useResource<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<{ path: string | null; data: T | null; loading: boolean; error: string | null; stale: boolean }>(() => ({ path, data: path ? (snapshots.get(path) as T | undefined) ?? null : null, loading: Boolean(path), error: null, stale: false }));
  const [version, setVersion] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    if (!path) { setState({ path, data: null, loading: false, error: null, stale: false }); return; }
    let active = true;
    const cached = snapshots.get(path) as T | undefined;
    setState({ path, data: cached ?? null, stale: Boolean(cached), loading: true, error: null });
    api<T>(path).then(value => {
      if (!active) return;
      snapshots.set(path, value);
      setState({ path, data: value, stale: false, loading: false, error: null });
    }).catch(cause => {
      if (!active) return;
      setState({ path, data: cached ?? null, error: cause instanceof Error ? cause.message : 'Request failed.', stale: Boolean(cached), loading: false });
    });
    return () => { active = false; };
  }, [path, version]);
  useEffect(() => {
    if (!path?.startsWith('/api/markets')) return;
    const refresh = () => { setClock(Date.now()); if (!document.hidden) reload(); };
    const onVisible = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [path, reload]);
  const current = state.path === path ? state : { data: path ? (snapshots.get(path) as T | undefined) ?? null : null, loading: Boolean(path), error: null, stale: false };
  return { ...current, stale: current.stale || isAgedSnapshot(current.data, clock), reload };
}

export function invalidate(...paths: string[]): void { for (const path of paths) snapshots.delete(path); }
export function clearSnapshots(): void { snapshots.clear(); }

type Session = { user: User | null; loading: boolean; error: string | null; refresh: () => void };
const SessionContext = createContext<Session>({ user: null, loading: true, error: null, refresh: () => {} });
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useResource<{ user: User | null }>('/api/me');
  return <SessionContext.Provider value={{ user: session.data?.user ?? null, loading: session.loading, error: session.error, refresh: session.reload }}>{children}</SessionContext.Provider>;
}
export const useSession = () => useContext(SessionContext);
