import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, isAgedSnapshot } from '../../src/components/api';

afterEach(() => vi.unstubAllGlobals());

describe('browser request boundary', () => {
  it('sends JSON mutations with same-origin session credentials', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1, handle: 'alex', createdAt: '' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ handle: 'alex', password: 'secret' }) });
    expect(fetcher).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }));
  });
  it('reports server-provided failure text without hiding the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Forecast locked' }), { status: 409 })));
    await expect(api('/api/forecasts/1', { method: 'PATCH' })).rejects.toThrow('Forecast locked');
  });
  it('offers a recoverable connection failure when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(api('/api/markets')).rejects.toThrow('Could not reach the local server');
  });
  it('marks a live venue snapshot stale once its observation age exceeds two minutes', () => {
    const observedAt = '2026-10-29T12:00:00.000Z';
    const value = { source: 'LIVE_LIMITLESS', observedAt };
    const start = Date.parse(observedAt);
    expect(isAgedSnapshot(value, start + 120_000)).toBe(false);
    expect(isAgedSnapshot(value, start + 120_001)).toBe(true);
    expect(isAgedSnapshot({ ...value, source: 'STALE_LIMITLESS' }, start + 120_001)).toBe(false);
  });
});
