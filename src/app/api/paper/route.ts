import { NextRequest } from 'next/server';
import { getPaperOrders, placePaperOrder } from '@/lib/server/domain';
import { getMarket } from '@/lib/server/venue';
import { assertInput } from '@/lib/server/errors';
import { failure, input, reconcileForRead, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const user = requireUser(request);
    await reconcileForRead(user.id);
    return response({ orders: getPaperOrders(user.id) });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = requireUser(request);
    const body = await input(request);
    assertInput(typeof body.marketSlug === 'string', 'Market slug is required');
    const market = await getMarket(body.marketSlug, { force: true });
    return response({ order: placePaperOrder(user.id, market, body.outcomeId as string, body.stakeCents as number) }, 201);
  } catch (error) { return failure(error); }
}
