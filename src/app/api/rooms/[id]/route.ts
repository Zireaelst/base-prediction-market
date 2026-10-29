import { NextRequest } from 'next/server';
import { getRoom } from '@/lib/server/domain';
import { currentUser, failure, positiveId, reconcileForRead, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = positiveId((await params).id);
    const user = currentUser(request);
    getRoom(id, user?.id ?? null); // Authorize before requesting any room-linked market data.
    await reconcileForRead(user?.id ?? null, id);
    return response(getRoom(id, user?.id ?? null));
  } catch (error) { return failure(error); }
}
