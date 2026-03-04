/**
 * BC work days: Monday-Friday excluding BC statutory holidays (WorkSafeBC / BC Employment Standards).
 * Fixed-date holidays use observed-day rules: if the actual date falls on Saturday,
 * the observed holiday is the preceding Friday; if Sunday, the following Monday.
 */

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
}

/** Shift a fixed-date holiday to the observed weekday (Sat->Fri, Sun->Mon). */
function observed(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1); // Sat -> Fri
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun -> Mon
  return d.toISOString().slice(0, 10);
}

function nthMondayOf(year: number, month: number, n: number): string {
  const d = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  const dow = d.getUTCDay();
  const firstMon = dow <= 1 ? 1 + (1 - dow) : 1 + (8 - dow);
  const target = firstMon + (n - 1) * 7;
  return new Date(Date.UTC(year, month, target, 12, 0, 0)).toISOString().slice(0, 10);
}

function bcStatutoryHolidays(year: number): string[] {
  const dates: string[] = [];

  // New Year's Day (observed)
  dates.push(observed(year, 0, 1));

  // Family Day - 3rd Monday in February (always a Monday)
  dates.push(nthMondayOf(year, 1, 3));

  // Good Friday (always a Friday)
  const easter = easterSunday(year);
  const gf = new Date(easter);
  gf.setUTCDate(easter.getUTCDate() - 2);
  dates.push(gf.toISOString().slice(0, 10));

  // Victoria Day - last Monday on or before May 24 (always a Monday)
  const may24 = new Date(Date.UTC(year, 4, 24, 12, 0, 0));
  const may24Dow = may24.getUTCDay();
  const vicOff = may24Dow === 0 ? -6 : 1 - may24Dow;
  const vic = new Date(Date.UTC(year, 4, 24 + vicOff, 12, 0, 0));
  dates.push(vic.toISOString().slice(0, 10));

  // Canada Day (observed)
  dates.push(observed(year, 6, 1));

  // BC Day - 1st Monday in August (always a Monday)
  dates.push(nthMondayOf(year, 7, 1));

  // Labour Day - 1st Monday in September (always a Monday)
  dates.push(nthMondayOf(year, 8, 1));

  // National Day for Truth and Reconciliation (observed)
  dates.push(observed(year, 8, 30));

  // Thanksgiving - 2nd Monday in October (always a Monday)
  dates.push(nthMondayOf(year, 9, 2));

  // Remembrance Day (observed)
  dates.push(observed(year, 10, 11));

  // Christmas Day (observed)
  dates.push(observed(year, 11, 25));

  return dates;
}

const cachedByYear: Map<number, Set<string>> = new Map();

function getHolidaySet(year: number): Set<string> {
  if (!cachedByYear.has(year)) {
    cachedByYear.set(year, new Set(bcStatutoryHolidays(year)));
  }
  return cachedByYear.get(year)!;
}

/**
 * Returns true if the given date (YYYY-MM-DD) is a BC work day:
 * Monday-Friday and not an observed BC statutory holiday.
 */
export function isBCWorkDay(dateKey: string): boolean {
  const d = new Date(dateKey + 'T12:00:00Z');
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const year = d.getUTCFullYear();
  const holidays = getHolidaySet(year);
  return !holidays.has(dateKey);
}
