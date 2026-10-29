import { createHash } from 'node:crypto';
import { database } from './db';
import { DomainError } from './errors';
import type { Catalog, Market, MarketStatus } from '../contracts';

const baseURL = 'https://api.limitless.exchange';
const cacheTTL = 30_000;
const maxFreshAge = 120_000;
interface CacheRow { payload: string; observed_at: string; }
interface VenueRecord { [key: string]: unknown; }
function object(value: unknown): VenueRecord | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as VenueRecord : null; }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function outcomeToken(value: unknown): string | null { return typeof value === 'string' && /^\d+$/.test(value) ? value : null; }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 24); }

function plainText(html: string): string {
  return html.replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (entity[0] !== '#') return named[entity.toLowerCase()] || '';
      const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function normalizeMarket(raw: unknown, observedAt: string): Market | null {
  const row = object(raw);
  if (!row || row.marketType === 'group' || Array.isArray(row.markets)) return null;
  const tokens = object(row.tokens);
  const slug = text(row.slug);
  const yes = outcomeToken(tokens?.yes);
  const no = outcomeToken(tokens?.no);
  const question = text(row.title) || text(row.proxyTitle);
  const description = text(row.description) ? plainText(row.description as string) : '';
  const id = row.id;
  const deadlineMs = typeof row.expirationTimestamp === 'number' ? row.expirationTimestamp : Date.parse(String(row.expirationTimestamp || ''));
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug) || !yes || !no || yes === no || !question || !description || !Number.isFinite(deadlineMs) || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  const status: MarketStatus = row.status === 'FUNDED' && !row.expired && deadlineMs > Date.now() ? 'open' : row.status === 'RESOLVED' ? 'resolved' : ['CREATED', 'DRAFTED', 'LOCKED', 'FUNDED'].includes(String(row.status)) ? 'closed' : 'unknown';
  const prices = Array.isArray(row.prices) ? row.prices : [];
  const yesPrice = prices[0];
  const noPrice = prices[1];
  const validClobPair = typeof yesPrice === 'number' && typeof noPrice === 'number' && Number.isFinite(yesPrice) && Number.isFinite(noPrice) && yesPrice > 0 && yesPrice < 1 && noPrice > 0 && noPrice < 1 && Math.abs(yesPrice + noPrice - 1) <= 0.05;
  const midpointYes = row.tradeType === 'clob' && validClobPair ? yesPrice : row.tradeType === 'amm' && typeof yesPrice === 'number' && Number.isFinite(yesPrice) && yesPrice > 0 && yesPrice < 100 ? yesPrice / 100 : null;
  const payouts = Array.isArray(row.payoutNumerators) && row.payoutNumerators.length === 2 && row.payoutNumerators.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) && row.payoutNumerators.some(n => n > 0) ? row.payoutNumerators as [number, number] : null;
  const winnerIndex = row.winningOutcomeIndex;
  const winningOutcome = status === 'resolved' && (winnerIndex === 0 || winnerIndex === 1) ? (winnerIndex === 0 ? yes : no) : null;
  const metadata = object(row.metadata);
  const resolutionSource = plainText(text(row.resolutionSource) || text(metadata?.resolutionSource) || (description.match(/Resolution source:\s*([^\n]+)/i)?.[1] ?? '')) || null;
  return {
    venueId: 'limitless', venueMarketId: String(id), slug, question, description,
    deadline: new Date(deadlineMs).toISOString(), resolutionSource, status,
    outcomeIds: [yes, no], outcomeLabels: /\bup or down\b/i.test(question) ? ['Up', 'Down'] : ['Yes', 'No'],
    midpointYes, priceLabel: row.tradeType === 'clob' ? 'Limitless CLOB midpoint (not executable quote)' : row.tradeType === 'amm' ? 'Limitless AMM indicated price (not executable quote)' : 'Price unavailable',
    winningOutcome, payoutNumerators: payouts, termsVersion: digest(`${question}|${description}|${deadlineMs}|${yes}|${no}`), observedAt, source: 'LIVE_LIMITLESS',
  };
}

async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(`${baseURL}${path}`, { method: 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000), headers: { accept: 'application/json' }, cache: 'no-store' });
      if (response.ok) return await response.json();
      if (response.status === 404) throw new DomainError('Market not found', 404);
      if (response.status !== 429 && response.status < 500) throw new DomainError(`Venue rejected market request (${response.status})`, 502);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof DomainError) throw error;
    }
    if (attempt < 2) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 150 * 2 ** attempt);
      await promise;
    }
  }
  throw new DomainError('Limitless market data is temporarily unavailable', 503);
}

function cached(key: string): CacheRow | undefined {
  return database().prepare('SELECT payload, observed_at FROM venue_cache WHERE cache_key = ?').get(key) as CacheRow | undefined;
}
function save(key: string, payload: unknown, observedAt: string): void {
  database().prepare('INSERT INTO venue_cache (cache_key, payload, observed_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, observed_at = excluded.observed_at').run(key, JSON.stringify(payload), observedAt);
}
export function isFreshMarket(market: Market): boolean {
  const age = Date.now() - Date.parse(market.observedAt);
  return market.source === 'LIVE_LIMITLESS' && Number.isFinite(age) && age >= 0 && age <= maxFreshAge;
}

export async function getCatalog(options: { force?: boolean; page?: number } = {}): Promise<Catalog> {
  const page = Number.isSafeInteger(options.page) && options.page! > 0 ? options.page! : 1;
  const key = `catalog:${page}`;
  const previous = cached(key);
  if (previous && !options.force && Date.now() - Date.parse(previous.observed_at) < cacheTTL) return { ...(JSON.parse(previous.payload) as Catalog), source: 'LIVE_LIMITLESS' };
  try {
    const result = object(await request(`/markets/active?limit=25&page=${page}`));
    if (!result || !Array.isArray(result.data)) throw new DomainError('Invalid Limitless catalog response', 503);
    const observedAt = new Date().toISOString();
    const markets = result.data.map(row => normalizeMarket(row, observedAt)).filter((m): m is Market => m !== null);
    const totalMarketsCount = typeof result.totalMarketsCount === 'number' && Number.isSafeInteger(result.totalMarketsCount) ? result.totalMarketsCount : undefined;
    const catalog: Catalog = { markets, observedAt, source: 'LIVE_LIMITLESS', totalMarketsCount, hasNextPage: totalMarketsCount !== undefined ? page * 25 < totalMarketsCount : result.data.length === 25, page };
    save(key, catalog, observedAt);
    for (const market of markets) {
      const detailKey = `market:${market.slug}`;
      const priorDetail = cached(detailKey);
      if (!priorDetail || Date.parse(priorDetail.observed_at) < Date.parse(observedAt) - cacheTTL) save(detailKey, market, observedAt);
    }
    return catalog;
  } catch (error) {
    if (!previous) return { markets: [], observedAt: null, source: 'UNAVAILABLE', error: error instanceof Error ? error.message : 'Market data unavailable' };
    const snapshot = JSON.parse(previous.payload) as Catalog;
    return { ...snapshot, source: 'STALE_LIMITLESS', markets: snapshot.markets.map(m => ({ ...m, source: 'STALE_LIMITLESS' })), error: 'Limitless unavailable; showing an older snapshot' };
  }
}

export async function getMarket(slug: string, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<Market> {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(slug)) throw new DomainError('Invalid market slug', 400);
  const key = `market:${slug}`;
  const previous = cached(key);
  if (previous && !options.force && Date.now() - Date.parse(previous.observed_at) < cacheTTL) return JSON.parse(previous.payload) as Market;
  try {
    const observedAt = new Date().toISOString();
    const market = normalizeMarket(await request(`/markets/${encodeURIComponent(slug)}`, options.signal), observedAt);
    if (!market || market.slug !== slug) throw new DomainError('Market has incomplete identity or resolution terms', 422);
    options.signal?.throwIfAborted();
    save(key, market, observedAt);
    return market;
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) throw error;
    if (!previous) throw error instanceof DomainError ? error : new DomainError('Market data unavailable', 503);
    return { ...(JSON.parse(previous.payload) as Market), source: 'STALE_LIMITLESS' };
  }
}
