import { describe, expect, it } from 'vitest';
import { formatCents, formatProbability, marketProvenance, paperEstimate } from '../../src/components/display';
import type { Market } from '../../src/lib/contracts';

const market: Market = {
  venueId: 'limitless', venueMarketId: '42', slug: 'example', question: 'Will it happen?', description: '',
  deadline: '2026-12-01T00:00:00Z', resolutionSource: null, status: 'open', outcomeIds: ['yes', 'no'], outcomeLabels: ['Yes', 'No'],
  midpointYes: .6, priceLabel: 'Limitless CLOB midpoint (not executable quote)', winningOutcome: null, payoutNumerators: null, termsVersion: 'v1',
  observedAt: '2026-10-29T12:00:00Z', source: 'LIVE_LIMITLESS'
};

describe('market presentation', () => {
  it('distinguishes live, stale, and unavailable venue data', () => {
    expect(marketProvenance(market)).toContain('Live venue snapshot');
    expect(marketProvenance({ ...market, source: 'STALE_LIMITLESS' })).toContain('Stale venue snapshot');
    expect(marketProvenance({ ...market, source: 'UNAVAILABLE' })).toContain('Venue unavailable');
  });
  it('formats probabilities and local amounts without treating fractions as percentages', () => {
    expect(formatProbability(.625)).toBe('62.5%');
    expect(formatCents(1250)).toBe('$12.50');
  });
  it('estimates hypothetical shares only from valid snapshot prices', () => {
    const fresh = { ...market, observedAt: new Date().toISOString(), deadline: new Date(Date.now() + 60_000).toISOString() };
    expect(paperEstimate(fresh, 'yes', 1000)).toEqual({ price: .6, shares: 16.666666666666668 });
    expect(paperEstimate(fresh, 'no', 1000)).toEqual({ price: .4, shares: 25 });
    expect(paperEstimate({ ...fresh, midpointYes: null }, 'yes', 1000)).toBeNull();
    expect(paperEstimate(fresh, 'invalid', 1000)).toBeNull();
    expect(paperEstimate(fresh, 'yes', 0)).toBeNull();
    expect(paperEstimate(fresh, 'yes', 99)).toBeNull();
    expect(paperEstimate(fresh, 'yes', 10000001)).toBeNull();
  });
  it('refuses indicated AMM prices, arbitrary midpoint labels, expired or old snapshots, and closed markets', () => {
    const fresh = { ...market, observedAt: new Date().toISOString(), deadline: new Date(Date.now() + 60_000).toISOString() };
    expect(paperEstimate(fresh, 'yes', 1000)).not.toBeNull();
    expect(paperEstimate({ ...fresh, priceLabel: 'Limitless AMM indicated price (not executable quote)' }, 'yes', 1000)).toBeNull();
    expect(paperEstimate({ ...fresh, priceLabel: 'Some other midpoint' }, 'yes', 1000)).toBeNull();
    expect(paperEstimate({ ...fresh, observedAt: new Date(Date.now() - 121_000).toISOString() }, 'yes', 1000)).toBeNull();
    expect(paperEstimate({ ...fresh, observedAt: new Date(Date.now() + 60_000).toISOString() }, 'yes', 1000)).toBeNull();
    expect(paperEstimate({ ...fresh, deadline: new Date(Date.now() - 1_000).toISOString() }, 'yes', 1000)).toBeNull();
    expect(paperEstimate({ ...fresh, status: 'closed' }, 'yes', 1000)).toBeNull();
    expect(paperEstimate({ ...fresh, source: 'STALE_LIMITLESS' }, 'yes', 1000)).toBeNull();
  });
});
