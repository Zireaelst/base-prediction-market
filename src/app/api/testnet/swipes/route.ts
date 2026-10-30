import { NextRequest } from 'next/server';
import { sessionCookie } from '@/lib/server/auth';
import { DomainError } from '@/lib/server/errors';
import { input, response } from '@/lib/server/http';
import { relaySwipe } from '@/lib/server/testnet-relay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await input(request);
    return response(await relaySwipe(body, request.cookies.get(sessionCookie)?.value));
  } catch (error) {
    if (error instanceof DomainError) return response({ error: error.message }, error.status);
    return response({ error: 'Testnet relay is unavailable or submission is unresolved' }, 503);
  }
}
