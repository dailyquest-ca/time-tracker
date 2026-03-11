import { getWatchStatus, forceRecreateWatch } from '@/lib/google-calendar-sync';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const watchStatus = await getWatchStatus();
  return NextResponse.json(watchStatus);
}

export async function POST() {
  const result = await forceRecreateWatch();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 },
    );
  }
  const watchStatus = await getWatchStatus();
  return NextResponse.json({ ok: true, watch: watchStatus });
}
