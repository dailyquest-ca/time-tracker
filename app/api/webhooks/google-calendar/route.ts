import {
  getValidGoogleToken,
  getWorkCalendarId,
  runGoogleCalendarSync,
  shouldThrottleWebhookSync,
  stampWebhookSyncStarted,
} from '@/lib/google-calendar-sync';
import { stopCalendarWatch } from '@/lib/google';
import { db } from '@/lib/db';
import { calendarWatch } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function isKnownChannel(channelId: string, resourceId: string | null): Promise<boolean> {
  const rows = await db
    .select({ channelId: calendarWatch.channelId, resourceId: calendarWatch.resourceId })
    .from(calendarWatch)
    .where(eq(calendarWatch.userId, 'default'))
    .limit(1);
  if (rows.length === 0) return false;
  const watch = rows[0];
  if (watch.channelId !== channelId) return false;
  if (resourceId && watch.resourceId !== resourceId) return false;
  return true;
}

function calendarIdFromResourceUri(resourceUri: string | null): string | null {
  if (!resourceUri) return null;
  try {
    const u = new URL(resourceUri);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('calendars');
    if (idx === -1 || idx + 1 >= parts.length) return null;
    const encodedId = parts[idx + 1];
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id');
  const resourceState = request.headers.get('x-goog-resource-state');
  const resourceId = request.headers.get('x-goog-resource-id');
  const resourceUri = request.headers.get('x-goog-resource-uri');

  if (!channelId) {
    return NextResponse.json({ error: 'Missing channel id' }, { status: 400 });
  }

  const trusted = await isKnownChannel(channelId, resourceId);
  if (!trusted) {
    const uriCalendarId = calendarIdFromResourceUri(resourceUri);
    const workCalendarId = await getWorkCalendarId().catch(() => null);

    if (resourceId && uriCalendarId && workCalendarId && uriCalendarId === workCalendarId) {
      const accessToken = await getValidGoogleToken().catch(() => null);
      if (accessToken) {
        try {
          await stopCalendarWatch(accessToken, channelId, resourceId);
        } catch {
          // best-effort
        }
      }
    }

    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  if (resourceState !== 'sync' && resourceState !== 'exists') {
    return NextResponse.json({ ok: true });
  }

  if (await shouldThrottleWebhookSync()) {
    return NextResponse.json({ ok: true, throttled: true });
  }

  await stampWebhookSyncStarted();

  try {
    const result = await runGoogleCalendarSync();
    if (!result.ok) {
      console.warn('[webhook] Sync failed:', result.error);
    }
  } catch (err) {
    console.error('[webhook] Error:', err);
  }

  return NextResponse.json({ ok: true });
}
