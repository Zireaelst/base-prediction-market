import { NextRequest } from 'next/server';
import { getSettings, setSettings } from '@/lib/server/domain';
import { failure, input, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return response(getSettings(requireUser(request).id)); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest) {
  try {
    const user = requireUser(request);
    const body = await input(request);
    return response(setSettings(user.id, body.notifications as boolean));
  } catch (error) { return failure(error); }
}
