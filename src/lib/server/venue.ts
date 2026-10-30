import { createHash } from 'node:crypto';
import { database } from './db';
import { DomainError } from './errors';
import type { Catalog, Market, MarketCategory, MarketStatus } from '../contracts';

const baseURL = 'https://api.limitless.exchange';
const cacheTTL = 30_000;
const maxFreshAge = 120_000;
type SpecificCategory = Exclude<MarketCategory, 'all'>;
const categoryPaths: Record<SpecificCategory, string> = {
  crypto: '/crypto', sport: '/sport', esports: '/esports', finance: '/finance', politics: '/politics',
};
const categories = Object.keys(categoryPaths) as SpecificCategory[];
interface CacheRow { payload: string; observed_at: string; }
interface VenueRecord { [key: string]: unknown; }
function object(value: unknown): VenueRecord | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as VenueRecord : null; }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function outcomeToken(value: unknown): string | null { return typeof value === 'string' && /^\d+$/.test(value) ? value : null; }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 24); }
// The pre-category catalog fingerprint omitted venue labels and structured resolution source.
// Use only for forecasts written before immutable market snapshots were introduced.
export function legacyTermsVersion(market: Market): string {
  return digest(`${market.question}|${market.description}|${Date.parse(market.deadline)}|${market.outcomeIds[0]}|${market.outcomeIds[1]}`);
}

function plainText(html: string): string {
  return html.replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (entity[0] !== '#') return named[entity.toLowerCase()] || '';
      const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function labelsFor(row: VenueRecord, question: string): [string, string] | null {
  const metadata = object(row.metadata);
  const declared = metadata?.outcomeLabels;
  if (declared !== undefined && declared !== null) {
    const firstValue: unknown = Array.isArray(declared) ? declared[0] : object(declared)?.['0'];
    const secondValue: unknown = Array.isArray(declared) ? declared[1] : object(declared)?.['1'];
    const first = text(firstValue) && plainText(firstValue as string);
    const second = text(secondValue) && plainText(secondValue as string);
    return first && second && first.toLowerCase() !== second.toLowerCase()
      ? [first, second] : null;
  }
  if (/\bup or down\b/i.test(question)) {
    const verifiedDirectional = /^[A-Z][A-Z0-9.-]{1,15}(?: (?:Daily|Hourly|15 Min(?:ute)?))? Up or Down\b/.test(question);
    return row.tradeType === 'clob' && verifiedDirectional ? ['Up', 'Down'] : null;
  }
  return /^(?:will|is|are|does|do|did|has|have|can|could|would|should|was|were)\b/i.test(question)
    && !/\b(?:vs\.?|versus)\b/i.test(question) && /\?$/.test(question) ? ['Yes', 'No'] : null;
}

export function normalizeMarket(raw: unknown, observedAt: string, category?: SpecificCategory): Market | null {
  const row = object(raw);
  if (!row || row.marketType === 'group' || row.tradeType === 'group' || Array.isArray(row.markets) ||
    (row.tradeType === 'amm' && /\bup or down\b/i.test(String(row.title ?? row.proxyTitle ?? '')))) return null;
  const tokens = object(row.tokens);
  const slug = text(row.slug);
  const yes = outcomeToken(tokens?.yes);
  const no = outcomeToken(tokens?.no);
  const question = text(row.title) || text(row.proxyTitle);
  const description = text(row.description) ? plainText(row.description as string) : '';
  const outcomeLabels = question && labelsFor(row, question);
  const id = row.id;
  const deadlineMs = typeof row.expirationTimestamp === 'number' ? row.expirationTimestamp : Date.parse(String(row.expirationTimestamp || ''));
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug) || !yes || !no || yes === no || !question || !description || !outcomeLabels || !Number.isFinite(deadlineMs) || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
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
    venueId: 'limitless', category, venueMarketId: String(id), slug, question, description,
    deadline: new Date(deadlineMs).toISOString(), resolutionSource, status,
    outcomeIds: [yes, no], outcomeLabels,
    midpointYes, priceLabel: row.tradeType === 'clob' ? 'Limitless CLOB midpoint (not executable quote)' : row.tradeType === 'amm' ? 'Limitless AMM indicated price (not executable quote)' : 'Price unavailable',
    winningOutcome, payoutNumerators: payouts, termsVersion: digest(`${question}|${description}|${deadlineMs}|${yes}|${no}|${JSON.stringify(outcomeLabels)}|${resolutionSource ?? ''}`), observedAt, source: 'LIVE_LIMITLESS',
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

function staleCatalog(previous: CacheRow | undefined, category: MarketCategory, page: number, error: unknown): Catalog {
  if (!previous) return {
    markets: [], observedAt: null, source: 'UNAVAILABLE', category, page,
    ...(category === 'all' ? { degradedCategories: categories } : {}),
    error: error instanceof Error ? error.message : 'Market data unavailable',
  };
  const snapshot = JSON.parse(previous.payload) as Catalog;
  return {
    ...snapshot, category, page, source: 'STALE_LIMITLESS',
    ...(category === 'all' ? { degradedCategories: categories } : {}),
    markets: snapshot.markets.map(market => ({ ...market, source: 'STALE_LIMITLESS' })),
    error: 'Limitless unavailable; showing an older snapshot',
  };
}

function saveDetailMarkets(markets: Market[], observedAt: string): void {
  for (const market of markets) {
    const key = `market:${market.slug}`;
    const previous = cached(key);
    if (!previous || Date.parse(previous.observed_at) < Date.parse(observedAt) - cacheTTL) save(key, market, observedAt);
  }
}

async function pageId(category: SpecificCategory): Promise<string> {
  const path = categoryPaths[category];
  const key = `market-page:${category}`;
  const previous = cached(key);
  if (previous && Date.now() - Date.parse(previous.observed_at) < cacheTTL) return JSON.parse(previous.payload) as string;
  const resolved = object(await request(`/market-pages/by-path?path=${encodeURIComponent(path)}`));
  const id = text(resolved?.id);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || resolved?.fullPath !== path) throw new DomainError('Invalid Limitless market page', 503);
  save(key, id, new Date().toISOString());
  return id;
}
function priorMarketIds(category: MarketCategory, page: number): Set<string> {
  const seen = new Set<string>();
  for (let previousPage = 1; previousPage < page; previousPage++) {
    const prior = cached(`catalog:${category}:${previousPage}`);
    if (!prior) continue;
    for (const market of (JSON.parse(prior.payload) as Catalog).markets) seen.add(market.venueMarketId);
  }
  return seen;
}

async function categoryCatalog(category: SpecificCategory, page: number, force?: boolean): Promise<Catalog> {
  const key = `catalog:${category}:${page}`;
  const previous = cached(key);
  if (previous && !force && Date.now() - Date.parse(previous.observed_at) < cacheTTL) return JSON.parse(previous.payload) as Catalog;
  try {
    const id = await pageId(category);
    const result = object(await request(`/market-pages/${encodeURIComponent(id)}/markets?limit=25&page=${page}`));
    const pagination = object(result?.pagination);
    if (!result || !Array.isArray(result.data) || !pagination ||
      pagination.page !== page || pagination.limit !== 25 ||
      typeof pagination.total !== 'number' || !Number.isSafeInteger(pagination.total) || pagination.total < 0 ||
      typeof pagination.totalPages !== 'number' || !Number.isSafeInteger(pagination.totalPages) || pagination.totalPages < 0) {
      throw new DomainError('Invalid Limitless market page response', 503);
    }
    const observedAt = new Date().toISOString();
    const seen = priorMarketIds(category, page);
    const markets = result.data.map(row => normalizeMarket(row, observedAt, category)).filter((market): market is Market => {
      if (!market || seen.has(market.venueMarketId)) return false;
      seen.add(market.venueMarketId);
      return true;
    });
    const catalog: Catalog = {
      markets, observedAt, source: 'LIVE_LIMITLESS', category, page,
      hasNextPage: page < pagination.totalPages,
    };
    save(key, catalog, observedAt);
    saveDetailMarkets(markets, observedAt);
    return catalog;
  } catch (error) {
    return staleCatalog(previous, category, page, error);
  }
}

export async function getCatalog(options: { force?: boolean; page?: number; category?: MarketCategory } = {}): Promise<Catalog> {
  const page = Number.isSafeInteger(options.page) && options.page! > 0 ? options.page! : 1;
  const category = options.category ?? 'all';
  if (category !== 'all' && !Object.hasOwn(categoryPaths, category)) throw new DomainError('Invalid market category', 400);
  if (category !== 'all') return categoryCatalog(category, page, options.force);

  const key = `catalog:all:${page}`;
  const previous = cached(key);
  if (previous && !options.force && Date.now() - Date.parse(previous.observed_at) < cacheTTL &&
    !(JSON.parse(previous.payload) as Catalog).degradedCategories?.length) return JSON.parse(previous.payload) as Catalog;
  const pages = await Promise.all(categories.map(name => categoryCatalog(name, page, options.force)));
  const degradedCategories = categories.filter((_, index) => pages[index].source !== 'LIVE_LIMITLESS');
  if (degradedCategories.length === categories.length) return staleCatalog(previous, 'all', page, new DomainError('Limitless category pages unavailable', 503));
  const seen = priorMarketIds('all', page);
  const markets: Market[] = [];
  const offsets = pages.map(() => 0);
  for (;;) {
    let added = false;
    for (let index = 0; index < pages.length; index++) {
      const catalog = pages[index];
      if (catalog.source !== 'LIVE_LIMITLESS') continue;
      while (offsets[index] < catalog.markets.length) {
        const market = catalog.markets[offsets[index]++];
        if (seen.has(market.venueMarketId)) continue;
        seen.add(market.venueMarketId);
        markets.push(market);
        added = true;
        break;
      }
    }
    if (!added) break;
  }
  const observedAt = pages.filter(catalog => catalog.source === 'LIVE_LIMITLESS')
    .map(catalog => catalog.observedAt as string).sort()[0];
  const catalog: Catalog = {
    markets, observedAt, source: 'LIVE_LIMITLESS', category: 'all', page,
    hasNextPage: pages.some(item => item.source === 'LIVE_LIMITLESS' && item.hasNextPage === true) ? true : degradedCategories.length ? undefined : false,
    ...(degradedCategories.length ? { degradedCategories, error: 'Some Limitless categories are unavailable' } : {}),
  };
  save(key, catalog, observedAt);
  return catalog;
}

export async function getMarket(slug: string, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<Market> {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(slug)) throw new DomainError('Invalid market slug', 400);
  const key = `market:${slug}`;
  const previous = cached(key);
  if (previous && !options.force && Date.now() - Date.parse(previous.observed_at) < cacheTTL) return JSON.parse(previous.payload) as Market;
  try {
    const observedAt = new Date().toISOString();
    const previousMarket = previous ? JSON.parse(previous.payload) as Market : null;
    const market = normalizeMarket(await request(`/markets/${encodeURIComponent(slug)}`, options.signal), observedAt, previousMarket?.category);
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
