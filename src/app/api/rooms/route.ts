import { NextRequest } from 'next/server';
import { createRoom, listRooms } from '@/lib/server/domain';
import { currentUser, failure, input, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return response({ rooms: listRooms(currentUser(request)?.id ?? null) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = requireUser(request);
    const body = await input(request);
    return response({ room: createRoom(user.id, body.name as string, body.description as string, body.private as boolean) }, 201);
  } catch (error) { return failure(error); }
}
