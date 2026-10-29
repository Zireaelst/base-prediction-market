import { NextRequest } from 'next/server';
import { inviteToRoom } from '@/lib/server/domain';
import { failure, input, positiveId, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = requireUser(request);
    const body = await input(request);
    return response({ room: inviteToRoom(positiveId((await params).id), owner.id, body.handle as string) });
  } catch (error) { return failure(error); }
}
