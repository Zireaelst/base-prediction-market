import { NextRequest } from 'next/server';
import { getCatalog } from '@/lib/server/venue';
import { failure, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get('page') || '1';
    if (!/^[1-9]\d{0,5}$/.test(raw)) return response({ error: 'Invalid catalog page' }, 400);
    const catalog = await getCatalog({ page: Number(raw) });
    return response(catalog, catalog.source === 'UNAVAILABLE' ? 503 : 200);
  } catch (error) { return failure(error); }
}
