import { NextRequest } from 'next/server';
import { login } from '@/lib/server/auth';
import { failure, input, issueCookie, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const body = await input(request);
    const { user, token } = login(body.handle as string, body.password as string);
    return issueCookie(response({ user }), token);
  } catch (error) { return failure(error); }
}
