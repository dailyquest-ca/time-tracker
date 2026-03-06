import { db } from '@/lib/db';
import { categories, dailyOvertimeNotes, events } from '@/lib/schema';
import { parseHours } from '@/lib/format';
import { generateOvertimeNoteFromContext } from '@/lib/ai-note';
import { getDailyTotalsInRange } from '@/lib/overtime';
import { isBCWorkDay } from '@/lib/workdays-bc';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export async function PATCH(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Query param "date" (YYYY-MM-DD) required' },
      { status: 400 }
    );
  }
  let body: { note?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const note = body.note !== undefined ? (body.note == null ? null : String(body.note).trim() || null) : undefined;
  if (note === undefined) {
    return NextResponse.json({ error: 'Body must include note (string or null)' }, { status: 400 });
  }
  try {
    await db
      .insert(dailyOvertimeNotes)
      .values({ date, note, noteSource: 'user', updatedAt: new Date() })
      .onConflictDoUpdate({
        target: dailyOvertimeNotes.date,
        set: { note, noteSource: 'user', updatedAt: new Date() },
      });
    return NextResponse.json({ date, note });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Query param "date" (YYYY-MM-DD) required' },
      { status: 400 }
    );
  }

  try {
    const eventRows = await db
      .select({
        id: events.id,
        name: events.name,
        categoryName: categories.name,
        lengthHours: events.lengthHours,
        sourceType: events.sourceType,
      })
      .from(events)
      .innerJoin(categories, eq(events.categoryId, categories.id))
      .where(eq(events.date, date));

    const [totalsRows, noteRow] = await Promise.all([
      getDailyTotalsInRange(date, date),
      db
        .select({ note: dailyOvertimeNotes.note })
        .from(dailyOvertimeNotes)
        .where(eq(dailyOvertimeNotes.date, date))
        .limit(1),
    ]);

    const overtimeBalanceAfter = totalsRows[0]?.overtimeBalanceAfter ?? 0;
    const byCategory: Record<string, number> = {};
    let totalMinutes = 0;
    const tasks = eventRows
      .map((e) => {
        const durationMinutes = Math.round(parseHours(e.lengthHours) * 60);
        const cat = e.categoryName ?? '';
        byCategory[cat] = (byCategory[cat] ?? 0) + durationMinutes;
        totalMinutes += durationMinutes;
        return {
          id: e.id,
          taskTitle: e.name ?? e.categoryName,
          category: cat,
          projectName: null as string | null,
          durationMinutes,
          source: e.sourceType === 'google' ? 'google_calendar' : 'manual',
        };
      })
      .sort((a, b) => b.durationMinutes - a.durationMinutes);

    const hasOT =
      (isBCWorkDay(date) && totalMinutes > 480) ||
      (!isBCWorkDay(date) && totalMinutes > 0);
    let note: string | null = noteRow?.[0]?.note ?? null;
    if ((note == null || note.trim() === '') && hasOT) {
      const aiNote = await generateOvertimeNoteFromContext({
        date,
        totalMinutes,
        byCategory,
        tasks: tasks.map((t) => ({
          taskTitle: t.taskTitle,
          category: t.category,
          durationMinutes: t.durationMinutes,
        })),
      });
      if (aiNote) {
        await db
          .insert(dailyOvertimeNotes)
          .values({ date, note: aiNote, noteSource: 'ai', updatedAt: new Date() })
          .onConflictDoUpdate({
            target: dailyOvertimeNotes.date,
            set: { note: aiNote, noteSource: 'ai', updatedAt: new Date() },
          });
        const [updated] = await db
          .select({ note: dailyOvertimeNotes.note })
          .from(dailyOvertimeNotes)
          .where(eq(dailyOvertimeNotes.date, date))
          .limit(1);
        if (updated?.note != null) note = updated.note;
      } else {
        note = 'Overtime (no event details).';
      }
    }

    const overtimeDrivers: typeof tasks = [];
    if (isBCWorkDay(date) && totalMinutes > 480) {
      let remaining = totalMinutes - 480;
      for (const t of tasks) {
        if (remaining <= 0) break;
        overtimeDrivers.push(t);
        remaining -= t.durationMinutes;
      }
    }

    return NextResponse.json({
      date,
      totalMinutes,
      byCategory,
      overtimeBalanceAfter,
      note,
      tasks,
      overtimeDrivers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
