/**
 * Import pre–March 2026 data from "Overtime Logbook - 2026 Hours.csv" into the events table.
 * Only dates strictly before the cutoff (default 2026-03-01) are imported so March onward stays Google Calendar only.
 * Also upserts daily_overtime_notes and recomputes daily_totals (OT balance) from events for the imported range.
 *
 * Usage: dotenv -e .env.local -- tsx scripts/import-2026-csv-to-events.ts "<path-to-2026-csv>" [cutoff-date]
 * Example: dotenv -e .env.local -- tsx scripts/import-2026-csv-to-events.ts "C:\Users\zacha\Downloads\Overtime Logbook - 2026 Hours.csv"
 * Optional second arg: cutoff in YYYY-MM-DD (default 2026-03-01). Only dates before this are imported.
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { db } from '../lib/db';
import { dailyOvertimeNotes, events } from '../lib/schema';
import { recomputeDailyTotalsForDates } from '../lib/overtime';

const CUTOFF_DEFAULT = '2026-03-01';

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

function categorySlug(cat: string): string {
  return cat.replace(/\s+/g, '-').replace(/\//g, '-').slice(0, 80);
}

async function main() {
  const csvPath = process.argv[2];
  const cutoff = process.argv[3]?.trim() || CUTOFF_DEFAULT;
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('Usage: dotenv -e .env.local -- tsx scripts/import-2026-csv-to-events.ts "<path-to-2026-csv>" [cutoff YYYY-MM-DD]');
    console.error('Default cutoff:', CUTOFF_DEFAULT, '(only dates before this are imported)');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
    console.error('Cutoff must be YYYY-MM-DD. Got:', cutoff);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  const byDate = new Map<
    string,
    {
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
    if (date >= cutoff) continue;
    const year = date.slice(0, 4);
    if (year !== '2026') continue;

    const note = row[CSV_COLS.notes]?.trim() || '';

    if (!byDate.has(date)) {
      byDate.set(date, { byCategoryHours: {}, notes: [] });
    }
    const rec = byDate.get(date)!;
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
    console.log(`No 2026 dates before ${cutoff} found in CSV.`);
    process.exit(0);
  }

  console.log(`Importing ${sortedDates.length} days (before ${cutoff}) from ${csvPath}`);

  let eventsUpserted = 0;
  for (const date of sortedDates) {
    const rec = byDate.get(date)!;
    for (const [category, hours] of Object.entries(rec.byCategoryHours)) {
      if (hours <= 0) continue;
      const slug = categorySlug(category);
      const sourceId = `csv-pre-mar-2026-${date}-${slug}`;
      const name = category;
      await db
        .insert(events)
        .values({
          date,
          name,
          category,
          lengthHours: hours,
          sourceType: 'manual',
          sourceId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [events.date, events.sourceType, events.sourceId],
          set: {
            name,
            category,
            lengthHours: hours,
            updatedAt: new Date(),
          },
        });
      eventsUpserted++;
    }

    const note = rec.notes.length > 0 ? [...new Set(rec.notes)].join(' / ') : null;
    if (note != null) {
      await db
        .insert(dailyOvertimeNotes)
        .values({ date, note, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: dailyOvertimeNotes.date,
          set: { note, updatedAt: new Date() },
        });
    }
  }

  console.log(`Upserted ${eventsUpserted} event rows.`);

  await recomputeDailyTotalsForDates(sortedDates);
  console.log('Ensured default notes for imported dates.');

  console.log('Import complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
