import type { Market } from '@/lib/contracts';

export function formatProbability(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Number((value * 100).toFixed(1))}%`;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
}

export function marketProvenance(market: Market): string {
  const prefix = market.source === 'LIVE_LIMITLESS' ? 'Live venue snapshot' : market.source === 'STALE_LIMITLESS' ? 'Stale venue snapshot' : 'Venue unavailable';
  return `${prefix} · observed ${formatDate(market.observedAt)}`;
}

export function paperEstimate(market: Market, outcomeId: string, stakeCents: number): { price: number; shares: number } | null {
  const age = Date.now() - Date.parse(market.observedAt);
  if (market.venueId !== 'limitless' || market.status !== 'open' || market.source !== 'LIVE_LIMITLESS'
    || !Number.isFinite(age) || age < 0 || age > 120_000 || Date.parse(market.deadline) <= Date.now()
    || market.priceLabel !== 'Limitless CLOB midpoint (not executable quote)') return null;
  const index = market.outcomeIds.indexOf(outcomeId);
  if (index < 0 || market.midpointYes === null || !Number.isFinite(market.midpointYes) || !Number.isSafeInteger(stakeCents) || stakeCents < 100 || stakeCents > 10000000 || stakeCents % 100 !== 0) return null;
  const price = index === 0 ? market.midpointYes : 1 - market.midpointYes;
  if (price <= 0 || price >= 1) return null;
  return { price, shares: stakeCents / 100 / price };
}
