/**
 * Import Notes from Overtime Logbook CSV(s) into daily_overtime_notes.
 * For each date, combines Notes from all rows across all files (e.g. "Note 1 / Note 2") and updates the DB.
 * Pass one or more CSV paths; notes for the same date from different files are combined.
 *
 * Usage: dotenv -e .env.local -- npx tsx scripts/import-csv-notes.ts "<path-2025.csv>" "<path-2026.csv>"
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { db } from '../lib/db';
import { dailyOvertimeNotes } from '../lib/schema';

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

const CSV_DATE = 0;
const CSV_NOTES = 13;

function parseCsvFile(content: string): Map<string, string[]> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const notesByDate = new Map<string, string[]>();
  for (const line of lines) {
    const row = parseCsvRow(line);
    const dateStr = row[CSV_DATE]?.trim() || '';
    if (!dateStr || dateStr === 'Date' || dateStr === 'Header' || dateStr === 'OVERALL TOTALS') continue;
    const date = parseDate(dateStr);
    if (!date) continue;
    const note = row[CSV_NOTES]?.trim() || '';
    if (!note) continue;
    if (!notesByDate.has(date)) notesByDate.set(date, []);
    notesByDate.get(date)!.push(note);
  }
  return notesByDate;
}

async function main() {
  const csvPaths = process.argv.slice(2).filter((p) => p && fs.existsSync(p));
  if (csvPaths.length === 0) {
    console.error('Usage: dotenv -e .env.local -- npx tsx scripts/import-csv-notes.ts "<path-2025.csv>" "<path-2026.csv>" ...');
    process.exit(1);
  }

  const notesByDate = new Map<string, string[]>();
  for (const csvPath of csvPaths) {
    const content = fs.readFileSync(csvPath, 'utf-8');
    const fromFile = parseCsvFile(content);
    for (const [date, notes] of fromFile) {
      if (!notesByDate.has(date)) notesByDate.set(date, []);
      notesByDate.get(date)!.push(...notes);
    }
  }

  let updated = 0;
  for (const [date, notes] of notesByDate) {
    const combined = [...new Set(notes)].join(' / ');
    await db
      .insert(dailyOvertimeNotes)
      .values({ date, note: combined, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: dailyOvertimeNotes.date,
        set: { note: combined, updatedAt: new Date() },
      });
    updated++;
  }

  console.log(`Updated note for ${updated} dates from ${csvPaths.length} CSV(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
