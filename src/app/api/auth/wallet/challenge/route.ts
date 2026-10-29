import { NextRequest } from 'next/server';
import { createWalletChallenge } from '@/lib/server/wallet-auth';
import { failure, input, response } from '@/lib/server/http';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const body = await input(request);
    const origin = request.headers.get('origin') ?? `${request.nextUrl.protocol}//${request.headers.get('host') ?? request.nextUrl.host}`;
    return response({ message: createWalletChallenge(body.address as string, origin) });
  } catch (error) { return failure(error); }
}
