import { NextRequest } from 'next/server';
import { getMarket } from '@/lib/server/venue';
import { failure, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try { return response(await getMarket((await params).slug)); }
  catch (error) { return failure(error); }
}
