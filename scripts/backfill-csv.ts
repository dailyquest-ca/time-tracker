/**
 * Backfill historical hours from CSV exports into the database.
 *
 * Usage:
 *   npm run backfill
 *
 * CSV format expected:
 *   Date, [Category columns...], Daily Total, Overtime, Notes
 *
 * Skipped rows: "Date", "Header", "OVERALL TOTALS", "Leftover time from 2025",
 *               rows where Date is empty, rows where all category hours are 0.
 *
 * Duplicate dates (multiple rows for the same day) are summed per category.
 * Durations are rounded to the nearest 15 minutes.
 * Synthetic ticktick_task_ids are used: backfill-{date}-c{colIndex}
 */

import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { createPool } from '@vercel/postgres';
import { drizzle } from 'drizzle-orm/vercel-postgres';
import { and, gte, lt, lte } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

// ── inline schema so we don't depend on Next.js module resolution ─────────────

const workSegments = pgTable(
  'work_segments',
  {
    id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
    ticktickTaskId: text('ticktick_task_id').notNull(),
    date: text('date').notNull(),
    projectId: text('project_id'),
    projectName: text('project_name'),
    tags: jsonb('tags').$type<string[]>().default([]),
    category: text('category').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.ticktickTaskId, t.date)]
);

const dailyTotals = pgTable('daily_totals', {
  date: text('date').primaryKey(),
  totalMinutes: integer('total_minutes').notNull().default(0),
  minutesByCategory: jsonb('minutes_by_category')
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  overtimeBalanceAfter: integer('overtime_balance_after').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── DB setup ─────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) {
  console.error('ERROR: No DATABASE_URL or POSTGRES_URL found in .env.local');
  process.exit(1);
}
const pool = createPool({ connectionString });
const db = drizzle(pool, { schema: { workSegments, dailyTotals } });

// ── BC statutory holidays ────────────────────────────────────────────────────

function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(Date.UTC(year, month, d));
    if (date.getMonth() !== month) break;
    if (date.getUTCDay() === weekday) {
      count++;
      if (count === n) return date.toISOString().slice(0, 10);
    }
  }
  return '';
}

function lastWeekdayOnOrBefore(year: number, month: number, dayOfMonth: number, weekday: number): string {
  for (let d = dayOfMonth; d >= dayOfMonth - 6; d--) {
    const date = new Date(Date.UTC(year, month, d));
    if (date.getUTCDay() === weekday) return date.toISOString().slice(0, 10);
  }
  return '';
}

function bcHolidays(year: number): Set<string> {
  const dates: string[] = [];

  // New Year's Day
  dates.push(`${year}-01-01`);

  // Family Day – 3rd Monday in February
  const feb3Mon = (() => {
    const d = new Date(Date.UTC(year, 1, 1, 12, 0, 0));
    const day = d.getUTCDay();
    const toMon = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    d.setUTCDate(1 + toMon + 14);
    return d.toISOString().slice(0, 10);
  })();
  dates.push(feb3Mon);

  // Good Friday
  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(easter.getUTCDate() - 2);
  dates.push(goodFriday.toISOString().slice(0, 10));

  // Victoria Day – last Monday on or before May 24
  dates.push(lastWeekdayOnOrBefore(year, 4, 24, 1));

  // Canada Day
  dates.push(`${year}-07-01`);

  // BC Day – 1st Monday in August
  dates.push(nthWeekdayOfMonth(year, 7, 1, 1));

  // Labour Day – 1st Monday in September
  dates.push(nthWeekdayOfMonth(year, 8, 1, 1));

  // National Day for Truth and Reconciliation
  dates.push(`${year}-09-30`);

  // Thanksgiving – 2nd Monday in October
  dates.push(nthWeekdayOfMonth(year, 9, 1, 2));

  // Remembrance Day
  dates.push(`${year}-11-11`);

  // Christmas
  dates.push(`${year}-12-25`);

  return new Set(dates.filter(Boolean));
}

const holidayCache = new Map<number, Set<string>>();
function isBCWorkDay(dateKey: string): boolean {
  const d = new Date(dateKey + 'T12:00:00Z');
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const year = d.getUTCFullYear();
  if (!holidayCache.has(year)) holidayCache.set(year, bcHolidays(year));
  return !holidayCache.get(year)!.has(dateKey);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundToNearest15(minutes: number): number {
  return Math.max(0, Math.round(minutes / 15) * 15);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

const MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseDateStr(s: string): string | null {
  // "Apr 21 2025" → "2025-04-21"
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const month = MONTH_MAP[parts[0]];
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (month === undefined || isNaN(day) || isNaN(year)) return null;
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// Rows to skip
const SKIP_DATE_VALUES = new Set([
  'date', 'header', 'overall totals', 'leftover time from 2025',
]);

// ── CSV parsing ───────────────────────────────────────────────────────────────

interface DayEntry {
  date: string; // YYYY-MM-DD
  categories: Record<string, number>; // name → minutes (already summed for dup dates)
}

function parseCsv(filePath: string): DayEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  if (lines.length < 2) return [];

  const headerCols = parseCSVLine(lines[0]);
  // Category columns are indices 1 through (last 3 columns = Daily Total, Overtime, Notes)
  const catCols = headerCols.slice(1, headerCols.length - 3);

  const byDate = new Map<string, Record<string, number>>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const rawDate = cols[0] ?? '';

    if (!rawDate || SKIP_DATE_VALUES.has(rawDate.trim().toLowerCase())) continue;

    const dateKey = parseDateStr(rawDate);
    if (!dateKey) continue;

    if (!byDate.has(dateKey)) byDate.set(dateKey, {});
    const entry = byDate.get(dateKey)!;

    for (let c = 0; c < catCols.length; c++) {
      const catName = catCols[c].trim();
      if (!catName) continue;
      const raw = cols[c + 1]?.trim();
      if (!raw) continue;
      const hours = parseFloat(raw);
      if (isNaN(hours) || hours <= 0) continue;
      const minutes = roundToNearest15(hours * 60);
      if (minutes > 0) {
        entry[catName] = (entry[catName] ?? 0) + minutes;
      }
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, categories]) => ({ date, categories }));
}

// ── Recompute daily totals ────────────────────────────────────────────────────

async function recompute(minDate: string, maxDate: string) {
  const MINUTES_PER_STANDARD_DAY = 8 * 60;

  const segments = await db
    .select()
    .from(workSegments)
    .where(and(gte(workSegments.date, minDate), lte(workSegments.date, maxDate)));

  const byDate = new Map<string, { total: number; byCategory: Record<string, number> }>();
  for (const s of segments) {
    if (!byDate.has(s.date)) byDate.set(s.date, { total: 0, byCategory: {} });
    const rec = byDate.get(s.date)!;
    const cat = String(s.category ?? '');
    rec.total += s.durationMinutes;
    rec.byCategory[cat] = (rec.byCategory[cat] ?? 0) + s.durationMinutes;
  }

  // Get running overtime balance from before our range
  const existing = await db
    .select()
    .from(dailyTotals)
    .where(lt(dailyTotals.date, minDate));
  existing.sort((a, b) => a.date.localeCompare(b.date));
  let runningOvertime = existing.length > 0
    ? existing[existing.length - 1].overtimeBalanceAfter
    : 0;

  // Walk every calendar day in range
  const allDates: string[] = [];
  const end = new Date(maxDate + 'T12:00:00Z');
  for (let d = new Date(minDate + 'T12:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    allDates.push(d.toISOString().slice(0, 10));
  }

  let written = 0;
  for (const dateKey of allDates) {
    const data = byDate.get(dateKey) ?? { total: 0, byCategory: {} };
    const totalMinutes = data.total;

    if (isBCWorkDay(dateKey)) {
      if (totalMinutes > MINUTES_PER_STANDARD_DAY) {
        runningOvertime += totalMinutes - MINUTES_PER_STANDARD_DAY;
      } else {
        runningOvertime = Math.max(0, runningOvertime - (MINUTES_PER_STANDARD_DAY - totalMinutes));
      }
    } else {
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
    written++;
  }
  console.log(`  Recomputed ${written} daily total rows (overtime at end: ${(runningOvertime / 60).toFixed(2)}h)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const csv2025 = 'C:\\Users\\zacha\\Downloads\\Overtime Logbook - 2025 Hours.csv';
  const csv2026 = 'C:\\Users\\zacha\\Downloads\\Overtime Logbook - 2026 Hours.csv';

  console.log('Parsing CSV files…');
  const entries2025 = parseCsv(csv2025);
  const entries2026 = parseCsv(csv2026);
  const allEntries = [...entries2025, ...entries2026].sort((a, b) => a.date.localeCompare(b.date));

  console.log(`Found ${allEntries.length} unique days with hours (${entries2025.length} from 2025, ${entries2026.length} from 2026)`);

  let segmentsInserted = 0;
  let segmentsSkipped = 0;

  for (const entry of allEntries) {
    for (const [catName, minutes] of Object.entries(entry.categories)) {
      if (minutes <= 0) continue;

      // Build a stable synthetic task ID: backfill-{date}-{category-slug}
      const slug = catName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
      const syntheticId = `backfill-${entry.date}-${slug}`;

      try {
        await db
          .insert(workSegments)
          .values({
            ticktickTaskId: syntheticId,
            date: entry.date,
            projectId: `backfill-${slug}`,
            projectName: catName,
            tags: [],
            category: catName,
            durationMinutes: minutes,
          })
          .onConflictDoUpdate({
            target: [workSegments.ticktickTaskId, workSegments.date],
            set: {
              projectName: catName,
              category: catName,
              durationMinutes: minutes,
              syncedAt: new Date(),
            },
          });
        segmentsInserted++;
      } catch (e) {
        console.warn(`  Skipped ${syntheticId}:`, e instanceof Error ? e.message : e);
        segmentsSkipped++;
      }
    }
  }

  console.log(`Inserted/updated ${segmentsInserted} work segments (${segmentsSkipped} skipped).`);

  if (allEntries.length > 0) {
    const minDate = allEntries[0].date;
    const maxDate = new Date().toISOString().slice(0, 10); // through today
    console.log(`Recomputing daily totals from ${minDate} to ${maxDate}…`);
    await recompute(minDate, maxDate);
  }

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
