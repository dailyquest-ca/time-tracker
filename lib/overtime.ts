import { and, eq, gte, lt, lte } from 'drizzle-orm';
import { db } from './db';
import {
  appConfig,
  dailyTotals,
  workSegments,
  type WorkCategory,
} from './schema';

const MINUTES_PER_STANDARD_DAY = 8 * 60;
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Mon=1 .. Sun=7

export interface DailyTotalRow {
  date: string;
  totalMinutes: number;
  minutesByCategory: Record<WorkCategory, number>;
  overtimeBalanceAfter: number;
}

async function getWorkDays(): Promise<number[]> {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, 'work_days'))
    .limit(1);
  if (rows.length === 0) return DEFAULT_WORK_DAYS;
  const val = rows[0].value as unknown;
  if (Array.isArray(val)) return val as number[];
  return DEFAULT_WORK_DAYS;
}

function isWorkDay(dateKey: string, workDays: number[]): boolean {
  const d = new Date(dateKey + 'T12:00:00Z');
  const day = d.getUTCDay();
  return workDays.includes(day === 0 ? 7 : day);
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
    minutesByCategory: r.minutesByCategory as Record<WorkCategory, number>,
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
  const workDays = await getWorkDays();

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
    { total: number; byCategory: Record<WorkCategory, number> }
  >();
  for (const s of segments) {
    const cat = s.category as WorkCategory;
    if (!byDate.has(s.date)) {
      byDate.set(s.date, {
        total: 0,
        byCategory: {
          work_project: 0,
          general_task: 0,
          meeting: 0,
        },
      });
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
    const data = byDate.get(dateKey) ?? {
      total: 0,
      byCategory: {
        work_project: 0,
        general_task: 0,
        meeting: 0,
      },
    };
    if (!isWorkDay(dateKey, workDays)) {
      continue;
    }
    const totalMinutes = data.total;
    if (totalMinutes > MINUTES_PER_STANDARD_DAY) {
      runningOvertime += totalMinutes - MINUTES_PER_STANDARD_DAY;
    } else {
      const shortfall = MINUTES_PER_STANDARD_DAY - totalMinutes;
      runningOvertime = Math.max(0, runningOvertime - shortfall);
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
