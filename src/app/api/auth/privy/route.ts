import { NextRequest } from 'next/server';
import { currentUser, failure, issueCookie, requireSameOrigin, response } from '@/lib/server/http';
import { DomainError } from '@/lib/server/errors';
import { privySessionSeconds, signInWithPrivy } from '@/lib/server/privy-auth';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    if (currentUser(request)) throw new DomainError('Sign out before switching accounts', 409);
    const authorization = request.headers.get('authorization');
    const accessToken = authorization?.match(/^Bearer (\S+)$/)?.[1];
    const { user, token } = await signInWithPrivy(accessToken);
    return issueCookie(response({ user }), token, privySessionSeconds);
  } catch (error) { return failure(error); }
}
