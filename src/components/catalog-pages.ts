'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog, Market } from '@/lib/contracts';
import { api, useResource } from './api';

export function catalogListing(pages: Catalog[], stale = false): { markets: Market[]; hasMore: boolean } {
  const observed = [...new Map(pages.flatMap(page => page.markets).map(market => [market.slug, market])).values()];
  const markets = stale ? observed.map(market => ({ ...market, source: 'STALE_LIMITLESS' as const })) : observed;
  const last = pages.at(-1);
  const hasMore = last?.hasNextPage ?? (pages[0]?.totalMarketsCount !== undefined
    ? pages.length * 25 < pages[0].totalMarketsCount
    : (last?.markets.length ?? 0) === 25);
  return { markets, hasMore };
}

export function useCatalogPages() {
  const catalog = useResource<Catalog>('/api/markets');
  const [extra, setExtra] = useState<{ observedAt: string | null | undefined; pages: Catalog[] }>({ observedAt: undefined, pages: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const pending = useRef(false);
  const firstObserved = useRef(catalog.data?.observedAt);
  firstObserved.current = catalog.data?.observedAt;
  useEffect(() => { setExtra({ observedAt: catalog.data?.observedAt, pages: [] }); setPageError(null); }, [catalog.data?.observedAt]);
  const pages = extra.observedAt === catalog.data?.observedAt ? extra.pages : [];
  const loadedPages = 1 + pages.length;
  const { markets, hasMore } = catalogListing(catalog.data ? [catalog.data, ...pages] : [], catalog.stale);
  const loadMore = useCallback(async () => {
    if (pending.current || !hasMore || catalog.data?.source !== 'LIVE_LIMITLESS' || catalog.stale || catalog.loading) return;
    const requestedFrom = catalog.data?.observedAt;
    pending.current = true;
    setLoadingMore(true);
    setPageError(null);
    try {
      const page = await api<Catalog>(`/api/markets?page=${loadedPages + 1}`);
      if (page.source !== 'LIVE_LIMITLESS') throw new Error(page.error || 'The next venue page is unavailable.');
      if (firstObserved.current === requestedFrom) setExtra(previous => ({ observedAt: requestedFrom, pages: [...(previous.observedAt === requestedFrom ? previous.pages : []), page] }));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not load more questions.');
    } finally {
      pending.current = false;
      setLoadingMore(false);
    }
  }, [catalog.data?.observedAt, catalog.data?.source, catalog.loading, catalog.stale, hasMore, loadedPages]);
  return { catalog, markets, loadedPages, hasMore, loadMore, loadingMore, pageError };
}
