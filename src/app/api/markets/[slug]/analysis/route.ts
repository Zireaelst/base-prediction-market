import { NextRequest } from 'next/server';
import { getMarket } from '@/lib/server/venue';
import { analyzeMarket } from '@/lib/server/market-analysis';
import { failure, requireSameOrigin, requireUser, response } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    requireSameOrigin(request);
    requireUser(request);
    const market = await getMarket((await params).slug, { force: true });
    return response({ ...(await analyzeMarket(market)), observedAt: market.observedAt, source: market.source });
  } catch (error) { return failure(error); }
}
