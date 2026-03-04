import { runCalendarSync } from '@/lib/calendar-sync';
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

  const [ticktickResult, calendarResult] = await Promise.allSettled([
    runSync(),
    runCalendarSync(),
  ]);

  const elapsed = Date.now() - start;

  const ticktick =
    ticktickResult.status === 'fulfilled'
      ? ticktickResult.value
      : { ok: false as const, error: String(ticktickResult.reason?.message ?? 'Unknown error'), segmentsProcessed: 0 };

  const calendar =
    calendarResult.status === 'fulfilled'
      ? calendarResult.value
      : { ok: false as const, error: String(calendarResult.reason?.message ?? 'Unknown error'), segmentsProcessed: 0 };

  const anyOk = ticktick.ok || calendar.ok;
  const ttSeg = ticktick.segmentsProcessed ?? 0;
  const calSeg = calendar.segmentsProcessed ?? 0;

  console.log(
    `[cron/sync] Completed in ${elapsed}ms — TickTick: ${ticktick.ok ? `${ttSeg} seg` : ticktick.error} | Calendar: ${calendar.ok ? `${calSeg} seg` : calendar.error}`,
  );

  return NextResponse.json(
    {
      ok: anyOk,
      elapsedMs: elapsed,
      ticktick: { ok: ticktick.ok, segmentsProcessed: ttSeg, error: ticktick.error },
      calendar: { ok: calendar.ok, segmentsProcessed: calSeg, error: calendar.error },
    },
    { status: anyOk ? 200 : 500 },
  );
}
