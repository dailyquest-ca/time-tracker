import { runGoogleCalendarSync } from '@/lib/google-calendar-sync';
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

export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id');
  const resourceState = request.headers.get('x-goog-resource-state');
  const resourceId = request.headers.get('x-goog-resource-id');

  if (!channelId) {
    return NextResponse.json({ error: 'Missing channel id' }, { status: 400 });
  }

  const trusted = await isKnownChannel(channelId, resourceId);
  if (!trusted) {
    console.warn('[webhook] Rejected: unknown channel/resource', { channelId, resourceId });
    return NextResponse.json({ error: 'Unknown channel' }, { status: 403 });
  }

  if (resourceState !== 'sync' && resourceState !== 'exists') {
    return NextResponse.json({ ok: true });
  }

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
