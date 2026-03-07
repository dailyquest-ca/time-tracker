import { db } from '@/lib/db';
import { appConfig, calendarWatch, googleTokens } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const USER_ID = 'default';
const WORK_CALENDAR_KEY = 'work_calendar_id';

/**
 * Disconnect Google: remove stored tokens, calendar watch, and work calendar choice.
 * After this, the user can connect again with a different (e.g. new) OAuth client.
 */
export async function POST() {
  try {
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
