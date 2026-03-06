import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from './db';
import { categories, dailyOvertimeNotes, events } from './schema';
import { isBCWorkDay } from './workdays-bc';
import { parseHours } from './format';

export const MINUTES_PER_STANDARD_DAY = 8 * 60;

export const APP_FIRST_DATE = '2026-01-01';

export const CARRYOVER_OT_MINUTES_BEFORE_2026 = Math.round(19.5 * 60);

export function generateDefaultOvertimeNote(
  eventNames: { name: string }[]
): string {
  if (eventNames.length === 0) return 'Overtime (no event details).';
  const last = eventNames[eventNames.length - 1];
  const title = (last.name ?? 'Event').trim() || 'Event';
  const deploymentLike = /deploy|release|push|go-live/i.test(title);
  if (deploymentLike) return `Deployment / late work — ${title}`;
  return `Overtime: last activity — ${title}`;
}

export interface DailyTotalRow {
  date: string;
  totalMinutes: number;
  minutesByCategory: Record<string, number>;
  overtimeBalanceAfter: number;
  note?: string | null;
}

interface EventAggRow {
  date: string;
  categoryName: string;
  lengthHours: string;
}

export function aggregateEventsByDate(
  eventRows: EventAggRow[]
): Map<string, { totalMinutes: number; byCategory: Record<string, number> }> {
  const byDate = new Map<
    string,
    { totalMinutes: number; byCategory: Record<string, number> }
  >();
  for (const e of eventRows) {
    const hours = parseHours(e.lengthHours);
    const min = Math.round(hours * 60);
    if (!byDate.has(e.date)) {
      byDate.set(e.date, { totalMinutes: 0, byCategory: {} });
    }
    const rec = byDate.get(e.date)!;
    rec.totalMinutes += min;
    const cat = e.categoryName ?? '';
    rec.byCategory[cat] = (rec.byCategory[cat] ?? 0) + min;
  }
  return byDate;
}

/**
 * Derive running overtime balance (in minutes) from events for each date
 * from APP_FIRST_DATE through toDate. No daily_totals table needed.
 */
export async function computeOvertimeBalancesFromEvents(
  toDate: string
): Promise<Map<string, number>> {
  const eventRows = await db
    .select({
      date: events.date,
      categoryName: categories.name,
      lengthHours: events.lengthHours,
    })
    .from(events)
    .innerJoin(categories, eq(events.categoryId, categories.id))
    .where(and(gte(events.date, APP_FIRST_DATE), lte(events.date, toDate)));

  const totalsByDate = aggregateEventsByDate(eventRows);
  const result = new Map<string, number>();
  let runningOvertime = CARRYOVER_OT_MINUTES_BEFORE_2026;
  const end = new Date(toDate + 'T12:00:00Z');
  for (
    let d = new Date(APP_FIRST_DATE + 'T12:00:00Z');
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const dateKey = d.toISOString().slice(0, 10);
    const totalMinutes =
      dateKey === APP_FIRST_DATE
        ? 0
        : (totalsByDate.get(dateKey)?.totalMinutes ?? 0);
    const workDay = isBCWorkDay(dateKey);
    if (workDay) {
      runningOvertime += totalMinutes - MINUTES_PER_STANDARD_DAY;
    } else {
      runningOvertime += totalMinutes;
    }
    result.set(dateKey, runningOvertime);
  }
  return result;
}

export async function getDailyTotalsInRange(
  from: string,
  to: string
): Promise<DailyTotalRow[]> {
  const [eventRows, noteRows] = await Promise.all([
    db
      .select({
        date: events.date,
        categoryName: categories.name,
        lengthHours: events.lengthHours,
      })
      .from(events)
      .innerJoin(categories, eq(events.categoryId, categories.id))
      .where(and(gte(events.date, from), lte(events.date, to))),
    db
      .select({ date: dailyOvertimeNotes.date, note: dailyOvertimeNotes.note })
      .from(dailyOvertimeNotes)
      .where(
        and(
          gte(dailyOvertimeNotes.date, from),
          lte(dailyOvertimeNotes.date, to)
        )
      ),
  ]);

  const totalsByDate = aggregateEventsByDate(eventRows);
  const noteByDate = new Map(
    noteRows.map((r) => [r.date, r.note ?? null])
  );

  const otBalances = await computeOvertimeBalancesFromEvents(to);

  const result: DailyTotalRow[] = [];
  const end = new Date(to + 'T12:00:00Z');
  for (
    let d = new Date(from + 'T12:00:00Z');
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const dateKey = d.toISOString().slice(0, 10);
    const agg = totalsByDate.get(dateKey);
    const totalMinutes = agg?.totalMinutes ?? 0;
    const minutesByCategory = agg?.byCategory ?? {};
    result.push({
      date: dateKey,
      totalMinutes,
      minutesByCategory,
      overtimeBalanceAfter: otBalances.get(dateKey) ?? 0,
      note: noteByDate.get(dateKey) ?? null,
    });
  }
  return result;
}

/**
 * Ensure default overtime notes for the given dates (when day has OT and no user note).
 * Writes only to daily_overtime_notes.
 */
export async function recomputeDailyTotalsForDates(
  dates: string[]
): Promise<void> {
  if (dates.length === 0) return;
  const sorted = [...dates].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];

  const eventRows = await db
    .select({
      date: events.date,
      name: events.name,
      lengthHours: events.lengthHours,
    })
    .from(events)
    .where(and(gte(events.date, minDate), lte(events.date, maxDate)));

  const byDate = new Map<
    string,
    {
      total: number;
      eventNames: { name: string }[];
    }
  >();
  for (const e of eventRows) {
    const hours = parseHours(e.lengthHours);
    const min = Math.round(hours * 60);
    if (!byDate.has(e.date)) {
      byDate.set(e.date, { total: 0, eventNames: [] });
    }
    const rec = byDate.get(e.date)!;
    rec.total += min;
    rec.eventNames.push({ name: e.name ?? 'Event' });
  }

  const existingNotes = await db
    .select({ date: dailyOvertimeNotes.date, note: dailyOvertimeNotes.note })
    .from(dailyOvertimeNotes)
    .where(
      and(
        gte(dailyOvertimeNotes.date, minDate),
        lte(dailyOvertimeNotes.date, maxDate)
      )
    );
  const noteByDate = new Map(
    existingNotes.map((r) => [r.date, r.note ?? null])
  );

  const allDatesInRange: string[] = [];
  const end = new Date(maxDate + 'T12:00:00Z');
  for (
    let d = new Date(minDate + 'T12:00:00Z');
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    allDatesInRange.push(d.toISOString().slice(0, 10));
  }

  for (const dateKey of allDatesInRange) {
    const data = byDate.get(dateKey) ?? { total: 0, eventNames: [] };
    const totalMinutes = dateKey === APP_FIRST_DATE ? 0 : data.total;
    const hasOT =
      (isBCWorkDay(dateKey) && totalMinutes > MINUTES_PER_STANDARD_DAY) ||
      (!isBCWorkDay(dateKey) && totalMinutes > 0);
    const existingNote = noteByDate.get(dateKey) ?? null;
    const hasUserNote =
      existingNote != null && String(existingNote).trim() !== '';
    const defaultNote = hasOT
      ? generateDefaultOvertimeNote(data.eventNames)
      : null;
    const note =
      hasUserNote ? existingNote : (hasOT ? defaultNote : null);
    await db
      .insert(dailyOvertimeNotes)
      .values({
        date: dateKey,
        note,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dailyOvertimeNotes.date,
        set: { note, updatedAt: new Date() },
      });
  }
}
