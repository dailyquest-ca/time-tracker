import { and, gte, lt, lte } from 'drizzle-orm';
import { db } from './db';
import { dailyTotals, workSegments } from './schema';
import { isBCWorkDay } from './workdays-bc';

const MINUTES_PER_STANDARD_DAY = 8 * 60;

export interface DailyTotalRow {
  date: string;
  totalMinutes: number;
  minutesByCategory: Record<string, number>;
  overtimeBalanceAfter: number;
}

export async function getDailyTotalsInRange(
  from: string,
  to: string
): Promise<DailyTotalRow[]> {
  const rows = await db
    .select()
    .from(dailyTotals)
    .where(
      and(gte(dailyTotals.date, from), lte(dailyTotals.date, to))
    )
    .orderBy(dailyTotals.date);
  return rows.map((r) => ({
    date: r.date,
    totalMinutes: r.totalMinutes,
    minutesByCategory: (r.minutesByCategory ?? {}) as Record<string, number>,
    overtimeBalanceAfter: r.overtimeBalanceAfter,
  }));
}

/**
 * Recompute daily totals and overtime for the given dates.
 * Loads segment data for the full range [minDate, maxDate] so running overtime is correct.
 */
export async function recomputeDailyTotalsForDates(
  dates: string[]
): Promise<void> {
  if (dates.length === 0) return;
  const sorted = [...dates].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];

  const segments = await db
    .select()
    .from(workSegments)
    .where(
      and(
        gte(workSegments.date, minDate),
        lte(workSegments.date, maxDate)
      )
    );
  const byDate = new Map<
    string,
    { total: number; byCategory: Record<string, number> }
  >();
  for (const s of segments) {
    const cat = String(s.category ?? '');
    if (!byDate.has(s.date)) {
      byDate.set(s.date, { total: 0, byCategory: {} });
    }
    const rec = byDate.get(s.date)!;
    rec.total += s.durationMinutes;
    rec.byCategory[cat] = (rec.byCategory[cat] ?? 0) + s.durationMinutes;
  }

  const existingTotals = await db
    .select()
    .from(dailyTotals)
    .where(lt(dailyTotals.date, minDate))
    .orderBy(dailyTotals.date);
  let runningOvertime =
    existingTotals.length > 0
      ? existingTotals[existingTotals.length - 1].overtimeBalanceAfter
      : 0;

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
    const data = byDate.get(dateKey) ?? { total: 0, byCategory: {} };
    const totalMinutes = data.total;
    if (isBCWorkDay(dateKey)) {
      // Workday: standard 8h expected; positive delta adds overtime, shortfall reduces it
      if (totalMinutes > MINUTES_PER_STANDARD_DAY) {
        runningOvertime += totalMinutes - MINUTES_PER_STANDARD_DAY;
      } else {
        const shortfall = MINUTES_PER_STANDARD_DAY - totalMinutes;
        runningOvertime = Math.max(0, runningOvertime - shortfall);
      }
    } else {
      // Weekend/holiday: expected 0h, so all worked minutes add to overtime
      runningOvertime += totalMinutes;
    }
    await db
      .insert(dailyTotals)
      .values({
        date: dateKey,
        totalMinutes: data.total,
        minutesByCategory: data.byCategory,
        overtimeBalanceAfter: runningOvertime,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dailyTotals.date,
        set: {
          totalMinutes: data.total,
          minutesByCategory: data.byCategory,
          overtimeBalanceAfter: runningOvertime,
          updatedAt: new Date(),
        },
      });
  }
}
