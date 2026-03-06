import { getWatchStatus } from '@/lib/google-calendar-sync';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const watchStatus = await getWatchStatus();
  return NextResponse.json(watchStatus);
}
