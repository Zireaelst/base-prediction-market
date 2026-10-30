'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Catalog, Market, MarketCategory } from '@/lib/contracts';
import { useCatalogPages } from './catalog-pages';
import { useResource } from './api';
import { formatDate, formatProbability } from './display';
import { SwipeDeck } from './swipe-deck';
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

const categories: { key: MarketCategory; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'crypto', label: 'Crypto' }, { key: 'sport', label: 'Sport' },
  { key: 'esports', label: 'Esports' }, { key: 'finance', label: 'Finance' }, { key: 'politics', label: 'Politics' }
];

function ListedMarket({ market, index }: { market: Market; index: number }) {
  return <Link href={`/markets/${encodeURIComponent(market.slug)}`} className="market-card discover-list-card">
    <div className="market-card-top"><span className="mono muted">{String(index + 1).padStart(2, '0')} / {market.category?.toUpperCase() || 'LIMITLESS'}</span><span className={`source-pill ${market.source === 'LIVE_LIMITLESS' ? 'live' : ''}`}>{market.source === 'LIVE_LIMITLESS' ? 'LIVE SNAPSHOT' : 'STALE SNAPSHOT'}</span></div>
    <h3>{market.question}</h3>
    <div className="market-card-bottom"><div><span className="meta-label">{market.outcomeLabels[0]} / {market.outcomeLabels[1]} · {market.priceLabel} (observation, not executable)</span><strong>{formatProbability(market.midpointYes)} / {formatProbability(market.midpointYes === null ? null : 1 - market.midpointYes)}</strong></div><span className="card-arrow" aria-hidden="true">↗</span></div>
    <div className="market-source">Closes {formatDate(market.deadline)} · observed {formatDate(market.observedAt)}</div>
  </Link>;
}

export function ExploreScreen() {
  const [category, setCategory] = useState<MarketCategory>('all');
  const [view, setView] = useState<'swipe' | 'list'>('swipe');
  const { catalog, markets: loadedMarkets, hasMore, loadMore, loadingMore, pageError, loadedPages } = useCatalogPages(category);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const markets = useMemo(() => loadedMarkets.filter(market => (filter === 'all' || market.status === filter) && `${market.question} ${market.description} ${market.outcomeLabels.join(' ')}`.toLowerCase().includes(query.toLowerCase().trim())), [loadedMarkets, filter, query]);
  const stale = catalog.stale || catalog.data?.source === 'STALE_LIMITLESS';
  const incomplete = !!catalog.data?.degradedCategories?.length;
  return <div className="page-wrap discover-page">
    <SectionHead eyebrow="01 / EXPLORE" title="Every question starts somewhere." description="Read real venue questions, then make your own free forecast. Venue odds are observations, not offers or guarantees."/>
    <nav className="discover-categories" aria-label="Market categories">{categories.map(item => <button type="button" key={item.key} aria-current={category === item.key ? 'page' : undefined} onClick={() => setCategory(item.key)}>{item.label}</button>)}</nav>
    <div className="discover-modes" role="group" aria-label="Explore view"><button type="button" aria-pressed={view === 'swipe'} onClick={() => setView('swipe')}>◇ Swipe</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>≡ List</button></div>
    {view === 'list' && <><div className="filter-row">
      <label className="search-field"><span className="sr-only">Search loaded questions</span><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search loaded questions…" /></label>
      <label className="select-field"><span className="sr-only">Filter loaded questions by status</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="closed">Closed</option><option value="resolved">Resolved</option><option value="unknown">Unknown</option></select></label>
    </div><p className="small muted">Categories load their own venue pages. Search and status apply only to questions already loaded in this category; load more to expand the search.</p></>}
    {catalog.data && <div className="results-line"><span>{view === 'list' ? `${markets.length} matching of ` : ''}{loadedMarkets.length} loaded {category === 'all' ? 'across categories' : category} · {loadedPages} {loadedPages === 1 ? 'page' : 'pages'}{hasMore ? ' · more pages available' : incomplete ? ' · remaining availability unknown' : ''}</span><span>{stale ? 'STALE VENUE SNAPSHOT' : catalog.data.source === 'LIVE_LIMITLESS' ? 'LIVE VENUE SNAPSHOT' : 'VENUE UNAVAILABLE'}{catalog.data.observedAt ? ` · ${formatDate(catalog.data.observedAt)}` : ''}</span></div>}
    {!!catalog.data?.degradedCategories?.length && <p className="status-banner" role="status">Some category sources could not load: {catalog.data.degradedCategories.join(', ')}. Only successfully fetched questions are shown. <button className="text-button" type="button" onClick={catalog.reload}>Retry venue</button></p>}
    <InlineStatus loading={catalog.loading} error={catalog.error || (catalog.data?.source === 'UNAVAILABLE' ? catalog.data.error || 'The venue is unavailable. Retry to fetch live questions.' : incomplete && catalog.data?.source === 'LIVE_LIMITLESS' ? null : catalog.data?.error || null)} stale={stale} retry={catalog.reload}>
      {view === 'swipe'
        ? <SwipeDeck key={category} markets={loadedMarkets} generation={catalog.data?.observedAt ?? ''} hasMore={hasMore} loadMore={loadMore} loadingMore={loadingMore} pageError={pageError} stale={!!stale} incomplete={incomplete} onRefresh={catalog.reload}/>
        : <><div className="market-grid">{markets.map((market, index) => <ListedMarket market={stale ? { ...market, source: 'STALE_LIMITLESS' } : market} index={index} key={market.slug}/>)}</div>{!markets.length && <div className="status-card">{loadedMarkets.length ? 'No loaded questions match your search and status. Load more or change the filters.' : incomplete ? 'No questions were available from the fetched categories; some sources did not respond. Retry for missing questions.' : 'No eligible binary questions in this category right now. Refresh to check again.'} {!loadedMarkets.length && <button className="button button-secondary" type="button" onClick={catalog.reload}>Refresh venue ↗</button>}</div>}</>}
    </InlineStatus>
    {view === 'list' && pageError && <p className="status-banner" role="alert">Could not load the next page: {pageError}. Try again.</p>}
    {view === 'list' && hasMore && <div className="catalog-more"><button className="button button-secondary" type="button" onClick={loadMore} disabled={loadingMore || catalog.loading || stale}>{loadingMore ? 'Loading more…' : 'Load more questions ↗'}</button></div>}
  </div>;
}
