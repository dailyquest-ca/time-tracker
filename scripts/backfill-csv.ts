/**
 * Backfill historical hours from CSV exports into the database.
 *
 * Usage: npm run backfill
 *
 * Features:
 * - Populates taskTitle from Notes column (best-effort per category)
 * - Uses observed BC statutory holidays (matching lib/workdays-bc.ts)
 * - Validates computed totals against CSV "Daily Total" column
 * - Marks source as 'backfill'
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

// ── Inline schema ────────────────────────────────────────────────────────────

const workSegments = pgTable(
  'work_segments',
  {
    id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
    ticktickTaskId: text('ticktick_task_id'),
    externalId: text('external_id').notNull(),
    date: text('date').notNull(),
    projectId: text('project_id'),
    projectName: text('project_name'),
    taskTitle: text('task_title'),
    tags: jsonb('tags').$type<string[]>().default([]),
    category: text('category').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    source: text('source').notNull().default('ticktick'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.source, t.externalId, t.date)]
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

// ── DB ───────────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: No DATABASE_URL found in .env.local');
  process.exit(1);
}
const pool = createPool({ connectionString });
const db = drizzle(pool, { schema: { workSegments, dailyTotals } });

// ── BC observed holidays (same logic as lib/workdays-bc.ts) ──────────────────

function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
}

function observed(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nthMondayOf(year: number, month: number, n: number): string {
  const d = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  const dow = d.getUTCDay();
  const firstMon = dow <= 1 ? 1 + (1 - dow) : 1 + (8 - dow);
  return new Date(Date.UTC(year, month, firstMon + (n - 1) * 7, 12, 0, 0)).toISOString().slice(0, 10);
}

function bcHolidays(year: number): Set<string> {
  const dates: string[] = [];
  dates.push(observed(year, 0, 1));
  dates.push(nthMondayOf(year, 1, 3));
  const easter = easterSunday(year);
  const gf = new Date(easter); gf.setUTCDate(easter.getUTCDate() - 2);
  dates.push(gf.toISOString().slice(0, 10));
  const may24 = new Date(Date.UTC(year, 4, 24, 12, 0, 0));
  const may24Dow = may24.getUTCDay();
  const vicOff = may24Dow === 0 ? -6 : 1 - may24Dow;
  dates.push(new Date(Date.UTC(year, 4, 24 + vicOff, 12, 0, 0)).toISOString().slice(0, 10));
  dates.push(observed(year, 6, 1));
  dates.push(nthMondayOf(year, 7, 1));
  dates.push(nthMondayOf(year, 8, 1));
  dates.push(observed(year, 8, 30));
  dates.push(nthMondayOf(year, 9, 2));
  dates.push(observed(year, 10, 11));
  dates.push(observed(year, 11, 25));
  return new Set(dates);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const month = MONTH_MAP[parts[0]];
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (month === undefined || isNaN(day) || isNaN(year)) return null;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const SKIP_DATE_VALUES = new Set([
  'date', 'header', 'overall totals', 'leftover time from 2025',
]);

// ── CSV parsing (now extracts notes for task titles) ─────────────────────────

interface CatEntry {
  minutes: number;
  taskTitle: string;
}

interface DayEntry {
  date: string;
  categories: Record<string, CatEntry>;
  csvDailyTotal: number;
}

/**
 * Extract task titles from the Notes column for a specific category.
 * Notes format: "Category - Task Name, Category - Other Task"
 */
function extractTaskTitle(notes: string, catName: string): string {
  if (!notes) return 'Backfill';
  const parts = notes.split(/,\s*/);
  const matches: string[] = [];
  for (const part of parts) {
    if (part.includes(catName) || part.startsWith(catName)) {
      const after = part.replace(new RegExp(`^.*?${catName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–:]\\s*`), '');
      if (after && after !== part) {
        matches.push(after.trim());
      }
    }
  }
  return matches.length > 0 ? matches.join('; ') : 'Backfill';
}

function parseCsv(filePath: string): DayEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerCols = parseCSVLine(lines[0]);
  const catCols = headerCols.slice(1, headerCols.length - 3);
  const dailyTotalIdx = headerCols.length - 3; // "Daily Total" column
  const notesIdx = headerCols.length - 1; // "Notes" column

  const byDate = new Map<string, { categories: Record<string, CatEntry>; csvTotal: number }>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const rawDate = cols[0] ?? '';
    if (!rawDate || SKIP_DATE_VALUES.has(rawDate.trim().toLowerCase())) continue;
    const dateKey = parseDateStr(rawDate);
    if (!dateKey) continue;

    const notes = cols[notesIdx] ?? '';
    const csvTotal = parseFloat(cols[dailyTotalIdx] ?? '') || 0;

    if (!byDate.has(dateKey)) byDate.set(dateKey, { categories: {}, csvTotal: 0 });
    const entry = byDate.get(dateKey)!;
    entry.csvTotal += csvTotal;

    for (let c = 0; c < catCols.length; c++) {
      const catName = catCols[c].trim();
      if (!catName) continue;
      const raw = cols[c + 1]?.trim();
      if (!raw) continue;
      const hours = parseFloat(raw);
      if (isNaN(hours) || hours <= 0) continue;
      const minutes = roundToNearest15(hours * 60);
      if (minutes > 0) {
        if (!entry.categories[catName]) {
          entry.categories[catName] = { minutes: 0, taskTitle: '' };
        }
        entry.categories[catName].minutes += minutes;
        const title = extractTaskTitle(notes, catName);
        if (title !== 'Backfill' && !entry.categories[catName].taskTitle) {
          entry.categories[catName].taskTitle = title;
        }
      }
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, val]) => ({
      date,
      categories: val.categories,
      csvDailyTotal: val.csvTotal,
    }));
}

// ── Recompute daily totals (observed holidays) ───────────────────────────────

async function recompute(minDate: string, maxDate: string) {
  const STD = 8 * 60;

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

  const existing = await db.select().from(dailyTotals).where(lt(dailyTotals.date, minDate));
  existing.sort((a, b) => a.date.localeCompare(b.date));
  let runningOT = existing.length > 0 ? existing[existing.length - 1].overtimeBalanceAfter : 0;

  const allDates: string[] = [];
  const end = new Date(maxDate + 'T12:00:00Z');
  for (let d = new Date(minDate + 'T12:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    allDates.push(d.toISOString().slice(0, 10));
  }

  let written = 0;
  for (const dateKey of allDates) {
    const data = byDate.get(dateKey) ?? { total: 0, byCategory: {} };
    if (isBCWorkDay(dateKey)) {
      if (data.total > STD) runningOT += data.total - STD;
      else runningOT = Math.max(0, runningOT - (STD - data.total));
    } else {
      runningOT += data.total;
    }
    await db
      .insert(dailyTotals)
      .values({ date: dateKey, totalMinutes: data.total, minutesByCategory: data.byCategory, overtimeBalanceAfter: runningOT, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: dailyTotals.date,
        set: { totalMinutes: data.total, minutesByCategory: data.byCategory, overtimeBalanceAfter: runningOT, updatedAt: new Date() },
      });
    written++;
  }
  console.log(`  Recomputed ${written} daily total rows (overtime at end: ${(runningOT / 60).toFixed(2)}h)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const csv2025 = 'C:\\Users\\zacha\\Downloads\\Overtime Logbook - 2025 Hours.csv';
  const csv2026 = 'C:\\Users\\zacha\\Downloads\\Overtime Logbook - 2026 Hours.csv';

  console.log('Parsing CSV files...');
  const entries2025 = parseCsv(csv2025);
  const entries2026 = parseCsv(csv2026);
  const allEntries = [...entries2025, ...entries2026].sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Found ${allEntries.length} unique days (${entries2025.length} from 2025, ${entries2026.length} from 2026)`);

  let segmentsInserted = 0;
  let mismatches = 0;

  for (const entry of allEntries) {
    let computedTotal = 0;
    for (const [catName, catEntry] of Object.entries(entry.categories)) {
      if (catEntry.minutes <= 0) continue;
      computedTotal += catEntry.minutes;

      const slug = catName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
      const syntheticId = `backfill-${entry.date}-${slug}`;
      const title = catEntry.taskTitle || 'Backfill';

      await db
        .insert(workSegments)
        .values({
          externalId: syntheticId,
          ticktickTaskId: syntheticId,
          date: entry.date,
          projectId: `backfill-${slug}`,
          projectName: catName,
          taskTitle: title,
          tags: [],
          category: catName,
          durationMinutes: catEntry.minutes,
          source: 'backfill',
        })
        .onConflictDoUpdate({
          target: [workSegments.source, workSegments.externalId, workSegments.date],
          set: {
            projectName: catName,
            taskTitle: title,
            category: catName,
            durationMinutes: catEntry.minutes,
            syncedAt: new Date(),
          },
        });
      segmentsInserted++;
    }

    // Validate against CSV daily total
    const csvMins = roundToNearest15(entry.csvDailyTotal * 60);
    if (csvMins > 0 && Math.abs(computedTotal - csvMins) > 15) {
      console.warn(`  MISMATCH ${entry.date}: computed=${computedTotal}min vs CSV=${csvMins}min (delta=${computedTotal - csvMins})`);
      mismatches++;
    }
  }

  console.log(`Inserted/updated ${segmentsInserted} work segments.`);
  if (mismatches > 0) console.warn(`  ${mismatches} daily total mismatch(es) detected.`);

  if (allEntries.length > 0) {
    const minDate = allEntries[0].date;
    const maxDate = new Date().toISOString().slice(0, 10);
    console.log(`Recomputing daily totals from ${minDate} to ${maxDate}...`);
    await recompute(minDate, maxDate);
  }

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
