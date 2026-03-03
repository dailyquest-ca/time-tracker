import { runSync } from '@/lib/sync';
import { NextResponse } from 'next/server';

export async function POST() {
  const result = await runSync();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error?.includes('Not connected') ? 401 : 500 }
    );
  }
  return NextResponse.json({
    ok: true,
    segmentsProcessed: result.segmentsProcessed,
  });
}

export async function GET() {
  const result = await runSync();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.error?.includes('Not connected') ? 401 : 500 }
    );
  }
  return NextResponse.json({
    ok: true,
    segmentsProcessed: result.segmentsProcessed,
  });
}
