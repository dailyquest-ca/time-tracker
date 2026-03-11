import { db } from '@/lib/db';
import { appConfig, calendarWatch, googleTokens } from '@/lib/schema';
import { stopCalendarWatch } from '@/lib/google';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const USER_ID = 'default';
const WORK_CALENDAR_KEY = 'work_calendar_id';

/**
 * Disconnect Google: stop the remote watch channel, then remove stored tokens,
 * calendar watch, and work calendar choice. After this the user can re-connect
 * with a different (e.g. new) OAuth client.
 */
export async function POST() {
  try {
    const tokenRows = await db
      .select()
      .from(googleTokens)
      .where(eq(googleTokens.userId, USER_ID))
      .limit(1);
    const watchRows = await db
      .select()
      .from(calendarWatch)
      .where(eq(calendarWatch.userId, USER_ID))
      .limit(1);

    if (tokenRows.length > 0 && watchRows.length > 0) {
      const token = tokenRows[0];
      const watch = watchRows[0];
      try {
        await stopCalendarWatch(token.accessToken, watch.channelId, watch.resourceId);
      } catch {
        console.warn('[disconnect] Could not stop remote Google channel (best-effort)');
      }
    }

    await db.delete(googleTokens).where(eq(googleTokens.userId, USER_ID));
    await db.delete(calendarWatch).where(eq(calendarWatch.userId, USER_ID));
    await db.delete(appConfig).where(eq(appConfig.key, WORK_CALENDAR_KEY));
  } catch (err) {
    console.error('[auth/google/disconnect]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Disconnect failed' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
