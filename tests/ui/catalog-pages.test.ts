import { describe, expect, it } from 'vitest';
import { catalogListing } from '../../src/components/catalog-pages';
import type { Catalog, Market } from '../../src/lib/contracts';

const market = (slug: string) => ({ slug, question: slug }) as Market;
const page = (markets: Market[]) => ({ markets, observedAt: '2026-10-29T12:00:00Z', source: 'LIVE_LIMITLESS' }) as Catalog;

describe('catalog page accumulation', () => {
  it('keeps earlier and later page results while dropping repeated market slugs', () => {
    const first = Array.from({ length: 25 }, (_, index) => market(`question-${index}`));
    const listing = catalogListing([page(first), page([market('question-24'), market('question-25')])]);
    expect(listing.markets.map(item => item.slug)).toEqual([...first.map(item => item.slug), 'question-25']);
    expect(listing.hasMore).toBe(false);
  });
  it('does not show the same venue market twice when categories use different slugs', () => {
    const sport = { ...market('team-win'), venueMarketId: '431' };
    const mixed = { ...market('team-win-alias'), venueMarketId: '431' };
    expect(catalogListing([page([sport]), page([mixed])]).markets).toEqual([sport]);
  });
  it('allows the next page when a full 25-market page is loaded', () => {
    expect(catalogListing([page(Array.from({ length: 25 }, (_, index) => market(String(index))))]).hasMore).toBe(true);
    expect(catalogListing([page([])]).hasMore).toBe(false);
  });
  it('requires refresh rather than pretending a partially failed category has a known next page', () => {
    const mixed: Catalog = { ...page(Array.from({ length: 25 }, (_, index) => market(`question-${index}`))), degradedCategories: ['sport'] };
    expect(catalogListing([mixed]).hasMore).toBe(false);
  });
  it('marks cached catalog cards stale while retaining the observed market identity', () => {
    const original = market('question-1');
    const listing = catalogListing([page([original])], true);
    expect(listing.markets[0]).toMatchObject({ slug: 'question-1', source: 'STALE_LIMITLESS' });
    expect(original.source).not.toBe('STALE_LIMITLESS');
  });
  it('continues past filtered records when the raw venue page has a successor', () => {
    expect(catalogListing([{ ...page([market('valid')]), hasNextPage: true }]).hasMore).toBe(true);
    expect(catalogListing([{ ...page([market('valid')]), hasNextPage: false }]).hasMore).toBe(false);
  });
});
