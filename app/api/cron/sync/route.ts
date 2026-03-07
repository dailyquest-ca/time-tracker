import {
  renewCalendarWatchIfNeeded,
  runFullReconciliation,
} from '@/lib/google-calendar-sync';
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

  console.log('[cron/sync] Starting reconciliation...');
  const start = Date.now();

  const renewed = await renewCalendarWatchIfNeeded();
  if (renewed) console.log('[cron/sync] Calendar watch renewed.');

  const result = await runFullReconciliation();
  const elapsed = Date.now() - start;

  console.log(
    `[cron/sync] Completed in ${elapsed}ms — ${result.ok ? `${result.segmentsProcessed ?? 0} segments` : result.error}`,
  );

  return NextResponse.json(
    {
      ok: result.ok,
      elapsedMs: elapsed,
      watchRenewed: renewed,
      segmentsProcessed: result.segmentsProcessed,
      error: result.error,
    },
    { status: result.ok ? 200 : 500 },
  );
}
