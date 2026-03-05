import { runGoogleCalendarSync } from '@/lib/google-calendar-sync';
import { runSync } from '@/lib/sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type SyncResult = { ok: boolean; error?: string; segmentsProcessed?: number };

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

  const [ticktickResult, googleResult] = await Promise.allSettled([
    runSync(),
    runGoogleCalendarSync(),
  ]);

  const elapsed = Date.now() - start;

  const fail = (reason: unknown): SyncResult => ({
    ok: false,
    error: String((reason as Error)?.message ?? 'Unknown error'),
    segmentsProcessed: 0,
  });

  const ticktick =
    ticktickResult.status === 'fulfilled' ? ticktickResult.value : fail(ticktickResult.reason);
  const google =
    googleResult.status === 'fulfilled' ? googleResult.value : fail(googleResult.reason);

  const anyOk = ticktick.ok || google.ok;
  const ttSeg = ticktick.segmentsProcessed ?? 0;
  const gSeg = google.segmentsProcessed ?? 0;

  console.log(
    `[cron/sync] Completed in ${elapsed}ms — TickTick: ${ticktick.ok ? `${ttSeg} seg` : ticktick.error} | Google: ${google.ok ? `${gSeg} seg` : google.error}`,
  );

  return NextResponse.json(
    {
      ok: anyOk,
      elapsedMs: elapsed,
      ticktick: { ok: ticktick.ok, segmentsProcessed: ttSeg, error: ticktick.error },
      google: { ok: google.ok, segmentsProcessed: gSeg, error: google.error },
    },
    { status: anyOk ? 200 : 500 },
  );
}
