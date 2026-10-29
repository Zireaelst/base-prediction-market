'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Catalog } from '@/lib/contracts';
import { useCatalogPages } from './catalog-pages';
import { useResource } from './api';
import { InlineStatus, MarketCard, SectionHead } from './ui';

const particles = `  ?  [ YES ] ────────────╮       ·      :
  │    ░▒▓  ∴ ∴ ∴     ├── outcome
  └─ [ NO  ] ────────────╯       ✳
       ·     .   ░▒▓▒░      ·
  forecast → resolve → learn
       .       :       .       *`;

export function HomeScreen() {
  const catalog = useResource<Catalog>('/api/markets');
  const markets = (catalog.data?.markets.slice(0, 3) ?? []).map(market => catalog.stale ? { ...market, source: 'STALE_LIMITLESS' as const } : market);
  return <><section className="hero"><div className="hero-grain" aria-hidden="true"/><pre className="hero-particles" aria-hidden="true">{particles}</pre><div className="hero-content"><p className="eyebrow"><span className="indicator"/> THE INTERNET, WITH ODDS</p><h1>Future<br/>thinking<span className="accent">.</span></h1><p className="hero-description">A place to make your call, compare your thinking, and see how your predictions age. Real market questions. Your own probabilities. No real-money trades.</p><div className="hero-actions"><Link className="button button-primary" href="/explore">Explore markets <span aria-hidden="true">↗</span></Link><Link className="underlined-link" href="/rooms">Find your room <span aria-hidden="true">↗</span></Link></div><div className="hero-footnote"><span>01 / DISCOVER</span><span>02 / FORECAST</span><span>03 / LEARN</span></div></div><div className="hero-aside" aria-hidden="true"><span>∴</span><p>UNCERTAINTY<br/>IS THE POINT.</p><span>//// 001</span></div></section><section className="content-section"><SectionHead eyebrow="01 / THE QUESTIONS" title="Outcomes worth thinking about." description="Browse read-only Limitless market snapshots. A forecast is your opinion, not an order." action={<Link className="underlined-link" href="/explore">View all markets ↗</Link>}/>{catalog.data?.source === 'STALE_LIMITLESS' && <p className="status-banner">Venue data is stale. Check the observation time before using it.</p>}{catalog.data?.source === 'UNAVAILABLE' && <p className="status-banner">Venue currently unavailable. No sample markets are shown.</p>}<InlineStatus loading={catalog.loading} error={catalog.error || catalog.data?.error || null} stale={(catalog.stale || catalog.data?.source === 'STALE_LIMITLESS')} retry={catalog.reload} empty={!markets.length && !catalog.loading ? 'No market snapshots available right now. Try refreshing later.' : undefined}><div className="market-grid">{markets.map((market, index) => <MarketCard market={market} index={index} key={market.slug}/>)}</div></InlineStatus></section><section className="steps-section"><p className="eyebrow">02 / YOUR SPACE</p><div className="steps-grid"><h2>Less noise.<br/><span className="accent">More signal.</span></h2><div className="steps-list"><div><span>01</span><p><strong>Take a position, intellectually.</strong><br/>Share a probability and a reason in a room.</p></div><div><span>02</span><p><strong>Keep a paper trail.</strong><br/>Revisit forecasts and simulated positions as questions resolve.</p></div><div><span>03</span><p><strong>Make it yours.</strong><br/>Create a public or private room for better conversations.</p></div><Link href="/rooms" className="underlined-link">Explore rooms ↗</Link></div></div></section></>;
}

export function ExploreScreen() {
  const { catalog, markets: loadedMarkets, hasMore, loadMore, loadingMore, pageError, loadedPages } = useCatalogPages();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const markets = useMemo(() => loadedMarkets.filter(market => (filter === 'all' || market.status === filter) && `${market.question} ${market.description}`.toLowerCase().includes(query.toLowerCase().trim())), [loadedMarkets, filter, query]);
  return <div className="page-wrap">
    <SectionHead eyebrow="01 / EXPLORE" title="Every question starts somewhere." description="Real read-only venue snapshots. Prices are observations, not offers or guarantees."/>
    <div className="filter-row">
      <label className="search-field"><span className="sr-only">Search loaded questions</span><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search loaded questions…" /></label>
      <label className="select-field"><span className="sr-only">Filter loaded questions by status</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="closed">Closed</option><option value="resolved">Resolved</option><option value="unknown">Unknown</option></select></label>
    </div>
    <p className="small muted">Search and status filter apply only to loaded questions. Load more to include additional venue pages.</p>
    {catalog.data && <div className="results-line"><span>{markets.length} matching of {loadedMarkets.length} loaded questions · {loadedPages} {loadedPages === 1 ? 'page' : 'pages'}</span><span>{catalog.stale || catalog.data.source === 'STALE_LIMITLESS' ? 'STALE VENUE SNAPSHOT' : catalog.data.source === 'LIVE_LIMITLESS' ? 'LIVE VENUE SNAPSHOT' : 'VENUE UNAVAILABLE'}{catalog.data.observedAt ? ` · ${new Date(catalog.data.observedAt).toLocaleString()}` : ''}</span></div>}
    <InlineStatus loading={catalog.loading} error={catalog.error || catalog.data?.error || null} stale={(catalog.stale || catalog.data?.source === 'STALE_LIMITLESS')} retry={catalog.reload} empty={!markets.length && !catalog.loading ? query || filter !== 'all' ? 'No loaded questions match your filters. Load more or try a different search.' : 'No venue markets available. Refresh to try again; no sample data is substituted.' : undefined}><div className="market-grid">{markets.map((market, index) => <MarketCard market={market} index={index} key={market.slug}/>)}</div></InlineStatus>
    {pageError && <p className="status-banner" role="alert">Could not load the next page: {pageError}. Try again.</p>}
    {hasMore && <div className="catalog-more"><button className="button button-secondary" type="button" onClick={loadMore} disabled={loadingMore || catalog.loading || (catalog.stale || catalog.data?.source === 'STALE_LIMITLESS')}>{loadingMore ? 'Loading more…' : 'Load more questions ↗'}</button></div>}
  </div>;
}
