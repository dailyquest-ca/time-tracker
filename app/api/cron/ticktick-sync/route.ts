/**
 * TickTick sync entrypoint, polled by the GitHub Action in
 * .github/workflows/ticktick-sync.yml.
 *
 * TickTick has no webhooks, and Vercel Hobby cron is daily-only, so the schedule
 * lives in GitHub Actions and calls this route. Auth mirrors
 * app/api/cron/sync/route.ts: Authorization: Bearer <CRON_SECRET>.
 */
import { runTickTickSync } from '@/lib/ticktick-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/ticktick-sync] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/ticktick-sync] Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[cron/ticktick-sync] Starting sync...');
  const start = Date.now();
  const result = await runTickTickSync();
  const elapsed = Date.now() - start;

  console.log(
    `[cron/ticktick-sync] Completed in ${elapsed}ms — ${
      result.ok
        ? `${result.inserted ?? 0} inserted, ${result.updated ?? 0} updated, ${result.skipped ?? 0} skipped, ${result.deleted ?? 0} deleted`
        : result.error
    }`,
  );

  return NextResponse.json(
    { ...result, elapsedMs: elapsed },
    { status: result.ok ? 200 : 500 },
  );
}

export async function GET(request: NextRequest) {
  return handle(request);
}

/** Accepted so the workflow can use either verb. */
export async function POST(request: NextRequest) {
  return handle(request);
}
