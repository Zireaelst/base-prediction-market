import { NextRequest } from 'next/server';
import { joinRoom } from '@/lib/server/domain';
import { failure, positiveId, requireSameOrigin, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const user = requireUser(request);
    return response({ room: joinRoom(positiveId((await params).id), user.id) });
  } catch (error) { return failure(error); }
}
