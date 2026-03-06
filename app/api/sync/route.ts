import { runGoogleCalendarSync } from '@/lib/google-calendar-sync';
import { NextResponse } from 'next/server';

async function handleSync() {
  const result = await runGoogleCalendarSync();
  if (!result.ok) {
    const isAuth =
      result.error?.includes('Not connected') ||
      result.error?.includes('No work calendar');
    return NextResponse.json(
      { error: result.error },
      { status: isAuth ? 401 : 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    segmentsProcessed: result.segmentsProcessed,
    ...(result.watchError ? { watchError: result.watchError } : {}),
  });
}

export async function POST() {
  return handleSync();
}

export async function GET() {
  return handleSync();
}
