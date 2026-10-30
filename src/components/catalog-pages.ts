'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog, Market, MarketCategory } from '@/lib/contracts';
import { api, useResource } from './api';

export function catalogListing(pages: Catalog[], stale = false): { markets: Market[]; hasMore: boolean } {
  const seen = new Set<string>();
  const observed = pages.flatMap(page => page.markets).filter(market => {
    const key = market.venueMarketId ? `${market.venueId}:${market.venueMarketId}` : market.slug;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const markets = stale ? observed.map(market => ({ ...market, source: 'STALE_LIMITLESS' as const })) : observed;
  const last = pages.at(-1);
  const hasMore = last?.hasNextPage ?? (last?.degradedCategories?.length ? false : pages[0]?.totalMarketsCount !== undefined
    ? pages.length * 25 < pages[0].totalMarketsCount
    : (last?.markets.length ?? 0) === 25);
  return { markets, hasMore };
}

export function useCatalogPages(category: MarketCategory = 'all') {
  const catalog = useResource<Catalog>(`/api/markets?category=${category}`);
  const [extra, setExtra] = useState<{ key: string; pages: Catalog[] }>({ key: '', pages: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const firstKey = `${category}:${catalog.data?.observedAt ?? ''}`;
  const currentKey = useRef(firstKey);
  currentKey.current = firstKey;
  useEffect(() => { setExtra({ key: firstKey, pages: [] }); setPageError(null); setLoadingMore(false); }, [firstKey]);
  const pages = extra.key === firstKey ? extra.pages : [];
  const loadedPages = 1 + pages.length;
  const { markets, hasMore } = catalogListing(catalog.data ? [catalog.data, ...pages] : [], catalog.stale);
  const loadMore = useCallback(async () => {
    if (pending.current === firstKey || !hasMore || catalog.data?.source !== 'LIVE_LIMITLESS' || catalog.stale || catalog.loading) return;
    pending.current = firstKey;
    setLoadingMore(true);
    setPageError(null);
    try {
      const page = await api<Catalog>(`/api/markets?category=${category}&page=${loadedPages + 1}`);
      if (page.source !== 'LIVE_LIMITLESS') throw new Error(page.error || 'The next venue page is unavailable.');
      if (currentKey.current === firstKey) setExtra(previous => ({ key: firstKey, pages: [...(previous.key === firstKey ? previous.pages : []), page] }));
    } catch (error) {
      if (currentKey.current === firstKey) setPageError(error instanceof Error ? error.message : 'Could not load more questions.');
    } finally {
      if (pending.current === firstKey) pending.current = null;
      if (currentKey.current === firstKey) setLoadingMore(false);
    }
  }, [category, firstKey, catalog.data?.source, catalog.loading, catalog.stale, hasMore, loadedPages]);
  return { catalog, markets, loadedPages, hasMore, loadMore, loadingMore, pageError };
}
