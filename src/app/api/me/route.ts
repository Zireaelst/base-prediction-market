import { NextRequest } from 'next/server';
import { currentUser, failure, response } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return response({ user: currentUser(request) }); }
  catch (error) { return failure(error); }
}
