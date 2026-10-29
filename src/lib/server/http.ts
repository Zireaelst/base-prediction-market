import { NextRequest, NextResponse } from 'next/server';
import { sessionCookie, sessionUser } from './auth';
import { DomainError } from './errors';
import { pendingMarketSlugs, reconcileMarket } from './domain';
import { getMarket } from './venue';
import type { User } from '../contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function response<T>(value: T, status = 200): NextResponse<T> {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function failure(error: unknown): NextResponse<{ error: string }> {
  if (error instanceof DomainError) return response({ error: error.message }, error.status);
  console.error('Internal API failure', error);
  return response({ error: 'An internal error occurred' }, 500);
}
export function currentUser(request: NextRequest): User | null {
  return sessionUser(request.cookies.get(sessionCookie)?.value);
}
export function requireUser(request: NextRequest): User {
  const user = currentUser(request);
  if (!user) throw new DomainError('Sign in to continue', 401);
  return user;
}
export function requireSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('host') ?? request.nextUrl.host;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new DomainError('Cross-origin mutation is not allowed', 403); }
  if (parsed.origin !== origin || parsed.host !== host || parsed.protocol !== request.nextUrl.protocol) throw new DomainError('Cross-origin mutation is not allowed', 403);
}
export async function input(request: NextRequest): Promise<Record<string, unknown>> {
  requireSameOrigin(request);
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* Return a consistent client error below. */ }
  throw new DomainError('A JSON object is required', 400);
}
export function positiveId(raw: string): number {
  const id = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id)) throw new DomainError('Invalid resource ID', 400);
  return id;
}
export function issueCookie(responseValue: NextResponse, token: string, maxAge = 30 * 24 * 60 * 60): NextResponse {
  responseValue.cookies.set(sessionCookie, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge });
  return responseValue;
}
export function clearCookie(responseValue: NextResponse): NextResponse {
  responseValue.cookies.set(sessionCookie, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  return responseValue;
}
const reconciliationCursor = new Map<string, number>();
export async function reconcileForRead(userId: number | null, roomId?: number): Promise<void> {
  const slugs = pendingMarketSlugs(userId, roomId);
  if (!slugs.length) return;
  // Bound foreground reconciliation: local history must remain readable during a venue outage.
  const key = `${userId ?? 'public'}:${roomId ?? 'activity'}`;
  const start = (reconciliationCursor.get(key) ?? 0) % slugs.length;
  const batch = Array.from({ length: Math.min(slugs.length, 6) }, (_, index) => slugs[(start + index) % slugs.length]);
  reconciliationCursor.set(key, (start + batch.length) % slugs.length);
  await Promise.allSettled(batch.map(async slug => {
    const signal = AbortSignal.timeout(700);
    try {
      const market = await getMarket(slug, { force: true, signal });
      if (!signal.aborted && market.source === 'LIVE_LIMITLESS') reconcileMarket(market);
    } catch { /* Local history remains available when venue reads fail. */ }
  }));
}
