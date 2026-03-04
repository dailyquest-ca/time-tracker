/**
 * BC work days: Monday–Friday excluding BC statutory holidays (WorkSafeBC / BC Employment Standards).
 * Used for overtime: only these days count toward the 8-hour standard and balance.
 */

/**
 * Returns Easter Sunday (noon UTC) for the given year (Anonymous Gregorian).
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

/**
 * BC statutory holidays for a given year. Returns YYYY-MM-DD strings.
 */
function bcStatutoryHolidays(year: number): string[] {
  const dates: string[] = [];

  // New Year's Day - Jan 1
  dates.push(`${year}-01-01`);

  // Family Day - 3rd Monday in February
  const feb3Mon = (() => {
    const d = new Date(Date.UTC(year, 1, 1, 12, 0, 0));
    const day = d.getUTCDay();
    const toMon = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    d.setUTCDate(1 + toMon + 14);
    return d.toISOString().slice(0, 10);
  })();
  dates.push(feb3Mon);

  // Good Friday - Friday before Easter
  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(easter.getUTCDate() - 2);
  dates.push(goodFriday.toISOString().slice(0, 10));

  // Victoria Day - Monday on or before May 24 (last Mon before May 25)
  const may24 = new Date(Date.UTC(year, 4, 24, 12, 0, 0));
  const may24Day = may24.getUTCDay();
  const vicOffset = may24Day === 0 ? -6 : 1 - may24Day;
  const victoria = new Date(may24);
  victoria.setUTCDate(24 + vicOffset);
  dates.push(victoria.toISOString().slice(0, 10));

  // Canada Day - Jul 1
  dates.push(`${year}-07-01`);

  // BC Day - 1st Monday in August
  const aug1 = new Date(Date.UTC(year, 7, 1, 12, 0, 0));
  const aug1Day = aug1.getUTCDay();
  const bcOffset = aug1Day === 0 ? 1 : aug1Day === 1 ? 0 : 8 - aug1Day;
  const bcDay = new Date(aug1);
  bcDay.setUTCDate(1 + bcOffset);
  dates.push(bcDay.toISOString().slice(0, 10));

  // Labour Day - 1st Monday in September
  const sep1 = new Date(Date.UTC(year, 8, 1, 12, 0, 0));
  const sep1Day = sep1.getUTCDay();
  const labOffset = sep1Day === 0 ? 1 : sep1Day === 1 ? 0 : 8 - sep1Day;
  const labour = new Date(sep1);
  labour.setUTCDate(1 + labOffset);
  dates.push(labour.toISOString().slice(0, 10));

  // National Day for Truth and Reconciliation - Sep 30
  dates.push(`${year}-09-30`);

  // Thanksgiving - 2nd Monday in October
  const oct1 = new Date(Date.UTC(year, 9, 1, 12, 0, 0));
  const oct1Day = oct1.getUTCDay();
  const thxFirstMonOffset = oct1Day === 0 ? 1 : oct1Day === 1 ? 0 : 8 - oct1Day;
  const thxSecondMon = new Date(oct1);
  thxSecondMon.setUTCDate(1 + thxFirstMonOffset + 7);
  dates.push(thxSecondMon.toISOString().slice(0, 10));

  // Remembrance Day - Nov 11
  dates.push(`${year}-11-11`);

  // Christmas - Dec 25
  dates.push(`${year}-12-25`);

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
 * Monday–Friday and not a BC statutory holiday.
 */
export function isBCWorkDay(dateKey: string): boolean {
  const d = new Date(dateKey + 'T12:00:00Z');
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  if (day === 0 || day === 6) return false;
  const year = d.getUTCFullYear();
  const holidays = getHolidaySet(year);
  return !holidays.has(dateKey);
}
