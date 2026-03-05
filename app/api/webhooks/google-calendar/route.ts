import { runGoogleCalendarSync } from '@/lib/google-calendar-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Google Calendar push notifications (from events.watch) send POST to this URL.
 * Headers include X-Goog-Channel-Id, X-Goog-Resource-State, X-Goog-Resource-Id.
 * We respond 200 quickly and run sync; sync may run async in production to avoid timeout.
 */
export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id');
  const resourceState = request.headers.get('x-goog-resource-state');

  if (!channelId) {
    return NextResponse.json({ error: 'Missing channel id' }, { status: 400 });
  }
  if (resourceState !== 'sync' && resourceState !== 'exists') {
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await runGoogleCalendarSync();
    if (!result.ok) {
      console.warn(`[webhooks/google-calendar] Sync failed: ${result.error}`);
    }
  } catch (err) {
    console.error('[webhooks/google-calendar] Error:', err);
  }

  return NextResponse.json({ ok: true });
}
