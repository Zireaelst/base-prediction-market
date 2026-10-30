'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Forecast, Room } from '@/lib/contracts';
import { api, invalidate, useResource, useSession } from './api';
import { useCatalogPages } from './catalog-pages';
import { formatDate, formatProbability } from './display';
import { ActionForm, AuthGate, Field, FormFeedback, InlineStatus, SectionHead } from './ui';
import { RoomInvite } from './room-invite';

export function RoomsScreen() {
  const resource = useResource<{ rooms: Room[] }>('/api/rooms');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = await api<{ room: Room }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim(), private: isPrivate }) });
      invalidate('/api/rooms'); window.location.assign(`/rooms/${result.room.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create room.'); setBusy(false); }
  }
  return <div className="page-wrap"><SectionHead eyebrow="02 / ROOMS" title="Think better together." description="Small spaces for opinions with reasons. Public rooms are open to explore; private rooms stay with their members." action={<button className="button" type="button" onClick={() => setCreating(value => !value)} aria-expanded={creating} aria-controls="create-room">{creating ? 'Close form' : 'Create a room ↗'}</button>}/>{creating && <div id="create-room" className="form-panel"><AuthGate message="Sign in to create a room and invite a thoughtful conversation."><h2>A space of your own.</h2><ActionForm onSubmit={create} submitLabel="Create room ↗" busy={busy}><Field name="name" label="Room name" required value={name} onChange={setName} placeholder="What are we thinking about?"/><label className="field"><span>Description</span><textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} placeholder="What belongs in this room?"/></label><label className="checkbox-field"><input type="checkbox" checked={isPrivate} onChange={event => setIsPrivate(event.target.checked)}/><span>Private room <small>Only members can read or post here.</small></span></label><FormFeedback message={error}/></ActionForm></AuthGate></div>}<div className="results-line"><span>ROOM DIRECTORY</span><span>PUBLIC + YOUR PRIVATE ROOMS</span></div><InlineStatus loading={resource.loading} error={resource.error} stale={resource.stale} retry={resource.reload} empty={!resource.data?.rooms.length && !resource.loading ? 'No rooms available yet. Start the first conversation.' : undefined}><div className="room-grid">{resource.data?.rooms.map((room, index) => <Link className="room-card" href={`/rooms/${room.id}`} key={room.id}><div className="room-card-top"><span className="mono muted">{String(index + 1).padStart(2, '0')} / ROOM</span><span className="source-pill">{room.private ? 'PRIVATE' : 'PUBLIC'}</span></div><h2>{room.name}</h2><p>{room.description || 'A space for thoughtful forecasts.'}</p><div className="room-card-bottom"><span>{room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}{room.role ? ` · ${room.role}` : ''}</span><span aria-hidden="true">↗</span></div></Link>)}</div></InlineStatus></div>;
}

export function RoomScreen({ id }: { id: string }) {
  const roomPath = `/api/rooms/${encodeURIComponent(id)}`;
  const resource = useResource<{ room: Room; forecasts: Forecast[] }>(roomPath);
  const { catalog, markets: loadedMarkets, hasMore, loadMore, loadingMore, pageError } = useCatalogPages();
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');
  const [marketSlug, setMarketSlug] = useState('');
  const [probability, setProbability] = useState('50');
  const [rationale, setRationale] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [revisionProbability, setRevisionProbability] = useState('50');
  const [revisionRationale, setRevisionRationale] = useState('');
  const room = resource.data?.room;
  const availableMarkets = loadedMarkets.filter(market => market.status === 'open' && market.source === 'LIVE_LIMITLESS');
  const selectedMarket = availableMarkets.find(market => market.slug === marketSlug) ?? availableMarkets[0];
  const selectedOutcome = selectedMarket?.outcomeIds.includes(outcome) ? outcome : selectedMarket?.outcomeIds[0] ?? '';
  async function join() {
    setBusy(true); setError(null);
    try { await api(`${roomPath}/join`, { method: 'POST' }); invalidate(roomPath, '/api/rooms'); resource.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not join the room.'); }
    finally { setBusy(false); }
  }
  async function forecast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedMarket || !room) return;
    setBusy(true); setError(null);
    try {
      await api('/api/forecasts', { method: 'POST', body: JSON.stringify({ marketSlug: selectedMarket.slug, outcomeId: selectedOutcome, selectedProbability: Number(probability) / 100, rationale: rationale.trim(), destination: room.kind === 'personal' ? 'personal' : room.id, termsVersion: selectedMarket.termsVersion }) });
      setRationale(''); invalidate(roomPath, '/api/activity'); resource.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not publish forecast.'); }
    finally { setBusy(false); }
  }
  async function revise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (editing === null) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/forecasts/${editing}`, { method: 'PATCH', body: JSON.stringify({ probability: Number(revisionProbability) / 100, rationale: revisionRationale.trim() }) });
      invalidate(roomPath, '/api/activity'); setEditing(null); resource.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not revise forecast.'); }
    finally { setBusy(false); }
  }
  return <div className="page-wrap"><Link href="/rooms" className="back-link">← All rooms</Link><InlineStatus loading={resource.loading} error={resource.error} stale={resource.stale} retry={resource.reload}>{room && <><SectionHead eyebrow={`ROOM / ${room.private ? 'PRIVATE' : 'PUBLIC'}`} title={room.name} description={room.description || 'A space for thoughtful forecasts.'} action={<span className="source-pill">{room.memberCount} {room.memberCount === 1 ? 'MEMBER' : 'MEMBERS'}</span>}/><>{room.role === 'owner' && room.kind !== 'personal' && <RoomInvite path={roomPath} onInvite={resource.reload} />}<div className="room-layout"><div className="room-feed"><div className="feed-heading"><p className="eyebrow">THE CONVERSATION</p><h2>Forecasts with reasons.</h2></div>{!resource.data?.forecasts.length ? <div className="status-card">No forecasts yet. Start with a probability and why you believe it.</div> : <div className="forecast-list">{resource.data.forecasts.map(item => {  const owned = user?.id === item.userId; const locked = Date.now() >= new Date(item.lockAt).valueOf(); return <article className="forecast-card" key={item.id}><div className="forecast-head"><Link href={`/profile/${encodeURIComponent(item.handle)}`}>@{item.handle}</Link><span className="mono muted"><time dateTime={item.revisedAt}>{formatDate(item.revisedAt)}</time></span></div><Link href={`/markets/${encodeURIComponent(item.marketSlug)}`} className="forecast-market">{item.marketQuestion || item.marketSlug} ↗</Link><div className="forecast-value"><strong>{formatProbability(item.selectedOutcomeLabel && item.firstOutcomeLabel && item.selectedOutcomeLabel !== item.firstOutcomeLabel ? 1 - item.probability : item.probability)}</strong><span>Chance of {item.selectedOutcomeLabel ?? item.firstOutcomeLabel ?? 'first outcome'} · scoring baseline: {formatProbability(item.probability)} for {item.firstOutcomeLabel ?? 'first outcome'}</span></div><p className="forecast-rationale">{item.rationale}</p><div className="forecast-foot"><span>{item.score === null ? 'Not scored' : item.scoreState === 'last-known' ? `Last confirmed score ${item.score.toFixed(3)} · latest venue result ambiguous` : `Score ${item.score.toFixed(3)}${item.scoreVersion ? ` · ${item.scoreVersion}` : ''}`}</span><span>{item.revisions.length} {item.revisions.length === 1 ? 'revision' : 'revisions'}</span>{owned && !locked && room.role && <button className="text-button" type="button" onClick={() => { setEditing(item.id); setRevisionProbability(String(item.probability * 100)); setRevisionRationale(item.rationale); setError(null); }}>Revise ↗</button>}</div>{item.revisions.length > 0 && <><details className="revision-history"><summary>Revision history</summary><ol>{item.revisions.map((revision, index) => <li key={`${revision.at}-${index}`}>{formatDate(revision.at)} · {formatProbability(revision.probability)} · {revision.rationale}</li>)}</ol></details>{item.scoreHistory.length > 0 && <details className="revision-history"><summary>Resolution and score history</summary><ol>{item.scoreHistory.map(entry => <li key={entry.version}>{formatDate(entry.correctedAt)} · venue outcome {entry.outcomeId} · {entry.score === null ? 'Unscored (ambiguous)' : `score ${entry.score.toFixed(3)}`} · version {entry.version}</li>)}</ol></details>}</>}{editing === item.id && <form className="form-stack revision-form" onSubmit={revise}><Field label={`Revised chance of ${item.firstOutcomeLabel ?? 'first outcome'} (%)`} name="probability" type="number" min={0} max={100} step="0.1" required value={revisionProbability} onChange={setRevisionProbability}/><label className="field"><span>Updated reasoning</span><textarea required rows={3} value={revisionRationale} onChange={event => setRevisionRationale(event.target.value)}/></label><FormFeedback message={error}/><div className="inline-actions"><button className="button button-small" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save revision'}</button><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancel</button></div></form>}</article>; })}</div>}</div><aside className="room-compose"><p className="eyebrow">YOUR TURN / 01</p><h2>Make your call.</h2>{!room.role ? <AuthGate message="Sign in to join this room and share a forecast."><p className="muted">Join this room to share a forecast and see how your thinking evolves.</p><button className="button" type="button" disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Join room ↗'}</button><FormFeedback message={error}/></AuthGate> : <><p className="small muted">A probability and a reason, not an order. Forecasts lock when their market closes.</p><InlineStatus loading={catalog.loading} error={catalog.error || (catalog.data?.source === 'LIVE_LIMITLESS' ? null : catalog.data?.error) || null} stale={(catalog.stale || catalog.data?.source === 'STALE_LIMITLESS')} retry={catalog.reload} empty={!availableMarkets.length && !catalog.loading ? 'No open live venue questions available for a new forecast. Check again later.' : undefined}><><form className="form-stack" onSubmit={forecast}><label className="field"><span>Question</span><select value={selectedMarket?.slug ?? ''} onChange={event => { setMarketSlug(event.target.value); setOutcome(''); }} required>{availableMarkets.map(market => <option key={market.slug} value={market.slug}>{market.question}</option>)}</select></label><label className="field"><span>Outcome</span><select value={selectedOutcome} onChange={event => setOutcome(event.target.value)} required>{selectedMarket?.outcomeIds.map((id, index) => <option key={id} value={id}>{selectedMarket.outcomeLabels[index]}</option>)}</select></label><><Field label={`Chance of ${selectedMarket?.outcomeLabels[selectedMarket.outcomeIds.indexOf(selectedOutcome)] ?? 'selected outcome'} (%)`} name="probability" type="number" min={0} max={100} step="0.1" required value={probability} onChange={setProbability}/><p className="small muted">This free estimate applies to the outcome you selected; it is not an order.</p></><label className="field"><span>Why do you think so?</span><textarea required rows={4} value={rationale} onChange={event => setRationale(event.target.value)} placeholder="Make your reasoning legible."/></label><FormFeedback message={error}/><button className="button button-primary" type="submit" disabled={busy || !selectedMarket}>{busy ? 'Publishing…' : 'Post forecast ↗'}</button></form>{hasMore && <button className="button button-secondary" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading more…' : 'Load more questions'}</button>}{pageError && <p role="alert" className="small muted">{pageError} <button className="text-button" type="button" onClick={loadMore}>Retry</button></p>}</></InlineStatus></>}</aside></div></></>}</InlineStatus></div>;
}
