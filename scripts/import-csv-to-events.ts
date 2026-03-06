/**
 * Import pre–March 2026 data from "Overtime Logbook - 2026 Hours.csv" into the fresh events table.
 * Uses category_id FK: looks up or creates categories as needed.
 * Also upserts daily_overtime_notes and ensures default notes for OT days.
 *
 * Usage: dotenv -e .env.local -- tsx scripts/import-csv-to-events.ts "<path-to-2026-csv>" [cutoff-date]
 * Default cutoff: 2026-03-01 (only dates before this are imported).
 */
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { categories, dailyOvertimeNotes, events } from '../lib/schema';
import { recomputeDailyTotalsForDates } from '../lib/overtime';

const CUTOFF_DEFAULT = '2026-03-01';

const CSV_COLS = {
  date: 0,
  meetings: 1,
  tasks: 2,
  elan: 3,
  pisEnhance: 4,
  wor3: 5,
  aiPdm: 6,
  wor: 7,
  docUploader: 8,
  pisPih: 9,
  other: 10,
  dailyTotal: 11,
  overtime: 12,
  notes: 13,
} as const;

const categoryKeys = [
  'meetings', 'tasks', 'elan', 'pisEnhance', 'wor3',
  'aiPdm', 'wor', 'docUploader', 'pisPih', 'other',
] as const;

const categoryToAppName: Record<string, string> = {
  meetings: 'General tasks/meetings',
  tasks: 'General tasks/meetings',
  elan: 'ELAN',
  pisEnhance: 'PIS Enhance',
  wor3: 'WOR 3',
  aiPdm: 'Learning',
  wor: 'WOR',
  docUploader: 'DocUploader',
  pisPih: 'PIS',
  other: 'General tasks/meetings',
};

const eventNameForKey: Record<string, string> = {
  meetings: 'WSBC General Meetings',
  tasks: 'WSBC General Tasks',
  elan: 'ELAN',
  pisEnhance: 'PIS Enhance',
  wor3: 'WOR 3',
  aiPdm: 'AI & PDM Growing',
  wor: 'WOR',
  docUploader: 'DocUploader & PXT',
  pisPih: 'PIS & PIH',
  other: 'Other Projects',
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

async function getOrCreateCategoryId(name: string): Promise<number> {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [created] = await db
    .insert(categories)
    .values({
      name,
      kind: 'auto_created',
      archived: false,
      displayOrder: 99,
    })
    .onConflictDoNothing()
    .returning({ id: categories.id });

  if (created) return created.id;

  const retry = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  return retry[0].id;
}

async function main() {
  const csvPath = process.argv[2];
  const cutoff = process.argv[3]?.trim() || CUTOFF_DEFAULT;
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('Usage: dotenv -e .env.local -- tsx scripts/import-csv-to-events.ts "<path-to-csv>" [cutoff YYYY-MM-DD]');
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  type DayRecord = {
    entries: { key: string; hours: number }[];
    notes: string[];
  };
  const byDate = new Map<string, DayRecord>();

  for (const line of lines) {
    const row = parseCsvRow(line);
    const dateStr = row[CSV_COLS.date]?.trim() || '';
    if (!dateStr || dateStr === 'Date' || dateStr === 'Header' || dateStr === 'OVERALL TOTALS') continue;
    if (dateStr.startsWith('Leftover')) continue;
    const date = parseDate(dateStr);
    if (!date) continue;
    if (date >= cutoff) continue;

    if (!byDate.has(date)) {
      byDate.set(date, { entries: [], notes: [] });
    }
    const rec = byDate.get(date)!;

    const note = row[CSV_COLS.notes]?.trim() || '';
    if (note) rec.notes.push(note);

    for (const key of categoryKeys) {
      const idx = CSV_COLS[key as keyof typeof CSV_COLS];
      const hours = toNum(row[idx]);
      if (hours <= 0) continue;
      const existing = rec.entries.find((e) => e.key === key);
      if (existing) {
        existing.hours += hours;
      } else {
        rec.entries.push({ key, hours });
      }
    }
  }

  const sortedDates = [...byDate.keys()].sort();
  if (sortedDates.length === 0) {
    console.log(`No dates before ${cutoff} found in CSV.`);
    process.exit(0);
  }

  console.log(`Importing ${sortedDates.length} days (before ${cutoff}) from ${csvPath}`);

  const categoryIdCache = new Map<string, number>();

  let eventsUpserted = 0;
  for (const date of sortedDates) {
    const rec = byDate.get(date)!;
    for (const { key, hours } of rec.entries) {
      const appCatName = categoryToAppName[key];
      const evtName = eventNameForKey[key];

      if (!categoryIdCache.has(appCatName)) {
        categoryIdCache.set(appCatName, await getOrCreateCategoryId(appCatName));
      }
      const categoryId = categoryIdCache.get(appCatName)!;

      const slug = categorySlug(appCatName);
      const sourceId = `csv-2026-${date}-${slug}-${key}`;

      await db
        .insert(events)
        .values({
          date,
          name: evtName,
          categoryId,
          lengthHours: hours.toFixed(2),
          sourceType: 'csv',
          sourceId,
          sourceGroup: 'csv:2026-hours',
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [events.sourceType, events.sourceId],
          set: {
            name: evtName,
            categoryId,
            lengthHours: hours.toFixed(2),
            date,
            updatedAt: new Date(),
          },
        });
      eventsUpserted++;
    }

    const note = rec.notes.length > 0 ? [...new Set(rec.notes)].join(' / ') : null;
    if (note != null) {
      await db
        .insert(dailyOvertimeNotes)
        .values({ date, note, noteSource: 'csv', updatedAt: new Date() })
        .onConflictDoUpdate({
          target: dailyOvertimeNotes.date,
          set: { note, noteSource: 'csv', updatedAt: new Date() },
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
