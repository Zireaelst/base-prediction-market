'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import type { Forecast, Market, Room } from '@/lib/contracts';
import { api, invalidate, useResource, useSession } from './api';
import { formatDate, formatProbability } from './display';
import { swipeDirection, swipeOffset } from './swipe-gesture';

type Draft = { market: Market; outcomeIndex: 0 | 1; probability: string; rationale: string; destination: string };
type Activity = { forecasts: Forecast[] };
type Props = { markets: Market[]; generation: string; hasMore: boolean; loadMore: () => void; loadingMore: boolean; stale: boolean; incomplete?: boolean; onRefresh: () => void; pageError?: string | null };
// Retain only the identity of an interrupted attempt across view/category remounts, never its private rationale.
type PendingSubmission = { marketId: string; destination: string; userId: number };
let pendingSubmission: PendingSubmission | null = null;
const pendingKey = 'explore:pending-forecast';

function canForecast(market: Market, stale: boolean): boolean {
  const age = Date.now() - Date.parse(market.observedAt);
  const deadline = Date.parse(market.deadline);
  return !stale && market.source === 'LIVE_LIMITLESS' && market.status === 'open'
    && Number.isFinite(age) && age >= 0 && age <= 120_000
    && Number.isFinite(deadline) && deadline > Date.now()
    && market.outcomeIds.length === 2 && market.outcomeIds.every(Boolean)
    && market.outcomeIds[0] !== market.outcomeIds[1] && market.outcomeLabels.every(Boolean);
}

export function SwipeDeck({ markets, generation, hasMore, loadMore, loadingMore, stale, incomplete = false, onRefresh, pageError }: Props) {
  const { user, loading: authLoading, error: authError, refresh: refreshSession } = useSession();
  const rooms = useResource<{ rooms: Room[] }>(user ? '/api/rooms' : null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [existing, setExisting] = useState<Forecast | null>(null);
  const [uncertain, setUncertain] = useState(Boolean(pendingSubmission));
  const [reconciled, setReconciled] = useState(false);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const unresolved = useRef<PendingSubmission | null>(pendingSubmission);
  const firstButton = useRef<HTMLButtonElement>(null);
  const secondButton = useRef<HTMLButtonElement>(null);
  const probabilityInput = useRef<HTMLInputElement>(null);
  const nextFocus = useRef(false);
  const returnFocus = useRef(false);
  const focusOutcome = useRef<0 | 1>(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const endFocus = useRef<HTMLDivElement>(null);
  const previousGeneration = useRef(generation);
  const focusedMarketId = useRef(markets[0]?.venueMarketId ?? null);
  const market = markets[index];
  const latestDraftMarket = draft && markets.find(item => item.slug === draft.market.slug);
  const termsChanged = !!draft && !!latestDraftMarket && (latestDraftMarket.termsVersion !== draft.market.termsVersion
    || latestDraftMarket.outcomeIds[0] !== draft.market.outcomeIds[0] || latestDraftMarket.outcomeIds[1] !== draft.market.outcomeIds[1]);
  const joinedRooms = rooms.data?.rooms.filter(room => room.kind !== 'personal' && (room.role === 'member' || room.role === 'owner')) ?? [];

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(pendingKey);
      if (!raw || unresolved.current) return;
      const value = JSON.parse(raw) as Partial<PendingSubmission>;
      if (typeof value.marketId !== 'string' || !value.marketId || typeof value.destination !== 'string' || !Number.isSafeInteger(value.userId) || !value.userId) {
        window.sessionStorage.removeItem(pendingKey);
        return;
      }
      unresolved.current = value as PendingSubmission;
      pendingSubmission = unresolved.current;
      setUncertain(true);
    } catch { /* A blocked storage API must not interfere with read-only discovery. */ }
  }, []);

  useEffect(() => {
    if (draft) probabilityInput.current?.focus();
  }, [draft?.market.slug, draft?.outcomeIndex]);
  useEffect(() => {
    if (draft) return;
    if (returnFocus.current) {
      returnFocus.current = false;
      const button = (focusOutcome.current === 0 ? firstButton : secondButton).current;
      (button && !button.disabled ? button : heading.current)?.focus();
    } else if (nextFocus.current && (market || !loadingMore)) {
      nextFocus.current = false;
      (market ? heading.current : endFocus.current)?.focus();
    }
  }, [draft, market, loadingMore]);
  useEffect(() => {
    if (previousGeneration.current !== generation) {
      previousGeneration.current = generation;
      const sameMarket = markets.findIndex(item => item.venueMarketId === focusedMarketId.current);
      setIndex(sameMarket < 0 ? 0 : sameMarket);
    }
  }, [generation, markets]);
  useEffect(() => { focusedMarketId.current = market?.venueMarketId ?? null; }, [market?.venueMarketId]);
  useEffect(() => {
    if (!draft && index >= markets.length - 2 && hasMore && !loadingMore && !stale && !pageError) loadMore();
  }, [draft, index, markets.length, hasMore, loadingMore, stale, pageError, loadMore]);
  useEffect(() => {
    if (!latestDraftMarket || termsChanged) return;
    setDraft(current => {
      if (!current || current.market.slug !== latestDraftMarket.slug || current.market.termsVersion !== latestDraftMarket.termsVersion) return current;
      const previous = current.market;
      return previous.observedAt === latestDraftMarket.observedAt && previous.status === latestDraftMarket.status
        && previous.source === latestDraftMarket.source && previous.deadline === latestDraftMarket.deadline
        ? current : { ...current, market: latestDraftMarket };
    });
  }, [latestDraftMarket, termsChanged]);

  function select(outcomeIndex: 0 | 1) {
    if (!market || !canForecast(market, stale)) return;
    focusOutcome.current = outcomeIndex;
    setFeedback(unresolved.current ? 'Check the earlier interrupted submission against Activity before making another forecast.' : null);
    setExisting(null);
    setUncertain(!!unresolved.current);
    setReconciled(false);
    setDraft({ market, outcomeIndex, probability: '', rationale: '', destination: 'personal' });
  }
  function advance() {
    setIndex(value => value + 1);
    setRevealed(false);
    setFeedback(null);
    nextFocus.current = true;
  }
  function cancel() {
    setDraft(null);
    setFeedback(null);
    setExisting(null);
    setUncertain(!!unresolved.current);
    setReconciled(false);
    returnFocus.current = true;
  }
  function startPointer(event: PointerEvent<HTMLElement>) {
    if (draft || !market || !canForecast(market, stale) || event.pointerType === 'mouse' && event.button !== 0
      || (event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function movePointer(event: PointerEvent<HTMLElement>) {
    const start = pointer.current;
    if (start?.id === event.pointerId) setDragOffset(swipeOffset(event.clientX - start.x, event.clientY - start.y));
  }
  function cancelPointer() {
    pointer.current = null;
    setDragOffset(0);
  }
  function endPointer(event: PointerEvent<HTMLElement>) {
    const start = pointer.current;
    cancelPointer();
    if (!start || start.id !== event.pointerId) return;
    const direction = swipeDirection(event.clientX - start.x, event.clientY - start.y);
    if (direction) select(direction === 'first' ? 0 : 1);
  }
  async function reconcile(target: Pick<Draft, 'market' | 'destination'> | PendingSubmission, reason?: string) {
    if (unresolved.current && (!user || unresolved.current.userId !== user.id)) {
      setUncertain(true);
      setFeedback('Sign in with the account that started the interrupted submission to check its Activity before retrying.');
      return;
    }
    setBusy(true);
    setReconciled(false);
    try {
      // Activity is the authoritative owner-only read after an interrupted POST. Never infer success from a transport error.
      const activity = await api<Activity>('/api/activity');
      const match = activity.forecasts.find(forecast => forecast.marketId === ('marketId' in target ? target.marketId : target.market.venueMarketId) && (
        target.destination === 'personal'
          ? forecast.destinationKind === 'personal'
          : forecast.roomId === Number(target.destination)
      ));
      unresolved.current = null;
      pendingSubmission = null;
      try { window.sessionStorage.removeItem(pendingKey); } catch { /* This tab may block storage. */ }
      if (match) {
        setExisting(match);
        setUncertain(false);
        setFeedback(`${reason ? `${reason} ` : ''}A forecast for this question already exists in that destination. Review it before revising; no additional submission was made.`);
      } else {
        setExisting(null);
        setUncertain(false);
        setReconciled(true);
        setFeedback(`${reason ? `${reason} ` : ''}No matching forecast appears in your activity yet. The earlier request may still complete; review Activity before choosing to retry.`);
      }
    } catch {
      setUncertain(true);
      setFeedback('Could not check Activity after the interrupted submission. Do not resubmit until you can check whether it was recorded.');
    } finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy || uncertain || unresolved.current || existing || !user) return;
    if (termsChanged || !latestDraftMarket || !canForecast(latestDraftMarket, stale) || !canForecast(draft.market, stale)) {
      setFeedback('This question changed, closed, or its venue snapshot is too old. Refresh the venue before recording a forecast. Your draft is preserved.');
      return;
    }
    const percentage = Number(draft.probability);
    if (draft.probability.trim() === '' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100 || !draft.rationale.trim()) {
      setFeedback('Enter your own 0–100% estimate and a reason before confirming.');
      return;
    }
    const destination = draft.destination === 'personal' ? 'personal' : Number(draft.destination);
    if (destination !== 'personal' && !joinedRooms.some(room => room.id === destination)) {
      setFeedback('You are not currently a member of that room. Choose a joined room or your private personal space.');
      return;
    }
    setBusy(true);
    setFeedback(null);
    setReconciled(false);
    try {
      await api<{ forecast: Forecast }>('/api/forecasts', { method: 'POST', body: JSON.stringify({
        marketSlug: draft.market.slug, outcomeId: draft.market.outcomeIds[draft.outcomeIndex],
        selectedProbability: percentage / 100, rationale: draft.rationale.trim(), destination, termsVersion: draft.market.termsVersion
      }) });
      invalidate('/api/activity', '/api/rooms', `/api/profile/${encodeURIComponent(user.handle)}`, ...(destination === 'personal' ? [] : [`/api/rooms/${destination}`]));
      setDraft(null);
      advance();
    } catch (error) {
      // The API helper intentionally does not expose HTTP status. Re-read after ANY failure, including duplicate or transport failure.
      unresolved.current = { marketId: draft.market.venueMarketId, destination: draft.destination, userId: user.id };
      pendingSubmission = unresolved.current;
      try { window.sessionStorage.setItem(pendingKey, JSON.stringify(unresolved.current)); } catch { /* The in-memory gate still protects this tab. */ }
      setUncertain(true);
      setFeedback(error instanceof Error ? `${error.message} Checking Activity before another attempt…` : 'Submission was interrupted. Checking Activity…');
      await reconcile(draft, error instanceof Error ? error.message : 'Submission was interrupted.');
    } finally { setBusy(false); }
  }

  if (draft) {
    const selected = draft.market.outcomeLabels[draft.outcomeIndex];
    const locked = termsChanged || !latestDraftMarket || !canForecast(latestDraftMarket, stale) || !canForecast(draft.market, stale);
    return <section className="swipe-confirm" aria-labelledby="swipe-confirm-heading" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancel(); } }}>
      <p className="eyebrow">CONFIRM / FREE FORECAST</p>
      <h2 id="swipe-confirm-heading">Your call: {selected}</h2>
      <p className="swipe-question">{draft.market.question}</p>
      <p className="small muted">Your estimate is the chance of <strong>{selected}</strong>, not the other outcome. No order or trade will be placed.</p>
      <dl className="swipe-facts"><div><dt>Outcome</dt><dd>{selected} · token {draft.market.outcomeIds[draft.outcomeIndex]}</dd></div><div><dt>Closes</dt><dd>{formatDate(draft.market.deadline)}</dd></div><div><dt>Resolution source</dt><dd>{draft.market.resolutionSource || 'Not specified by venue'}</dd></div><div><dt>Venue snapshot</dt><dd>{draft.market.source === 'LIVE_LIMITLESS' && !stale ? 'Limitless observation' : 'Stale Limitless observation'} · {formatDate(draft.market.observedAt)}</dd></div></dl>
      <div className="swipe-terms"><h3>Resolution terms</h3><p>{draft.market.description || 'Full resolution terms are not available in this snapshot. Review the market details before confirming.'}</p><p className="mono small muted">Terms version: {draft.market.termsVersion}</p></div>
      {locked && <p className="status-banner" role="status">{termsChanged ? 'The venue changed this question’s outcome mapping or terms. Cancel and select it again before forecasting.' : 'This question is closed, unavailable, or its snapshot is stale. Your draft is preserved; refresh the venue and check the deadline before submitting.'} <button className="text-button" type="button" onClick={onRefresh}>Refresh venue</button></p>}
      <form className="form-stack" onSubmit={submit}>
        <label className="field"><span>Your probability for {selected} (%)</span><input ref={probabilityInput} name="probability" type="number" inputMode="decimal" min="0" max="100" step="any" required placeholder="Your estimate, 0–100" value={draft.probability} onChange={event => setDraft(current => current && ({ ...current, probability: event.target.value }))}/></label>
        <label className="field"><span>Why do you think so?</span><textarea name="rationale" required maxLength={4000} rows={4} value={draft.rationale} onChange={event => setDraft(current => current && ({ ...current, rationale: event.target.value }))} placeholder="Explain your reasoning"/></label>
        <label className="field"><span>Where to save it</span><select value={draft.destination} disabled={busy || uncertain} onChange={event => { setDraft(current => current && ({ ...current, destination: event.target.value })); setExisting(null); setReconciled(false); setFeedback(null); }}><option value="personal">My private personal space (default)</option>{joinedRooms.map(room => <option key={room.id} value={room.id}>Joined room: {room.name}</option>)}</select></label>
        {user && rooms.loading && <p className="small muted" role="status">Checking your joined rooms…</p>}
        {user && rooms.error && <p className="status-banner" role="status">Could not load joined rooms. Personal space remains available. <button type="button" className="text-button" onClick={rooms.reload}>Retry rooms</button></p>}
        {user && !rooms.loading && !rooms.error && !joinedRooms.length && <p className="small muted">No joined rooms yet. Your personal forecast stays private; <Link href="/rooms">browse rooms</Link> if you want to join one first.</p>}
        {authLoading && <p role="status">Checking your sign-in…</p>}
        {!authLoading && authError && <p role="alert">Could not check your sign-in. <button type="button" className="text-button" onClick={refreshSession}>Try again</button></p>}
        {!authLoading && !authError && !user && <p className="status-banner">Sign in to confirm. Your draft stays here while you sign in in another tab. <Link href="/auth" target="_blank" rel="noopener noreferrer">Open sign-in ↗</Link> <button className="text-button" type="button" onClick={refreshSession}>I signed in — check again</button></p>}
        {feedback && <p className="status-banner" role="alert">{feedback}</p>}
        {existing && <p><Link href={`/rooms/${existing.roomId}`}>Review or revise existing forecast ↗</Link></p>}
        {uncertain && <button type="button" className="button button-secondary" disabled={busy} onClick={() => reconcile(unresolved.current ?? draft)}>{busy ? 'Checking Activity…' : 'Check Activity before retrying'}</button>}
        {reconciled && <p className="small muted">If Activity still shows no forecast, you may retry explicitly. A delayed original request could still finish.</p>}
        <div className="swipe-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={cancel}>Cancel</button><button type="submit" className="button" disabled={busy || authLoading || !!authError || !user || locked || uncertain || !!existing}>{busy ? 'Checking / saving…' : reconciled ? 'Retry free forecast ↗' : 'Confirm free forecast ↗'}</button></div>
      </form>
    </section>;
  }

  if (!market) return <div className="status-card swipe-end" tabIndex={-1} ref={endFocus} role="status"><p className="eyebrow">{loadingMore ? 'LOADING THE NEXT PAGE' : hasMore ? 'MORE QUESTIONS TO LOAD' : incomplete ? 'END OF AVAILABLE CARDS / PARTIAL VENUE' : 'END OF LOADED DECK'}</p><h2>{loadingMore ? 'Finding more questions…' : hasMore || incomplete ? 'More questions may be available.' : 'You have seen every loaded question.'}</h2>{incomplete && <p>Some category sources did not respond. This is not a complete venue catalog; retry to discover the missing questions.</p>}{pageError && <p role="alert">Could not load the next venue page: {pageError}</p>}{hasMore && <button className="button button-secondary" type="button" disabled={loadingMore || stale} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Try loading more ↗'}</button>}{!hasMore && <button className="button button-secondary" type="button" onClick={onRefresh}>Retry venue ↗</button>}</div>;
  const eligible = canForecast(market, stale);
  const observedAt = Date.parse(market.observedAt);
  const aged = stale || market.source === 'STALE_LIMITLESS' || !Number.isFinite(observedAt) || Date.now() - observedAt > 120_000;
  return <section className="swipe-deck" aria-label="Swipe discovery">
    <p className="swipe-progress mono">{String(index + 1).padStart(2, '0')} / {markets.length} LOADED{hasMore ? ' · MORE AVAILABLE' : ''}</p>
    <article className="swipe-card" style={{ transform: dragOffset ? `translateX(${dragOffset}px) rotate(${dragOffset / 30}deg)` : undefined, transition: pointer.current ? 'none' : undefined }} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}>
      <div className="swipe-card-top"><span className="eyebrow">◇ {market.category?.toUpperCase() || 'MARKET'} / LIMITLESS</span><span className={`source-pill ${eligible ? 'live' : ''}`}>{eligible ? 'LIVE SNAPSHOT' : aged ? 'STALE SNAPSHOT' : market.status === 'open' ? 'NOT AVAILABLE' : market.status.toUpperCase()}</span></div>
      <h2 ref={heading} tabIndex={-1}>{market.question}</h2>
      <p className="small muted">Choose an outcome to open a free-forecast form. Drag right for {market.outcomeLabels[0]}, left for {market.outcomeLabels[1]}, or use the buttons. Neither a drag nor a tap places an order.</p>
      <dl className="swipe-facts"><div><dt>Closes</dt><dd>{formatDate(market.deadline)}</dd></div><div><dt>Resolution source</dt><dd>{market.resolutionSource || 'Not specified by venue'}</dd></div><div><dt>Observed</dt><dd>{formatDate(market.observedAt)}</dd></div></dl>
      <div className="swipe-card-links"><Link href={`/markets/${encodeURIComponent(market.slug)}`}>Question details ↗</Link><button type="button" className="text-button" onClick={() => setRevealed(value => !value)} aria-expanded={revealed} aria-controls="swipe-odds">{revealed ? 'Hide venue odds' : 'Reveal venue odds'}</button></div>
      {revealed && <div id="swipe-odds" className="swipe-odds"><p className="meta-label">{market.priceLabel} · observation only, not executable</p><div><span>{market.outcomeLabels[0]} <strong>{formatProbability(market.midpointYes)}</strong></span><span>{market.outcomeLabels[1]} <strong>{formatProbability(market.midpointYes === null ? null : 1 - market.midpointYes)}</strong></span></div></div>}
      {!eligible && <p className="status-banner" role="status">{aged ? 'Venue snapshot is stale; refresh before forecasting.' : 'This question is closed, expired, or has an unsupported outcome mapping. You can read details or skip it.'} <button type="button" className="text-button" onClick={onRefresh}>Refresh venue</button></p>}
    </article>
    <div className="swipe-actions"><button ref={secondButton} className="button button-secondary" type="button" disabled={!eligible} onClick={() => select(1)}>← {market.outcomeLabels[1]}</button><button className="button button-secondary swipe-skip" type="button" onClick={advance}>Skip ↗</button><button ref={firstButton} className="button" type="button" disabled={!eligible} onClick={() => select(0)}>{market.outcomeLabels[0]} →</button></div>
    <p className="small muted swipe-hint">Swipe is optional. Scroll vertically as usual; selecting only opens the confirmation form.</p>
  </section>;
}
