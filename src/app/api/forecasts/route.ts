import { NextRequest } from 'next/server';
import { addForecastToDestination } from '@/lib/server/domain';
import { assertInput, DomainError } from '@/lib/server/errors';
import { failure, input, requireUser, response } from '@/lib/server/http';
import { getMarket } from '@/lib/server/venue';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = requireUser(request);
    const body = await input(request);
    assertInput(typeof body.marketSlug === 'string', 'Market slug is required');
    assertInput(typeof body.outcomeId === 'string', 'Outcome is required');
    assertInput(typeof body.selectedProbability === 'number', 'Selected outcome probability is required');
    assertInput(typeof body.rationale === 'string', 'Rationale is required');
    assertInput(body.destination === 'personal' || typeof body.destination === 'number' && Number.isSafeInteger(body.destination) && body.destination > 0, 'Valid forecast destination required');
    assertInput(typeof body.termsVersion === 'string' && /^[0-9a-f]{24}$/.test(body.termsVersion), 'Displayed venue terms version is required');
    const market = await getMarket(body.marketSlug, { force: true });
    if (market.termsVersion !== body.termsVersion) throw new DomainError('Venue resolution terms changed. Refresh the market and confirm your forecast again.', 409);
    return response({ forecast: addForecastToDestination(user.id, body.destination, market, body.outcomeId, body.selectedProbability, body.rationale) }, 201);
  } catch (error) { return failure(error); }
}
