/** Parse numeric(6,2) string from DB to number, handling null/string. */
export function parseHours(val: string | number | null | undefined): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

/** Format minutes as decimal hours (e.g. 7.25, 5.5) for display. */
export function fmtHours(minutes: number): string {
  const hours = minutes / 60;
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const s = abs.toFixed(2).replace(/\.?0+$/, '') || '0';
  return `${sign}${s}`;
}

/** Human-readable date label: "Mon, Mar 5" */
export function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' });
  const mon = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${day}, ${mon}`;
}

/** Top N categories by minutes, plus count of extras. */
export function topCategories(
  mins: Record<string, number>,
  limit: number,
): { shown: [string, number][]; extra: number } {
  const sorted = Object.entries(mins).sort(([, a], [, b]) => b - a);
  const shown = sorted.slice(0, limit);
  const extra = sorted.length - shown.length;
  return { shown, extra };
}

export function getPageRange(
  page: number,
  pageSize: number,
): { from: string; to: string } {
  const to = new Date();
  to.setDate(to.getDate() - page * pageSize);
  const from = new Date(to);
  from.setDate(to.getDate() - pageSize + 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function getYearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

interface DailyRow {
  date: string;
  totalMinutes: number;
  minutesByCategory: Record<string, number>;
}

export function getPayPeriods(
  rows: DailyRow[],
  year: number,
  month: number,
): {
  first: { from: string; to: string; rows: DailyRow[] };
  second: { from: string; to: string; rows: DailyRow[] };
} {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const from1 = `${year}-${mm}-01`;
  const to1 = `${year}-${mm}-15`;
  const from2 = `${year}-${mm}-16`;
  const to2 = `${year}-${mm}-${lastDay}`;
  return {
    first: { from: from1, to: to1, rows: rows.filter((r) => r.date >= from1 && r.date <= to1) },
    second: { from: from2, to: to2, rows: rows.filter((r) => r.date >= from2 && r.date <= to2) },
  };
}

export function sumByCategory(rows: DailyRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of rows) {
    for (const [cat, mins] of Object.entries(r.minutesByCategory ?? {})) {
      totals[cat] = (totals[cat] ?? 0) + mins;
    }
  }
  return totals;
}
