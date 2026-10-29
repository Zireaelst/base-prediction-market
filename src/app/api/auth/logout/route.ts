import { NextRequest } from 'next/server';
import { logout, sessionCookie } from '@/lib/server/auth';
import { clearCookie, failure, requireSameOrigin, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    requireUser(request);
    logout(request.cookies.get(sessionCookie)?.value);
    return clearCookie(response({ ok: true }));
  } catch (error) { return failure(error); }
}
