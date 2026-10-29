import { NextRequest } from 'next/server';
import { forecastMarketSlug, reviseForecast } from '@/lib/server/domain';
import { getMarket } from '@/lib/server/venue';
import { failure, input, positiveId, requireUser, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request);
    const body = await input(request);
    const id = positiveId((await params).id);
    const market = await getMarket(forecastMarketSlug(user.id, id), { force: true });
    return response({ forecast: reviseForecast(user.id, id, body.probability as number, body.rationale as string, market) });
  } catch (error) { return failure(error); }
}
