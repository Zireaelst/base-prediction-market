import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, database } from '../../src/lib/server/db';
import { register } from '../../src/lib/server/auth';
import { placePaperOrder, reconcileMarket, getPaperOrders } from '../../src/lib/server/domain';
import { getCatalog, getMarket, normalizeMarket } from '../../src/lib/server/venue';
import { DomainError } from '../../src/lib/server/errors';
import type { Market } from '../../src/lib/contracts';

let dir: string;
const payload = () => ({ id: 17, slug: 'test-market', title: 'Test question?', description: '<p>Resolution &amp; criteria</p>', expirationTimestamp: Date.now() + 3600_000, status: 'FUNDED', tradeType: 'clob', marketType: 'single', tokens: { yes: '101', no: '202' }, prices: [.4, .6], winningOutcomeIndex: null, payoutNumerators: null });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'prediction-venue-')); process.env.DB_PATH = join(dir, 'test.sqlite'); });
afterEach(() => { vi.unstubAllGlobals(); closeDatabase(); rmSync(dir, { recursive: true, force: true }); delete process.env.DB_PATH; });

describe('read-only venue and paper model', () => {
  it('filters incomplete identity, strips HTML, uses correct deadline and stale cache on outage', async () => {
    const sample = payload();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ data: [sample, { ...sample, slug: '', id: null }], totalMarketsCount: 2 })).mockRejectedValue(new Error('network offline')));
    const live = await getCatalog();
    expect(live.markets).toHaveLength(1);
    expect(live.markets[0]).toMatchObject({ description: 'Resolution & criteria', venueMarketId: '17', outcomeIds: ['101', '202'], source: 'LIVE_LIMITLESS' });
    expect(live.markets[0].deadline).toBe(new Date(sample.expirationTimestamp).toISOString());
    const stale = await getCatalog({ force: true });
    expect(stale.source).toBe('STALE_LIMITLESS');
    expect(stale.markets[0].observedAt).toBe(live.markets[0].observedAt);
    expect((await getMarket('test-market', { force: true })).source).toBe('STALE_LIMITLESS');
  });
  it('retains venue pagination after filtering invalid identities from a full raw page', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ ...payload(), id: index + 1, slug: `question-${index}` }));
    rows[9] = { ...rows[9], slug: '' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: rows })));
    const catalog = await getCatalog();
    expect(catalog.markets).toHaveLength(24);
    expect(catalog.hasNextPage).toBe(true);
  });
  it('rejects simulated fills on stale data and settles by venue payout numerator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(payload())));
    const user = register('alice', 'long-secret-one').user;
    const market = await getMarket('test-market');
    const order = placePaperOrder(user.id, market, '101', 1000);
    expect(order).toMatchObject({ model: 'midpoint-v1', stakeCents: 1000, price: .4, shares: 25, state: 'filled' });
    expect(database().prepare('SELECT observed_at, terms_version FROM paper_orders WHERE id = ?').get(order.id)).toEqual({ observed_at: market.observedAt, terms_version: market.termsVersion });
    expect(() => placePaperOrder(user.id, market, '101', 150)).toThrow(DomainError);
    expect(() => placePaperOrder(user.id, { ...market, source: 'STALE_LIMITLESS' }, '101', 1000)).toThrow(DomainError);
    const inconsistentPrice = normalizeMarket({ ...payload(), prices: [.4, -.2] }, new Date().toISOString());
    expect(inconsistentPrice?.midpointYes).toBeNull();
    expect(() => placePaperOrder(user.id, inconsistentPrice!, '101', 1000)).toThrow(DomainError);
    const amm = normalizeMarket({ ...payload(), tradeType: 'amm', prices: [40, 60] }, new Date().toISOString());
    expect(() => placePaperOrder(user.id, amm!, '101', 1000)).toThrow(DomainError);
    const resolved: Market = { ...market, status: 'resolved', winningOutcome: '101', payoutNumerators: [1, 0] };
    reconcileMarket(resolved);
    expect(getPaperOrders(user.id)[0]).toMatchObject({ state: 'settled', settlementCents: 2500 });
    reconcileMarket({ ...resolved, winningOutcome: null, payoutNumerators: null });
    expect(getPaperOrders(user.id)[0]).toMatchObject({ settlementState: 'last-known', settlementCents: 2500 });
    reconcileMarket(resolved);
    expect(getPaperOrders(user.id)[0].settlementState).toBe('confirmed');
    expect(getPaperOrders(user.id)[0].settlementHistory).toHaveLength(1);
    reconcileMarket({ ...resolved, winningOutcome: null, payoutNumerators: [50, 50] });
    expect(getPaperOrders(user.id)[0]).toMatchObject({ state: 'settled', settlementCents: 1250 });
    expect(getPaperOrders(user.id)[0].settlementHistory.map(item => item.settlementCents)).toEqual([2500, 1250]);
    expect(database().prepare('SELECT settlement_cents FROM paper_settlement_history WHERE order_id = ? ORDER BY id').all(order.id)).toEqual([{ settlement_cents: 2500 }, { settlement_cents: 1250 }]);
  });
});
