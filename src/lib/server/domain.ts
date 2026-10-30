import { createHash } from 'node:crypto';
import { database } from './db';
import { assertInput, DomainError } from './errors';
import { isFreshMarket, legacyTermsVersion } from './venue';
import type { Forecast, Market, Notice, PaperOrder, Room, User } from '../contracts';

type Row = Record<string, any>;
const db = database;
const now = () => new Date().toISOString();
const get = (query: string, ...values: unknown[]): Row | undefined => db().prepare(query).get(...values) as Row | undefined;
const all = (query: string, ...values: unknown[]): Row[] => db().prepare(query).all(...values) as Row[];
const run = (query: string, ...values: unknown[]) => db().prepare(query).run(...values);

function roomValue(row: Row, userId: number | null): Room {
  return { id: row.id, name: row.name, description: row.description, ownerId: row.owner_id, private: !!row.private, kind: row.kind, memberCount: row.member_count, role: userId === row.owner_id ? 'owner' : row.is_member ? 'member' : null };
}
function roomRow(id: number, userId: number | null): Row | undefined {
  return get('SELECT r.*, (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count, EXISTS(SELECT 1 FROM room_members WHERE room_id = r.id AND user_id = ?) AS is_member FROM rooms r WHERE r.id = ?', userId, id);
}
function visibleRoom(id: number, userId: number | null): Row {
  const row = roomRow(id, userId);
  if (!row || row.kind === 'personal' && row.owner_id !== userId || row.private && !row.is_member) throw new DomainError('Room not found', 404);
  return row;
}
export function listRooms(userId: number | null): Room[] {
  return all("SELECT r.*, (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count, EXISTS(SELECT 1 FROM room_members WHERE room_id = r.id AND user_id = ?) AS is_member FROM rooms r WHERE r.kind = 'shared' AND (r.private = 0 OR EXISTS(SELECT 1 FROM room_members WHERE room_id = r.id AND user_id = ?)) ORDER BY r.id DESC", userId, userId).map(row => roomValue(row, userId));
}
export function createRoom(userId: number, name: string, description: string, privateRoom: boolean): Room {
  assertInput(typeof name === 'string' && name.trim().length >= 2 && name.length <= 100, 'Room name must be 2–100 characters');
  assertInput(typeof description === 'string' && description.length <= 2000, 'Description must be at most 2000 characters');
  assertInput(typeof privateRoom === 'boolean', 'Room privacy must be specified');
  return db().transaction(() => {
    const id = Number(run('INSERT INTO rooms (name, description, owner_id, private, created_at) VALUES (?, ?, ?, ?, ?)', name.trim(), description.trim(), userId, Number(privateRoom), now()).lastInsertRowid);
    run('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', id, userId);
    return roomValue(roomRow(id, userId)!, userId);
  })();
}
export function ensurePersonalRoom(userId: number): Room {
  return db().transaction(() => {
    const existing = get("SELECT id FROM rooms WHERE kind = 'personal' AND owner_id = ?", userId);
    if (existing) return roomValue(roomRow(existing.id, userId)!, userId);
    const id = Number(run("INSERT INTO rooms (name, description, owner_id, private, kind, created_at) VALUES (?, ?, ?, 1, 'personal', ?)", 'My forecasts', 'Private forecasting practice.', userId, now()).lastInsertRowid);
    run('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', id, userId);
    return roomValue(roomRow(id, userId)!, userId);
  }).immediate();
}
export function joinRoom(id: number, userId: number): Room {
  return db().transaction(() => {
    const room = roomRow(id, userId);
    if (!room || room.kind === 'personal' || room.private && !room.is_member) throw new DomainError('Room not found; private rooms require an existing membership', 404);
    run('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', id, userId);
    return roomValue(roomRow(id, userId)!, userId);
  })();
}
export function inviteToRoom(id: number, ownerId: number, handle: string): Room {
  assertInput(typeof handle === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(handle), 'Valid member handle required');
  return db().transaction(() => {
    const room = roomRow(id, ownerId);
    if (!room || room.kind === 'personal' || room.owner_id !== ownerId) throw new DomainError('Only a shared room owner can invite members', 403);
    const member = get('SELECT id FROM users WHERE handle = ?', handle);
    if (!member) throw new DomainError('User not found', 404);
    run('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', id, member.id);
    return roomValue(roomRow(id, ownerId)!, ownerId);
  })();
}
function cachedMarket(slug: string): Market | null {
  const row = get('SELECT payload FROM venue_cache WHERE cache_key = ?', `market:${slug}`);
  if (!row) return null;
  try { return JSON.parse(row.payload) as Market; }
  catch { return null; }
}
function resolutionState(marketId: string): 'confirmed' | 'last-known' | 'pending' {
  const row = get('SELECT state FROM market_resolutions WHERE market_id = ?', marketId);
  return row?.state === 'ambiguous' ? 'last-known' : row ? 'confirmed' : 'pending';
}
function forecastValue(row: Row): Forecast {
  const revisions = all('SELECT probability, rationale, at FROM forecast_revisions WHERE forecast_id = ? ORDER BY id', row.id);
  const scores = all('SELECT outcome_id, score, version, corrected_at FROM score_history WHERE forecast_id = ? ORDER BY id', row.id);
  type SavedTerms = Pick<Market, 'venueMarketId' | 'question' | 'description' | 'resolutionSource' | 'deadline' | 'outcomeIds' | 'outcomeLabels' | 'termsVersion'>;
  let saved: SavedTerms | null = null;
  if (row.market_snapshot) {
    try {
      const parsed = JSON.parse(row.market_snapshot) as SavedTerms;
      if (parsed.venueMarketId === row.market_id && parsed.termsVersion === row.terms_version && Array.isArray(parsed.outcomeIds) && Array.isArray(parsed.outcomeLabels)) saved = parsed;
    } catch { /* A damaged historical snapshot must not invent venue outcome labels. */ }
  }
  const cached = saved ? null : cachedMarket(row.market_slug);
  const snapshot = saved ?? (cached && cached.venueMarketId === row.market_id && cached.termsVersion === row.terms_version ? cached : null);
  const selectedOutcomeLabel = snapshot && snapshot.outcomeIds[0] === row.outcome_id ? snapshot.outcomeLabels[0] : snapshot && snapshot.outcomeIds[1] === row.outcome_id ? snapshot.outcomeLabels[1] : undefined;
  return { id: row.id, userId: row.user_id, handle: row.handle, roomId: row.room_id, destinationKind: row.destination_kind, marketId: row.market_id, marketSlug: row.market_slug, marketQuestion: snapshot?.question ?? cached?.question, firstOutcomeLabel: snapshot?.outcomeLabels[0], selectedOutcomeLabel, termsAtEntry: snapshot?.description, resolutionSourceAtEntry: snapshot?.resolutionSource, deadlineAtEntry: snapshot?.deadline, outcomeId: row.outcome_id, probability: row.probability, rationale: row.rationale, createdAt: row.created_at, revisedAt: row.revised_at, lockAt: row.lock_at, revisions: revisions.map(r => ({ probability: r.probability, rationale: r.rationale, at: r.at })), score: row.score, scoreVersion: row.score_version, scoreState: resolutionState(row.market_id), scoreHistory: scores.map(s => ({ outcomeId: s.outcome_id, score: s.score, version: s.version, correctedAt: s.corrected_at })) };
}
const forecastJoin = 'SELECT f.*, u.handle, r.kind AS destination_kind FROM forecasts f JOIN users u ON u.id = f.user_id JOIN rooms r ON r.id = f.room_id';
export function getRoom(id: number, userId: number | null): { room: Room; forecasts: Forecast[] } {
  const room = visibleRoom(id, userId);
  return { room: roomValue(room, userId), forecasts: all(`${forecastJoin} WHERE f.room_id = ? ORDER BY f.id DESC`, id).map(forecastValue) };
}
export function addForecast(userId: number, roomId: number, market: Market, outcomeId: string, probability: number, rationale: string): Forecast {
  assertInput(Number.isFinite(probability) && probability >= 0 && probability <= 1, 'Probability must be between 0 and 1');
  assertInput(typeof rationale === 'string' && rationale.trim().length > 0 && rationale.length <= 4000, 'Rationale must be 1–4000 characters');
  return db().transaction(() => {
    const room = visibleRoom(roomId, userId);
    if (!room.is_member) throw new DomainError('Join this room before forecasting', 403);
    if (market.source !== 'LIVE_LIMITLESS' || market.status !== 'open' || !isFreshMarket(market)) throw new DomainError('Fresh open market data is required', 409);
    if (market.venueId !== 'limitless' || !market.outcomeIds.includes(outcomeId)) throw new DomainError('Outcome does not belong to this market', 400);
    const lockAt = room.lock_at && Date.parse(room.lock_at) < Date.parse(market.deadline) ? room.lock_at : market.deadline;
    const timestamp = now();
    if (Date.parse(lockAt) <= Date.now()) throw new DomainError('Forecast is locked', 409);
    let id: number;
    try {
      const terms = JSON.stringify({ venueMarketId: market.venueMarketId, question: market.question, description: market.description, resolutionSource: market.resolutionSource, deadline: market.deadline, outcomeIds: market.outcomeIds, outcomeLabels: market.outcomeLabels, termsVersion: market.termsVersion });
      id = Number(run('INSERT INTO forecasts (user_id, room_id, market_id, market_slug, outcome_id, terms_version, market_snapshot, probability, rationale, created_at, revised_at, lock_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', userId, roomId, market.venueMarketId, market.slug, outcomeId, market.termsVersion, terms, probability, rationale.trim(), timestamp, timestamp, lockAt).lastInsertRowid);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) throw new DomainError('You have already forecast this market in this room; revise instead', 409);
      throw error;
    }
    run('INSERT INTO forecast_revisions (forecast_id, probability, rationale, at) VALUES (?, ?, ?, ?)', id, probability, rationale.trim(), timestamp);
    return forecastValue(get(`${forecastJoin} WHERE f.id = ?`, id)!);
  })();
}
export function addForecastToDestination(userId: number, destination: 'personal' | number, market: Market, outcomeId: string, selectedProbability: number, rationale: string): Forecast {
  assertInput(Number.isFinite(selectedProbability) && selectedProbability >= 0 && selectedProbability <= 1, 'Selected outcome probability must be between 0 and 1');
  assertInput(market.outcomeIds.includes(outcomeId), 'Outcome does not belong to this market');
  assertInput(destination === 'personal' || Number.isSafeInteger(destination) && destination > 0, 'Valid forecast destination required');
  return db().transaction(() => {
    const roomId = destination === 'personal' ? ensurePersonalRoom(userId).id : destination;
    if (destination !== 'personal' && visibleRoom(roomId, userId).kind !== 'shared') throw new DomainError('Choose a shared room or your personal space', 403);
    const yesProbability = outcomeId === market.outcomeIds[0] ? selectedProbability : 1 - selectedProbability;
    return addForecast(userId, roomId, market, outcomeId, yesProbability, rationale);
  }).immediate();
}
export function forecastMarketSlug(userId: number, id: number): string {
  const row = get('SELECT room_id, market_slug FROM forecasts WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw new DomainError('Forecast not found', 404);
  visibleRoom(row.room_id, userId);
  return row.market_slug;
}
export function reviseForecast(userId: number, id: number, probability: number, rationale: string, market: Market): Forecast {
  assertInput(Number.isFinite(probability) && probability >= 0 && probability <= 1, 'Probability must be between 0 and 1');
  assertInput(typeof rationale === 'string' && rationale.trim().length > 0 && rationale.length <= 4000, 'Rationale must be 1–4000 characters');
  return db().transaction(() => {
    const row = get(`${forecastJoin} WHERE f.id = ? AND f.user_id = ?`, id, userId);
    if (!row) throw new DomainError('Forecast not found', 404);
    visibleRoom(row.room_id, userId);
    if (Date.parse(row.lock_at) <= Date.now() || row.score_version !== null) throw new DomainError('Forecast is locked', 409);
    if (market.source !== 'LIVE_LIMITLESS' || market.status !== 'open' || !isFreshMarket(market) || Date.parse(market.deadline) <= Date.now()) throw new DomainError('Fresh open venue data is required to revise a forecast', 409);
    const originalTermsMatch = row.terms_version === null || market.termsVersion === row.terms_version ||
      row.market_snapshot === null && row.terms_version === legacyTermsVersion(market);
    if (market.venueId !== 'limitless' || market.venueMarketId !== row.market_id || market.slug !== row.market_slug || !market.outcomeIds.includes(row.outcome_id) || !originalTermsMatch) throw new DomainError('Venue market identity changed; revision blocked', 409);
    const timestamp = now();
    run('UPDATE forecasts SET probability = ?, rationale = ?, revised_at = ? WHERE id = ?', probability, rationale.trim(), timestamp, id);
    run('INSERT INTO forecast_revisions (forecast_id, probability, rationale, at) VALUES (?, ?, ?, ?)', id, probability, rationale.trim(), timestamp);
    return forecastValue(get(`${forecastJoin} WHERE f.id = ?`, id)!);
  })();
}
export function placePaperOrder(userId: number, market: Market, outcomeId: string, stakeCents: number): PaperOrder {
  assertInput(Number.isSafeInteger(stakeCents) && stakeCents >= 100 && stakeCents <= 10_000_000 && stakeCents % 100 === 0, 'Stake must be 100–10,000,000 cents in whole 100-cent units');
  if (market.venueId !== 'limitless' || !market.outcomeIds.includes(outcomeId)) throw new DomainError('Outcome does not belong to this market', 400);
  if (market.source !== 'LIVE_LIMITLESS' || market.status !== 'open' || !isFreshMarket(market) || Date.parse(market.deadline) <= Date.now()) throw new DomainError('Fresh open venue data is required for a paper simulation', 409);
  const price = outcomeId === market.outcomeIds[0] ? market.midpointYes : market.midpointYes === null ? null : 1 - market.midpointYes;
  if (price === null || !Number.isFinite(price) || price <= 0 || price >= 1 || market.priceLabel !== 'Limitless CLOB midpoint (not executable quote)') throw new DomainError('Valid CLOB midpoint unavailable; cannot simulate a fill', 409);
  return db().transaction(() => {
    const id = Number(run('INSERT INTO paper_orders (user_id, market_id, market_slug, outcome_id, side, stake_cents, price, shares, state, created_at, observed_at, terms_version, settlement_cents, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', userId, market.venueMarketId, market.slug, outcomeId, outcomeId === market.outcomeIds[0] ? 'YES' : 'NO', stakeCents, price, stakeCents / 100 / price, 'filled', now(), market.observedAt, market.termsVersion, null, 'midpoint-v1').lastInsertRowid);
    return paperValue(get('SELECT * FROM paper_orders WHERE id = ?', id)!);
  })();
}
function paperValue(row: Row): PaperOrder {
  const settlements = all('SELECT settlement_cents, version, corrected_at FROM paper_settlement_history WHERE order_id = ? ORDER BY id', row.id);
  return { id: row.id, userId: row.user_id, marketId: row.market_id, marketSlug: row.market_slug, marketQuestion: cachedMarket(row.market_slug)?.question, outcomeId: row.outcome_id, side: row.side, stakeCents: row.stake_cents, price: row.price, shares: row.shares, state: row.state, createdAt: row.created_at, settlementCents: row.settlement_cents, settlementState: resolutionState(row.market_id), model: 'midpoint-v1', settlementHistory: settlements.map(s => ({ settlementCents: s.settlement_cents, version: s.version, correctedAt: s.corrected_at })) };
}
export function getPaperOrders(userId: number): PaperOrder[] {
  return all('SELECT * FROM paper_orders WHERE user_id = ? ORDER BY id DESC', userId).map(paperValue);
}

function markAmbiguousResolution(marketId: string): void {
  run("UPDATE market_resolutions SET state = 'ambiguous', observed_at = ? WHERE market_id = ? AND state <> 'ambiguous'", now(), marketId);
}
// This is a server-only read-side reconciliation routine; there is no settlement HTTP route.
export function reconcileMarket(market: Market): void {
  if (market.source !== 'LIVE_LIMITLESS' || market.status !== 'resolved' || market.venueId !== 'limitless') return;
  const [yes, no] = market.outcomeIds;
  const numerators = market.payoutNumerators ?? (market.winningOutcome === yes ? [1, 0] : market.winningOutcome === no ? [0, 1] : null);
  const total = numerators ? numerators[0] + numerators[1] : 0;
  const validPayout = numerators && numerators.every(n => Number.isFinite(n) && n >= 0) && total > 0;
  if (market.winningOutcome && validPayout && (market.winningOutcome === yes && numerators![1] > 0 || market.winningOutcome === no && numerators![0] > 0)) { markAmbiguousResolution(market.venueMarketId); return; }
  const winner = market.winningOutcome && [yes, no].includes(market.winningOutcome) ? market.winningOutcome : validPayout && numerators![0] > 0 && numerators![1] === 0 ? yes : validPayout && numerators![1] > 0 && numerators![0] === 0 ? no : null;
  if (!winner && !(numerators && validPayout && numerators[0] > 0 && numerators[1] > 0)) { markAmbiguousResolution(market.venueMarketId); return; }
  const version = createHash('sha256').update(`${market.venueMarketId}|${yes}|${no}|${winner ?? 'split'}|${JSON.stringify(numerators)}`).digest('hex').slice(0, 24);
  db().transaction(() => {
    const previous = get('SELECT * FROM market_resolutions WHERE market_id = ?', market.venueMarketId);
    if (previous?.version === version) {
      if (previous.state !== 'confirmed') run("UPDATE market_resolutions SET state = 'confirmed', observed_at = ? WHERE market_id = ?", now(), market.venueMarketId);
      return;
    }
    run("INSERT INTO market_resolutions (market_id, outcome_id, version, observed_at, state) VALUES (?, ?, ?, ?, 'confirmed') ON CONFLICT(market_id) DO UPDATE SET outcome_id = excluded.outcome_id, version = excluded.version, observed_at = excluded.observed_at, state = excluded.state", market.venueMarketId, winner ?? 'SPLIT', version, now());
    const forecasts = all('SELECT * FROM forecasts WHERE market_id = ?', market.venueMarketId);
    const orders = all('SELECT * FROM paper_orders WHERE market_id = ?', market.venueMarketId);
    if (forecasts.some(f => f.market_slug !== market.slug || !market.outcomeIds.includes(f.outcome_id)) || orders.some(o => o.market_slug !== market.slug || !market.outcomeIds.includes(o.outcome_id))) throw new DomainError('Venue market identity changed; reconciliation paused', 409);
    for (const forecast of forecasts) {
      const score = winner ? 100 * (1 - (forecast.probability - Number(winner === yes)) ** 2) : null;
      run('UPDATE forecasts SET score = ?, score_version = ? WHERE id = ?', score, version, forecast.id);
      run('INSERT INTO score_history (forecast_id, outcome_id, score, version, corrected_at) VALUES (?, ?, ?, ?, ?)', forecast.id, winner ?? 'SPLIT', score, version, now());
      if (previous && previous.version !== version) maybeNotice(forecast.user_id, 'score-correction', `A venue outcome correction changed your score for ${market.slug}.`);
      else maybeNotice(forecast.user_id, 'resolution', `Your forecast for ${market.slug} has resolved.`);
    }
    if (numerators && validPayout) {
      for (const order of orders) {
        const numerator = order.outcome_id === yes ? numerators[0] : order.outcome_id === no ? numerators[1] : 0;
        const cents = Math.round(order.shares * 100 * numerator / total);
        if (order.state !== 'settled' || order.settlement_cents !== cents) {
          run('UPDATE paper_orders SET state = ?, settlement_cents = ? WHERE id = ?', 'settled', cents, order.id);
          run('INSERT INTO paper_settlement_history (order_id, settlement_cents, version, corrected_at) VALUES (?, ?, ?, ?)', order.id, cents, version, now());
          maybeNotice(order.user_id, 'paper-settlement', `Simulated position for ${market.slug} ${order.state === 'settled' ? 'was corrected' : 'has settled'}.`);
        }
      }
    } else {
      for (const order of orders) {
        if (order.state !== 'filled' || order.settlement_cents !== null) {
          run('UPDATE paper_orders SET state = ?, settlement_cents = NULL WHERE id = ?', 'filled', order.id);
          run('INSERT INTO paper_settlement_history (order_id, settlement_cents, version, corrected_at) VALUES (?, NULL, ?, ?)', order.id, version, now());
        }
      }
    }
  })();
}
function maybeNotice(userId: number, kind: string, message: string): void {
  if (get('SELECT notifications FROM users WHERE id = ?', userId)?.notifications) run('INSERT INTO notices (user_id, kind, message, created_at) VALUES (?, ?, ?, ?)', userId, kind, message, now());
}
export function getActivity(userId: number): { forecasts: Forecast[]; orders: PaperOrder[]; notices: Notice[] } {
  return { forecasts: all(`${forecastJoin} WHERE f.user_id = ? AND (r.kind != 'personal' OR r.owner_id = ?) AND (r.private = 0 OR EXISTS(SELECT 1 FROM room_members WHERE room_id = r.id AND user_id = ?)) ORDER BY f.id DESC`, userId, userId, userId).map(forecastValue), orders: getPaperOrders(userId), notices: all('SELECT * FROM notices WHERE user_id = ? ORDER BY id DESC', userId).map(row => ({ id: row.id, userId: row.user_id, kind: row.kind, message: row.message, createdAt: row.created_at, readAt: row.read_at })) };
}
export function getProfile(handle: string, viewerId: number | null): { user: User; forecasts: Forecast[]; orders: PaperOrder[] } {
  const user = get('SELECT id, handle, created_at FROM users WHERE handle = ?', handle);
  if (!user) throw new DomainError('Profile not found', 404);
  const forecasts = all(`${forecastJoin} WHERE f.user_id = ? AND (r.kind != 'personal' OR r.owner_id = ?) AND (r.private = 0 OR EXISTS(SELECT 1 FROM room_members WHERE room_id = r.id AND user_id = ?)) ORDER BY f.id DESC`, user.id, viewerId, viewerId).map(forecastValue);
  return { user: { id: user.id, handle: user.handle, createdAt: user.created_at }, forecasts, orders: viewerId === user.id ? getPaperOrders(user.id) : [] };
}
export function getSettings(userId: number): { notifications: boolean } {
  return { notifications: !!get('SELECT notifications FROM users WHERE id = ?', userId)?.notifications };
}
export function setSettings(userId: number, notifications: boolean): { notifications: boolean } {
  assertInput(typeof notifications === 'boolean', 'notifications must be boolean');
  run('UPDATE users SET notifications = ? WHERE id = ?', Number(notifications), userId);
  return { notifications };
}
export function markNoticeRead(userId: number, id: number): Notice {
  const result = run('UPDATE notices SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND id = ?', now(), userId, id);
  if (!result.changes) throw new DomainError('Notice not found', 404);
  const row = get('SELECT * FROM notices WHERE id = ?', id)!;
  return { id: row.id, userId: row.user_id, kind: row.kind, message: row.message, createdAt: row.created_at, readAt: row.read_at };
}
export function pendingMarketSlugs(userId: number | null, roomId?: number): string[] {
  const forecasts = roomId === undefined ? userId === null ? [] : all('SELECT DISTINCT market_slug FROM forecasts WHERE user_id = ?', userId) : all('SELECT DISTINCT market_slug FROM forecasts WHERE room_id = ?', roomId);
  const orders = userId === null ? [] : all('SELECT DISTINCT market_slug FROM paper_orders WHERE user_id = ?', userId);
  return [...new Set([...forecasts, ...orders].map(row => row.market_slug))];
}
