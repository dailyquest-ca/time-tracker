import { runGoogleCalendarSync } from '@/lib/google-calendar-sync';
import { NextResponse } from 'next/server';

export async function POST() {
  const result = await runGoogleCalendarSync();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      {
        status:
          result.error?.includes('Not connected') ||
          result.error?.includes('No work calendar')
            ? 401
            : 500,
      },
    );
  }
  return NextResponse.json({
    ok: true,
    segmentsProcessed: result.segmentsProcessed,
  });
}

export async function GET() {
  const result = await runGoogleCalendarSync();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      {
        status:
          result.error?.includes('Not connected') ||
          result.error?.includes('No work calendar')
            ? 401
            : 500,
      },
    );
  }
  return NextResponse.json({
    ok: true,
    segmentsProcessed: result.segmentsProcessed,
  });
}
