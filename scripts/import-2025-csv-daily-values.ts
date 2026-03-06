/**
 * Import 2025 notes from "Overtime Logbook - 2025 Hours.csv" into daily_overtime_notes.
 * Uses same aggregation as reconcile: max Daily Total per date, sum Overtime per date, sum category hours.
 * Running overtime balance is chained from the last balance before 2025-01-01, then CSV Overtime deltas (converted to minutes).
 *
 * Usage: dotenv -e .env.local -- npx tsx scripts/import-2025-csv-daily-values.ts "<path-to-csv>"
 * Example: dotenv -e .env.local -- npx tsx scripts/import-2025-csv-daily-values.ts "C:\Users\zacha\Downloads\Overtime Logbook - 2025 Hours (1).csv"
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { db } from '../lib/db';
import { dailyOvertimeNotes } from '../lib/schema';

const CSV_COLS = {
  date: 0,
  meetings: 1,
  tasks: 2,
  wor2: 3,
  wor3: 4,
  pisEnhance: 5,
  recovery: 6,
  aiPdm: 7,
  docUploader: 8,
  pisPih: 9,
  f5: 10,
  dailyTotal: 11,
  overtime: 12,
  notes: 13,
} as const;

const categoryKeys = [
  'meetings',
  'tasks',
  'wor2',
  'wor3',
  'pisEnhance',
  'recovery',
  'aiPdm',
  'docUploader',
  'pisPih',
  'f5',
] as const;

const categoryToApp: Record<string, string> = {
  meetings: 'General tasks/meetings',
  tasks: 'General tasks/meetings',
  wor2: 'WOR 2',
  wor3: 'WOR 3',
  pisEnhance: 'PIS Enhance',
  recovery: 'Recovery Tracking',
  aiPdm: 'Learning',
  docUploader: 'DocUploader',
  pisPih: 'PIS',
  f5: 'F5',
};

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if ((c === ',' && !inQuotes) || c === '\n' || c === '\r') {
      out.push(cur.trim());
      cur = '';
      if (c !== ',') break;
    } else cur += c;
  }
  if (cur.length || out.length) out.push(cur.trim());
  return out;
}

function parseDate(str: string): string | null {
  const m = str.match(/^(\w{3})\s+(\d{1,2})\s+(\d{4})$/);
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const [, mon, day, year] = m;
  const mm = months[mon];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, '0')}`;
}

function toNum(s: string): number {
  const n = parseFloat(s?.replace(/,/g, '') || '0');
  return Number.isNaN(n) ? 0 : n;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('Usage: dotenv -e .env.local -- npx tsx scripts/import-2025-csv-daily-values.ts "<path-to-csv>"');
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  const byDate = new Map<
    string,
    {
      maxDailyTotalHours: number;
      otFromSheetHours: number;
      byCategoryHours: Record<string, number>;
      notes: string[];
    }
  >();

  for (const line of lines) {
    const row = parseCsvRow(line);
    const dateStr = row[CSV_COLS.date]?.trim() || '';
    if (!dateStr || dateStr === 'Date' || dateStr === 'Header' || dateStr === 'OVERALL TOTALS') continue;
    const date = parseDate(dateStr);
    if (!date) continue;
    const year = date.slice(0, 4);
    if (year !== '2025') continue;

    const dailyTotalHours = toNum(row[CSV_COLS.dailyTotal]);
    const otHours = toNum(row[CSV_COLS.overtime]);
    const note = row[CSV_COLS.notes]?.trim() || '';

    if (!byDate.has(date)) {
      byDate.set(date, {
        maxDailyTotalHours: 0,
        otFromSheetHours: 0,
        byCategoryHours: {},
        notes: [],
      });
    }
    const rec = byDate.get(date)!;
    rec.maxDailyTotalHours = Math.max(rec.maxDailyTotalHours, dailyTotalHours);
    rec.otFromSheetHours += otHours;

    if (note) rec.notes.push(note);

    for (const key of categoryKeys) {
      const idx = CSV_COLS[key as keyof typeof CSV_COLS];
      const hours = toNum(row[idx]);
      if (hours <= 0) continue;
      const appCat = categoryToApp[key];
      rec.byCategoryHours[appCat] = (rec.byCategoryHours[appCat] ?? 0) + hours;
    }
  }

  const sortedDates = [...byDate.keys()].sort();
  if (sortedDates.length === 0) {
    console.log('No 2025 dates found in CSV.');
    process.exit(0);
  }

  let updated = 0;
  for (const date of sortedDates) {
    const rec = byDate.get(date)!;
    const note =
      rec.notes.length > 0 ? [...new Set(rec.notes)].join(' / ') : null;
    if (note != null) {
      await db
        .insert(dailyOvertimeNotes)
        .values({ date, note, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: dailyOvertimeNotes.date,
          set: { note, updatedAt: new Date() },
        });
      updated++;
    }
  }

  console.log(`Updated notes for ${updated} dates from 2025 CSV.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
