import { db } from '@/lib/db';
import { workSegments } from '@/lib/schema';
import { recomputeDailyTotalsForDates } from '@/lib/overtime';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface IngestEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  categories?: string[];
  isAllDay?: boolean;
}

function roundToNearest15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round(minutes / 15) * 15;
}

function toDateKey(isoString: string): string {
  return new Date(isoString).toISOString().slice(0, 10);
}

function durationMinutes(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.round(ms / 60_000);
}

export async function POST(request: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    console.error('[ingest/calendar] INGEST_SECRET env var is not set');
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawEvents: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && 'events' in body && Array.isArray((body as { events: unknown[] }).events)
      ? (body as { events: unknown[] }).events
      : body && typeof body === 'object' && 'id' in body
        ? [body]
        : [];

  if (rawEvents.length === 0) {
    return NextResponse.json(
      { error: 'No events found in body. Send an array, { events: [...] }, or a single event object.' },
      { status: 400 },
    );
  }

  const events: IngestEvent[] = [];
  for (const raw of rawEvents) {
    const e = raw as Record<string, unknown>;
    const id = (e.Id ?? e.id) as string | undefined;
    const subject = (e.Subject ?? e.subject ?? '') as string;
    const start = (e.Start ?? e.start) as string | undefined;
    const end = (e.End ?? e.end) as string | undefined;
    const categories = (e.Categories ?? e.categories ?? []) as string[];
    const isAllDay = (e.IsAllDay ?? e.isAllDay ?? false) as boolean;

    if (!id || !start || !end) continue;
    if (isAllDay) continue;

    events.push({ id, subject, start, end, categories, isAllDay });
  }

  if (events.length === 0) {
    return NextResponse.json({ ok: true, ingested: 0, skipped: rawEvents.length });
  }

  const affectedDates = new Set<string>();
  let ingested = 0;

  for (const event of events) {
    const dateKey = toDateKey(event.start);
    const dur = roundToNearest15(durationMinutes(event.start, event.end));
    if (dur <= 0) continue;

    const category =
      event.categories && event.categories.length > 0
        ? event.categories[0]
        : '(uncategorized)';

    affectedDates.add(dateKey);

    await db
      .insert(workSegments)
      .values({
        externalId: event.id,
        date: dateKey,
        taskTitle: event.subject || null,
        category,
        durationMinutes: dur,
        source: 'calendar',
        startAt: new Date(event.start),
        endAt: new Date(event.end),
      })
      .onConflictDoUpdate({
        target: [
          workSegments.source,
          workSegments.externalId,
          workSegments.date,
        ],
        set: {
          taskTitle: event.subject || null,
          category,
          durationMinutes: dur,
          startAt: new Date(event.start),
          endAt: new Date(event.end),
          syncedAt: new Date(),
        },
      });
    ingested++;
  }

  if (affectedDates.size > 0) {
    await recomputeDailyTotalsForDates(Array.from(affectedDates));
  }

  console.log(
    `[ingest/calendar] Ingested ${ingested} event(s) for date(s): ${[...affectedDates].join(', ')}`,
  );

  return NextResponse.json({
    ok: true,
    ingested,
    skipped: rawEvents.length - ingested,
    dates: [...affectedDates],
  });
}
