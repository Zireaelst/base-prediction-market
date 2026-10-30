import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { closeDatabase } from '../../src/lib/server/db';
import { getCatalog, getMarket, normalizeMarket } from '../../src/lib/server/venue';
import { GET } from '../../src/app/api/markets/route';

const categories = ['crypto', 'sport', 'esports', 'finance', 'politics'] as const;
const fixture = (slug: string, id: number, title = `Will ${slug} win?`) => ({
  id, slug, title, description: '<p>Resolves according to the official final result.</p>',
  expirationTimestamp: Date.now() + 3600_000, status: 'FUNDED', tradeType: 'clob', marketType: 'single',
  tokens: { yes: String(id * 2), no: String(id * 2 + 1) }, prices: [.4, .6],
});
const sport = () => ({ ...fixture('sixers-hornets', 76, '76ers vs Hornets'), metadata: { outcomeLabels: { '0': '76ers', '1': 'Hornets' } } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (data: unknown[], number = 1, totalPages = 1) => ({ data, pagination: { page: number, limit: 25, total: 25 * (totalPages - 1) + data.length, totalPages } });
function venueFetch(rows: Partial<Record<(typeof categories)[number], (number: number) => unknown>>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === '/market-pages/by-path') {
      const key = url.searchParams.get('path')?.slice(1);
      return key && categories.some(category => category === key) ? json({ id: `provider-${key}`, fullPath: `/${key}` }) : json({}, 404);
    }
    const found = /^\/market-pages\/provider-(crypto|sport|esports|finance|politics)\/markets$/.exec(url.pathname);
    if (found) {
      const body = rows[found[1] as (typeof categories)[number]]?.(Number(url.searchParams.get('page')));
      return body ? json(body) : json({ message: 'unavailable' }, 503);
    }
    if (url.pathname === '/markets/sixers-hornets') return json(sport());
    throw new Error(`Unexpected provider path: ${url.pathname}`);
  });
}
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'prediction-category-')); process.env.DB_PATH = join(dir, 'test.sqlite'); });
afterEach(() => { vi.unstubAllGlobals(); closeDatabase(); rmSync(dir, { recursive: true, force: true }); delete process.env.DB_PATH; });

describe('provider market pages', () => {
  it('resolves the sport page by path, preserves token-specific labels, and counts raw page exhaustion', async () => {
    const ambiguous = { ...fixture('who-wins-final', 88, '76ers vs Hornets'), metadata: {} };
    const fetcher = venueFetch({ sport: () => page([sport(), { ...fixture('group', 89), marketType: 'group', markets: [sport()] }, ambiguous], 1, 2) });
    vi.stubGlobal('fetch', fetcher);
    const catalog = await getCatalog({ category: 'sport' });
    expect(catalog).toMatchObject({ category: 'sport', page: 1, source: 'LIVE_LIMITLESS', hasNextPage: true });
    expect(catalog.markets).toMatchObject([{ slug: 'sixers-hornets', category: 'sport', venueMarketId: '76', outcomeIds: ['152', '153'], outcomeLabels: ['76ers', 'Hornets'] }]);
    expect(catalog.totalMarketsCount).toBeUndefined(); // provider total includes unsupported group/ambiguous records
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/market-pages/by-path?path=%2Fsport'))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/market-pages/provider-sport/markets?limit=25&page=1'))).toBe(true);
    expect((await getMarket('sixers-hornets', { force: true })).outcomeLabels).toEqual(['76ers', 'Hornets']);
  });

  it('loads a later source page and reports real last-page exhaustion without inventing an eligible total', async () => {
    vi.stubGlobal('fetch', venueFetch({ politics: number => number === 2 ? page([fixture('next-election', 14)], 2, 2) : page([fixture('first-election', 13)], 1, 2) }));
    const first = await getCatalog({ category: 'politics' });
    const second = await getCatalog({ category: 'politics', page: 2 });
    expect(first).toMatchObject({ hasNextPage: true, page: 1 });
    expect(second).toMatchObject({ hasNextPage: false, page: 2, category: 'politics' });
    expect(second.markets.map(m => m.slug)).toEqual(['next-election']);
  });

  it('keeps a semantic yes/no single even when it has no executable price and rejects an unlabeled non-question', () => {
    const political = normalizeMarket({ ...fixture('vote', 25, 'Will the bill pass?'), prices: null }, new Date().toISOString(), 'politics');
    expect(political).toMatchObject({ outcomeLabels: ['Yes', 'No'], midpointYes: null, category: 'politics' });
    expect(normalizeMarket({ ...fixture('versus', 26, 'Alice vs Bob'), metadata: {} }, new Date().toISOString(), 'sport')).toBeNull();
    expect(normalizeMarket({ ...fixture('unclear-match', 29, 'Will 76ers vs Hornets?'), metadata: {} }, new Date().toISOString(), 'sport')).toBeNull();
    expect(normalizeMarket({ ...fixture('bad-label', 27), metadata: { outcomeLabels: { '0': 'Alpha', '1': 'Alpha' } } }, new Date().toISOString())).toBeNull();
    expect(normalizeMarket({ ...fixture('directional-amm', 28, 'BTC Up or Down - 5 Min'), tradeType: 'amm' }, new Date().toISOString())).toBeNull();
    expect(normalizeMarket({ ...fixture('amm-mislabeled', 30, 'BTC Up or Down - 5 Min'), tradeType: 'amm', metadata: { outcomeLabels: { '0': 'Up', '1': 'Down' } } }, new Date().toISOString())).toBeNull();
  });
  it('changes terms fingerprint when official token labels are corrected', () => {
    const observedAt = new Date().toISOString();
    const original = sport();
    const corrected = { ...original, metadata: { outcomeLabels: { '0': 'Hornets', '1': '76ers' } } };
    expect(normalizeMarket(original, observedAt)?.termsVersion).not.toBe(normalizeMarket(corrected, observedAt)?.termsVersion);
  });
  it('does not map a yes/no question containing up or down to directional token labels', () => {
    expect(normalizeMarket(fixture('ambiguous-direction', 66, 'Will BTC go up or down?'), new Date().toISOString())).toBeNull();
  });

  it('weaves genuinely fetched categories, dedupes IDs, and never lets crypto monopolize All', async () => {
    const fetcher = venueFetch({
      crypto: () => page([fixture('btc-one', 1), fixture('btc-two', 2)], 1, 2),
      sport: () => page([sport()], 1, 1),
      esports: () => page([fixture('same-sport', 76), fixture('esports', 3)], 1, 1),
      finance: () => page([fixture('finance', 4)], 1, 1),
      politics: () => page([], 1, 1),
    });
    vi.stubGlobal('fetch', fetcher);
    const all = await getCatalog();
    expect(all).toMatchObject({ category: 'all', source: 'LIVE_LIMITLESS', hasNextPage: true, page: 1 });
    expect(all.markets.map(m => m.slug)).toEqual(['btc-one', 'sixers-hornets', 'esports', 'finance', 'btc-two']);
    expect(all.totalMarketsCount).toBeUndefined();
    expect(all.degradedCategories).toBeUndefined();
  });

  it('does not repeat markets from a previously loaded page when provider pages overlap', async () => {
    vi.stubGlobal('fetch', venueFetch({
      crypto: number => page(number === 1 ? [fixture('btc', 1)] : [fixture('btc', 1), fixture('eth', 2)], number, 2),
      sport: () => page([]), esports: () => page([]), finance: () => page([]), politics: () => page([]),
    }));
    const first = await getCatalog();
    const second = await getCatalog({ page: 2 });
    expect(first.markets.map(m => m.slug)).toEqual(['btc']);
    expect(second.markets.map(m => m.slug)).toEqual(['eth']);
    expect(second).toMatchObject({ page: 2, degradedCategories: ['sport', 'esports', 'finance', 'politics'] });
    expect(second.hasNextPage).toBeUndefined(); // The other pages failed validation; exhaustion is unknown.
  });
  it('does not repeat a page-one ID on page three when page two has no overlap', async () => {
    vi.stubGlobal('fetch', venueFetch({
      crypto: number => page(number === 1 ? [fixture('btc', 1)] : number === 2 ? [fixture('eth', 2)] : [fixture('btc-again', 1), fixture('sol', 3)], number, 3),
      sport: () => page([]), esports: () => page([]), finance: () => page([]), politics: () => page([]),
    }));
    await getCatalog({ category: 'crypto', page: 1 });
    await getCatalog({ category: 'crypto', page: 2 });
    const thirdCategory = await getCatalog({ category: 'crypto', page: 3 });
    expect(thirdCategory.markets.map(market => market.venueMarketId)).toEqual(['3']);
    await getCatalog({ page: 1 });
    await getCatalog({ page: 2 });
    const thirdAll = await getCatalog({ page: 3 });
    expect(thirdAll.markets.map(market => market.venueMarketId)).toEqual(['3']);
  });

  it('exposes partial outage, full outage, stale snapshots, and successful retry without relabeling failed sources live', async () => {
    const available = venueFetch({ crypto: () => page([fixture('btc', 1)]) });
    vi.stubGlobal('fetch', available);
    const partial = await getCatalog();
    expect(partial.source).toBe('LIVE_LIMITLESS');
    expect(partial.degradedCategories).toEqual(['sport', 'esports', 'finance', 'politics']);
    expect(partial.markets.map(m => m.slug)).toEqual(['btc']);
    expect(partial.hasNextPage).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network offline')));
    const stale = await getCatalog({ force: true });
    expect(stale).toMatchObject({ source: 'STALE_LIMITLESS', observedAt: partial.observedAt, category: 'all' });
    expect(stale.degradedCategories).toEqual([...categories]);
    expect(stale.markets[0]).toMatchObject({ slug: 'btc', source: 'STALE_LIMITLESS' });
    expect((await getCatalog({ force: true, category: 'sport' })).source).toBe('UNAVAILABLE');
    vi.stubGlobal('fetch', venueFetch({ sport: () => page([sport()]) }));
    const recovered = await getCatalog({ category: 'sport', force: true });
    expect(recovered).toMatchObject({ source: 'LIVE_LIMITLESS', category: 'sport' });
    expect(recovered.markets[0].source).toBe('LIVE_LIMITLESS');
    const retryAll = await getCatalog();
    expect(retryAll).toMatchObject({ source: 'LIVE_LIMITLESS', degradedCategories: ['esports', 'finance', 'politics'] });
    expect(retryAll.markets.map(m => m.slug)).toEqual(['btc', 'sixers-hornets']);
  });

  it('does not conflate an empty category with an unavailable source, and uses stale cache for failed category refresh', async () => {
    vi.stubGlobal('fetch', venueFetch({ sport: () => page([]) }));
    const empty = await getCatalog({ category: 'sport' });
    expect(empty).toMatchObject({ source: 'LIVE_LIMITLESS', markets: [], hasNextPage: false });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const stale = await getCatalog({ category: 'sport', force: true });
    expect(stale).toMatchObject({ source: 'STALE_LIMITLESS', markets: [], observedAt: empty.observedAt });
  });

  it('rejects invalid category query values before network access', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await GET(new NextRequest('http://localhost/api/markets?category=unknown&page=1'));
    expect(result.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
