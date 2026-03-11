import {
  runGoogleCalendarSync,
  shouldThrottleWebhookSync,
  stampLegacyWebhookReceived,
  stampWebhookReceived,
  stampWebhookSyncStarted,
} from '@/lib/google-calendar-sync';
import { db } from '@/lib/db';
import { calendarWatch } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function getKnownChannelStatus(channelId: string, resourceId: string | null): Promise<{
  trusted: boolean;
  storedChannelId: string | null;
  storedResourceId: string | null;
}> {
  const rows = await db
    .select({ channelId: calendarWatch.channelId, resourceId: calendarWatch.resourceId })
    .from(calendarWatch)
    .where(eq(calendarWatch.userId, 'default'))
    .limit(1);
  if (rows.length === 0) {
    return { trusted: false, storedChannelId: null, storedResourceId: null };
  }
  const watch = rows[0];
  const trusted =
    watch.channelId === channelId && (!resourceId || watch.resourceId === resourceId);
  return {
    trusted,
    storedChannelId: watch.channelId,
    storedResourceId: watch.resourceId,
  };
}

export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id');
  const resourceState = request.headers.get('x-goog-resource-state');
  const resourceId = request.headers.get('x-goog-resource-id');

  if (!channelId) {
    return NextResponse.json({ error: 'Missing channel id' }, { status: 400 });
  }

  const channelStatus = await getKnownChannelStatus(channelId, resourceId);
  if (!channelStatus.trusted) {
    await stampLegacyWebhookReceived().catch(() => {});
    console.log(
      '[webhook] Ignored untrusted channel',
      channelId,
      channelStatus.storedChannelId
        ? `(active: ${channelStatus.storedChannelId})`
        : '(no stored watch)',
    );
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  await stampWebhookReceived().catch(() => {});

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
