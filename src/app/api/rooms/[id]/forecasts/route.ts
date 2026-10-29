import { NextRequest } from 'next/server';
import { addForecast, getRoom } from '@/lib/server/domain';
import { getMarket } from '@/lib/server/venue';
import { assertInput } from '@/lib/server/errors';
import { failure, input, positiveId, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request);
    const id = positiveId((await params).id);
    getRoom(id, user.id);
    const body = await input(request);
    assertInput(typeof body.marketSlug === 'string', 'Market slug is required');
    const market = await getMarket(body.marketSlug, { force: true });
    return response({ forecast: addForecast(user.id, id, market, body.outcomeId as string, body.probability as number, body.rationale as string) }, 201);
  } catch (error) { return failure(error); }
}
