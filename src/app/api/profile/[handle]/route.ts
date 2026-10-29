import { NextRequest } from 'next/server';
import { getProfile } from '@/lib/server/domain';
import { currentUser, failure, reconcileForRead, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  try {
    const viewer = currentUser(request);
    const handle = (await params).handle;
    const profile = getProfile(handle, viewer?.id ?? null);
    await reconcileForRead(profile.user.id);
    return response(getProfile(handle, viewer?.id ?? null));
  } catch (error) { return failure(error); }
}
