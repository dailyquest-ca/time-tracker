import { runSync } from '@/lib/sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/sync] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/sync] Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[cron/sync] Starting scheduled sync...');
  const start = Date.now();
  const result = await runSync();
  const elapsed = Date.now() - start;

  if (!result.ok) {
    console.error(`[cron/sync] Failed in ${elapsed}ms: ${result.error}`);
    return NextResponse.json(
      { ok: false, error: result.error, elapsedMs: elapsed },
      { status: 500 }
    );
  }

  console.log(
    `[cron/sync] Completed in ${elapsed}ms — ${result.segmentsProcessed} segment(s) processed`
  );
  return NextResponse.json({
    ok: true,
    segmentsProcessed: result.segmentsProcessed,
    elapsedMs: elapsed,
  });
}
