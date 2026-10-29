import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { closeDatabase } from '../../src/lib/server/db';
import { register } from '../../src/lib/server/auth';
import { addForecast, createRoom, getActivity, placePaperOrder } from '../../src/lib/server/domain';
import { requireSameOrigin, reconcileForRead } from '../../src/lib/server/http';
import { DomainError } from '../../src/lib/server/errors';
import type { Market } from '../../src/lib/contracts';

let dir: string;
const market = (id: number): Market => ({ venueId: 'limitless', venueMarketId: String(id), slug: `market-${id}`, question: 'Test?', description: 'Resolution criteria', deadline: new Date(Date.now() + 3600_000).toISOString(), resolutionSource: 'Limitless', status: 'open', outcomeIds: [String(id * 10 + 1), String(id * 10 + 2)], outcomeLabels: ['Yes', 'No'], midpointYes: .4, priceLabel: 'Limitless CLOB midpoint (not executable quote)', winningOutcome: null, payoutNumerators: null, termsVersion: `terms-${id}`, observedAt: new Date().toISOString(), source: 'LIVE_LIMITLESS' });
const response = (m: Market) => new Response(JSON.stringify({ id: Number(m.venueMarketId), slug: m.slug, title: m.question, description: m.description, expirationTimestamp: Date.parse(m.deadline), status: 'RESOLVED', tradeType: 'clob', marketType: 'single', tokens: { yes: m.outcomeIds[0], no: m.outcomeIds[1] }, prices: [.4, .6], winningOutcomeIndex: null, payoutNumerators: [1, 0] }), { headers: { 'content-type': 'application/json' } });

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'prediction-read-')); process.env.DB_PATH = join(dir, 'test.sqlite'); });
afterEach(() => { vi.unstubAllGlobals(); closeDatabase(); rmSync(dir, { recursive: true, force: true }); delete process.env.DB_PATH; });

describe('local history reconciliation', () => {
  it('returns history during multiple slow venue requests without waiting for sequential timeouts', async () => {
    const user = register('alice', 'long-secret-one').user;
    const room = createRoom(user.id, 'Room', '', false);
    for (let id = 1; id <= 3; id++) {
      const m = market(id);
      addForecast(user.id, room.id, m, m.outcomeIds[0], .7, 'reason');
      placePaperOrder(user.id, m, m.outcomeIds[0], 1000);
    }
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      options.signal?.addEventListener('abort', () => reject(new Error('venue timeout')), { once: true });
      return promise;
    }));
    const start = performance.now();
    await reconcileForRead(user.id);
    expect(performance.now() - start).toBeLessThan(1200);
    expect(getActivity(user.id).forecasts).toHaveLength(3);
    expect(getActivity(user.id).orders).toHaveLength(3);
  });
  it('scores and settles a resolved market when the venue responds during the bounded wait', async () => {
    const user = register('alice', 'long-secret-one').user;
    const room = createRoom(user.id, 'Room', '', false);
    const m = market(17);
    addForecast(user.id, room.id, m, m.outcomeIds[1], .8, 'YES probability');
    placePaperOrder(user.id, m, m.outcomeIds[0], 1000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(m)));
    await reconcileForRead(user.id);
    expect(getActivity(user.id).forecasts[0].score).toBeCloseTo(96);
    expect(getActivity(user.id).orders[0]).toMatchObject({ state: 'settled', settlementCents: 2500 });
  });
});

describe('same-origin mutations', () => {
  it('accepts the browser origin matching Host despite a normalized nextUrl hostname', () => {
    const request = new NextRequest('http://localhost:3000/api/auth/register', { headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }, method: 'POST' });
    expect(() => requireSameOrigin(request)).not.toThrow();
  });
  it('rejects a cross-origin request even if forwarded host claims to match', () => {
    const request = new NextRequest('http://localhost:3000/api/auth/register', { headers: { host: '127.0.0.1:3000', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }, method: 'POST' });
    expect(() => requireSameOrigin(request)).toThrow(DomainError);
  });
});
