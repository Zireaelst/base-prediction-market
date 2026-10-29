import { NextRequest } from 'next/server';
import { verifyWalletChallenge, walletSessionSeconds } from '@/lib/server/wallet-auth';
import { failure, input, issueCookie, response } from '@/lib/server/http';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const body = await input(request);
    const origin = request.headers.get('origin') ?? `${request.nextUrl.protocol}//${request.headers.get('host') ?? request.nextUrl.host}`;
    const { user, token } = await verifyWalletChallenge(body.message as string, body.signature as string, origin);
    return issueCookie(response({ user }), token, walletSessionSeconds);
  } catch (error) { return failure(error); }
}
