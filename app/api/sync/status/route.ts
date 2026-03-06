import { getLastSyncedAt } from '@/lib/google-calendar-sync';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const lastSyncedAt = await getLastSyncedAt();
  return NextResponse.json({ lastSyncedAt });
}
