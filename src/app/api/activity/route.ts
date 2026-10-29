import { NextRequest } from 'next/server';
import { getActivity } from '@/lib/server/domain';
import { failure, reconcileForRead, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const user = requireUser(request);
    await reconcileForRead(user.id);
    return response(getActivity(user.id));
  } catch (error) { return failure(error); }
}
