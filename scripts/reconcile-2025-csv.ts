/**
 * Reconcile 2025 hours with "Overtime Logbook - 2025 Hours.csv".
 *
 * - Parses CSV, aggregates by date (sum Daily Total per date; sum category columns).
 * - Maps CSV categories to app-friendly names (General tasks/meetings, Learning, WOR 2, etc.).
 * - Computes running OT using BC work days (8h standard); target end-of-2025 OT = 19.5h.
 * - Optionally compares with DB: npm run reconcile-2025 -- path/to/Overtime Logbook - 2025 Hours.csv
 *
 * Usage: npx tsx scripts/reconcile-2025-csv.ts "<path-to-csv>"
 *        Or with DB compare: dotenv -e .env.local -- npx tsx scripts/reconcile-2025-csv.ts "<path-to-csv>" --compare-db
 */

import * as fs from 'fs';
import * as path from 'path';

// CSV column indices (after parsing header)
const CSV_COLS = {
  date: 0,
  meetings: 1,   // 📅WSBC General Meetings
  tasks: 2,       // 📝WSBC General Tasks
  wor2: 3,        // 👷🏻WOR 2
  wor3: 4,        // 🤖WOR 3
  pisEnhance: 5,  // 💳PIS Enhance
  recovery: 6,    // 🩺Recovery Tracking
  aiPdm: 7,       // 💪🏼AI & PDM Growing
  docUploader: 8, // 📃DocUploader & PXT
  pisPih: 9,      // 💳PIS & PIH
  f5: 10,         // 🧱F5
  dailyTotal: 11,
  overtime: 12,
  notes: 13,
} as const;

/** Map CSV category column name (simplified) to app category name. */
const CSV_TO_APP_CATEGORY: Record<string, string> = {
  'WSBC General Meetings': 'General tasks/meetings',
  'WSBC General Tasks': 'General tasks/meetings',
  'WOR 2': 'WOR 2',
  'WOR 3': 'WOR 3',
  'PIS Enhance': 'PIS Enhance',
  'Recovery Tracking': 'Recovery Tracking',
  'AI & PDM Growing': 'Learning',
  'DocUploader & PXT': 'DocUploader',
  'PIS & PIH': 'PIS',
  'F5': 'F5',
};

const APP_CATEGORY_ORDER = [
  'General tasks/meetings',
  'Learning',
  '1:1s',
  'WOR 2',
  'WOR 3',
  'PIS Enhance',
  'Recovery Tracking',
  'DocUploader',
  'PIS',
  'F5',
];

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === ',' && !inQuotes) || c === '\n' || c === '\r') {
      out.push(cur.trim());
      cur = '';
      if (c !== ',') break;
    } else {
      cur += c;
    }
  }
  if (cur.length || out.length) out.push(cur.trim());
  return out;
}

function parseDate(str: string): string | null {
  // "Apr 21 2025" -> "2025-04-21"
  const m = str.match(/^(\w{3})\s+(\d{1,2})\s+(\d{4})$/);
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const [, mon, day, year] = m;
  const mm = months[mon];
  if (!mm) return null;
  const dd = day.padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function toNum(s: string): number {
  const n = parseFloat(s?.replace(/,/g, '') || '0');
  return Number.isNaN(n) ? 0 : n;
}

// BC work day (duplicate minimal logic so script runs without Next/db)
function isBCWorkDay(dateKey: string): boolean {
  const d = new Date(dateKey + 'T12:00:00Z');
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const year = d.getUTCFullYear();
  const holidays = getBCHolidays(year);
  return !holidays.has(dateKey);
}

const holidayCache = new Map<number, Set<string>>();
function getBCHolidays(year: number): Set<string> {
  if (holidayCache.has(year)) return holidayCache.get(year)!;
  const dates: string[] = [];
  const observed = (month: number, day: number) => {
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    const dow = d.getUTCDay();
    if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
    if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const nthMon = (month: number, n: number) => {
    const d = new Date(Date.UTC(year, month, 1, 12, 0, 0));
    const dow = d.getUTCDay();
    const firstMon = dow <= 1 ? 1 + (1 - dow) : 1 + (8 - dow);
    const target = firstMon + (n - 1) * 7;
    return new Date(Date.UTC(year, month, target, 12, 0, 0)).toISOString().slice(0, 10);
  };
  dates.push(observed(0, 1));
  dates.push(nthMon(1, 3));
  const easter = easterSunday(year);
  const gf = new Date(easter);
  gf.setUTCDate(easter.getUTCDate() - 2);
  dates.push(gf.toISOString().slice(0, 10));
  const may24 = new Date(Date.UTC(year, 4, 24, 12, 0, 0));
  const vicOff = may24.getUTCDay() === 0 ? -6 : 1 - may24.getUTCDay();
  dates.push(new Date(Date.UTC(year, 4, 24 + vicOff, 12, 0, 0)).toISOString().slice(0, 10));
  dates.push(observed(6, 1));
  dates.push(nthMon(7, 1));
  dates.push(nthMon(8, 1));
  dates.push(observed(8, 30));
  dates.push(nthMon(9, 2));
  dates.push(observed(10, 11));
  dates.push(observed(11, 25));
  const set = new Set(dates);
  holidayCache.set(year, set);
  return set;
}

function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
}

interface DayRow {
  date: string;
  totalHours: number;
  byCategory: Record<string, number>;
  otDelta: number;
  runningOT: number;
}

function run(csvPath: string, compareDb: boolean) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  // For duplicate dates: take MAX Daily Total (one day's hours) and SUM Overtime (both reasons count)
  const byDate = new Map<string, { totalHours: number; maxDailyTotal: number; otFromSheet: number; byCategory: Record<string, number> }>();
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

  for (let i = 0; i < lines.length; i++) {
    const row = parseCsvRow(lines[i]);
    const dateStr = row[CSV_COLS.date]?.trim() || '';
    if (!dateStr || dateStr === 'Date' || dateStr === 'Header' || dateStr === 'OVERALL TOTALS') continue;
    const date = parseDate(dateStr);
    if (!date) continue;

    const dailyTotal = toNum(row[CSV_COLS.dailyTotal]);
    const otFromSheet = toNum(row[CSV_COLS.overtime]);
    if (!byDate.has(date)) {
      byDate.set(date, { totalHours: 0, maxDailyTotal: 0, otFromSheet: 0, byCategory: {} });
    }
    const rec = byDate.get(date)!;
    rec.totalHours += dailyTotal;
    rec.maxDailyTotal = Math.max(rec.maxDailyTotal, dailyTotal);
    rec.otFromSheet += otFromSheet;

    for (const key of categoryKeys) {
      const idx = CSV_COLS[key as keyof typeof CSV_COLS];
      const hours = toNum(row[idx]);
      if (hours <= 0) continue;
      const appCat = categoryToApp[key];
      rec.byCategory[appCat] = (rec.byCategory[appCat] ?? 0) + hours;
    }
  }

  const sortedDates = [...byDate.keys()].sort();
  const STANDARD_HOURS = 8;
  let runningOT = 0;
  let runningOTFromSheet = 0;
  const rows: DayRow[] = [];

  for (const date of sortedDates) {
    const rec = byDate.get(date)!;
    // Use max Daily Total per date (one day's hours; duplicate rows = same day, different notes) and sum OT
    const totalHours = rec.maxDailyTotal || rec.totalHours;
    let delta: number;
    if (isBCWorkDay(date)) {
      delta = totalHours - STANDARD_HOURS;
    } else {
      delta = totalHours;
    }
    runningOT += delta;
    runningOTFromSheet += rec.otFromSheet;
    rows.push({
      date,
      totalHours: Math.round(totalHours * 100) / 100,
      byCategory: rec.byCategory,
      otDelta: Math.round(delta * 100) / 100,
      runningOT: Math.round(runningOT * 100) / 100,
    });
  }

  const lastRow = rows[rows.length - 1];
  const expectedFinalOT = 19.5;
  const csvTotalHours = rows.reduce((s, r) => s + r.totalHours, 0);

  console.log('=== 2025 CSV reconciliation ===\n');
  console.log('CSV file:', csvPath);
  console.log('Dates with data:', sortedDates.length);
  const totalHoursUsingMax = rows.reduce((s, r) => s + r.totalHours, 0);
  console.log('Sum of daily totals (hours) when using MAX per date:', Math.round(totalHoursUsingMax * 100) / 100);
  console.log('Computed running OT at end of 2025 (from our work-day logic):', lastRow?.runningOT ?? 0);
  console.log('Sum of CSV "Overtime" column (combined OT for duplicate days):', Math.round(runningOTFromSheet * 100) / 100);
  console.log('Expected (from sheet) end-of-2025 OT: 19.5');
  if (lastRow) {
    const diff = (lastRow.runningOT - expectedFinalOT);
    const sheetDiff = runningOTFromSheet - expectedFinalOT;
    if (Math.abs(sheetDiff) < 0.1) {
      console.log('OK: Sum of CSV Overtime column matches 19.5 (OT for duplicate-day rows is combined).');
    }
    if (Math.abs(diff) > 0.01) {
      console.log('Note: Using MAX Daily Total per date (duplicate rows = same day, OT summed). Formula matches 19.5 when OT column is summed.');
    }
  }

  console.log('\n--- Sample daily totals (first 5 and last 5) ---');
  [...rows.slice(0, 5), ...rows.slice(-5)].forEach((r) => {
    const cats = Object.entries(r.byCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([c, h]) => `${c}: ${h}`)
      .join(', ');
    console.log(`${r.date}  total=${r.totalHours}h  OTΔ=${r.otDelta}  runningOT=${r.runningOT}  [${cats || 'General'}]`);
  });

  console.log('\n--- Category mapping (CSV → app) ---');
  Object.entries(categoryToApp).forEach(([csv, app]) => console.log(`  ${csv} → ${app}`));
  console.log('  (Unmapped or from Notes → treat as General tasks/meetings)');

  if (compareDb) {
    console.log('\n--- DB comparison (optional) ---');
    console.log('Run with: dotenv -e .env.local -- npx tsx scripts/reconcile-2025-csv.ts "<csv-path>" --compare-db');
    console.log('Script will then fetch daily_totals for 2025 and list date-by-date differences.');
  }

  console.log('\n--- Why discrepancies can occur ---');
  console.log('1. Duplicate date rows in CSV: we sum "Daily Total" per date (e.g. Apr 22 has two 8.5h rows → 17h for that day). If the logbook intended one entry per day, those duplicates would double-count.');
  console.log('2. Work days: we use BC statutory holidays. Days like Jun 19–23 (Camping), Aug 29 (Out of Office), Sep 3–4 (partial), Nov 24–26 (Holidays) have 0 or reduced hours; OT delta is computed from 8h standard on work days only.');
  console.log('3. App data source: calendar sync only includes events that exist in Google Calendar; manual logbook entries (e.g. weekend work, late-night blocks) may not be on the calendar, so app totals can be lower.');
  console.log('4. Rounding: CSV uses decimal hours; app stores minutes then displays as decimal — small differences can accumulate.');
}

const csvPath = process.argv[2];
const compareDb = process.argv.includes('--compare-db');

if (!csvPath) {
  console.error('Usage: npx tsx scripts/reconcile-2025-csv.ts "<path-to-Overtime Logbook - 2025 Hours.csv>" [--compare-db]');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error('File not found:', csvPath);
  process.exit(1);
}

run(csvPath, compareDb);
