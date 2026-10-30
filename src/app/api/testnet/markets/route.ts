import { getTestnetMarkets } from '@/lib/server/testnet-chain';
import { DomainError } from '@/lib/server/errors';
import { response } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try { return response(await getTestnetMarkets()); }
  catch (error) {
    if (error instanceof DomainError) return response({ error: error.message }, error.status);
    return response({ error: 'Testnet market data is unavailable' }, 503);
  }
}
