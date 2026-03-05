import { db } from '@/lib/db';
import { appConfig } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { ensureCalendarWatch } from '@/lib/google-calendar-sync';

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
  await ensureCalendarWatch().catch((e) =>
    console.warn('[work-calendar] Watch ensure after save:', e),
  );
  return NextResponse.json({ ok: true, calendarId });
}
