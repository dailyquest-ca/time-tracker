import { db } from '@/lib/db';
import { appConfig } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { runGoogleCalendarSync } from '@/lib/google-calendar-sync';

const KEY = 'work_calendar_id';

export async function GET() {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, KEY))
    .limit(1);
  const value = rows[0]?.value;
  const calendarId = typeof value === 'string' ? value : null;
  return NextResponse.json({ calendarId });
}

export async function PATCH(request: NextRequest) {
  let body: { calendarId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const calendarId =
    typeof body?.calendarId === 'string' ? body.calendarId.trim() : null;
  if (!calendarId) {
    return NextResponse.json(
      { error: 'Body must include calendarId (string)' },
      { status: 400 },
    );
  }
  await db
    .insert(appConfig)
    .values({
      key: KEY,
      value: calendarId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: calendarId, updatedAt: new Date() },
    });

  const syncResult = await runGoogleCalendarSync().catch((e) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : String(e),
    segmentsProcessed: undefined as number | undefined,
    watchError: undefined as string | undefined,
  }));

  return NextResponse.json({
    ok: true,
    calendarId,
    segmentsProcessed: syncResult.segmentsProcessed,
    ...(syncResult.watchError ? { watchError: syncResult.watchError } : {}),
    ...(syncResult.error ? { syncError: syncResult.error } : {}),
  });
}
