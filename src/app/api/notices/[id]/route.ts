import { NextRequest } from 'next/server';
import { markNoticeRead } from '@/lib/server/domain';
import { assertInput } from '@/lib/server/errors';
import { failure, input, positiveId, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request);
    const body = await input(request);
    assertInput(body.read === true, 'read must be true');
    return response({ notice: markNoticeRead(user.id, positiveId((await params).id)) });
  } catch (error) { return failure(error); }
}
