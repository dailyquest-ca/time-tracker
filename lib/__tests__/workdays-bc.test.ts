import { describe, it, expect } from 'vitest';
import { isBCWorkDay } from '../workdays-bc';

describe('isBCWorkDay', () => {
  it('returns false for Saturdays', () => {
    expect(isBCWorkDay('2026-03-07')).toBe(false); // Saturday
  });

  it('returns false for Sundays', () => {
    expect(isBCWorkDay('2026-03-08')).toBe(false); // Sunday
  });

  it('returns true for a regular Monday', () => {
    expect(isBCWorkDay('2026-03-09')).toBe(true);
  });

  it('returns true for a regular Wednesday', () => {
    expect(isBCWorkDay('2026-01-07')).toBe(true);
  });

  // BC Statutory Holidays 2026
  it('returns false for New Year\'s Day 2026 (observed Jan 1, Thu)', () => {
    expect(isBCWorkDay('2026-01-01')).toBe(false);
  });

  it('returns false for Family Day 2026 (3rd Monday in Feb = Feb 16)', () => {
    expect(isBCWorkDay('2026-02-16')).toBe(false);
  });

  it('returns false for Good Friday 2026 (Apr 3)', () => {
    expect(isBCWorkDay('2026-04-03')).toBe(false);
  });

  it('returns false for Victoria Day 2026 (May 18)', () => {
    expect(isBCWorkDay('2026-05-18')).toBe(false);
  });

  it('returns false for Canada Day 2026 (Jul 1, Wed)', () => {
    expect(isBCWorkDay('2026-07-01')).toBe(false);
  });

  it('returns false for BC Day 2026 (1st Monday in Aug = Aug 3)', () => {
    expect(isBCWorkDay('2026-08-03')).toBe(false);
  });

  it('returns false for Labour Day 2026 (1st Monday in Sep = Sep 7)', () => {
    expect(isBCWorkDay('2026-09-07')).toBe(false);
  });

  it('returns false for National Day for Truth and Reconciliation 2026 (Sep 30, Wed)', () => {
    expect(isBCWorkDay('2026-09-30')).toBe(false);
  });

  it('returns false for Thanksgiving 2026 (2nd Monday in Oct = Oct 12)', () => {
    expect(isBCWorkDay('2026-10-12')).toBe(false);
  });

  it('returns false for Remembrance Day 2026 (Nov 11, Wed)', () => {
    expect(isBCWorkDay('2026-11-11')).toBe(false);
  });

  it('returns false for Christmas Day 2026 (Dec 25, Fri)', () => {
    expect(isBCWorkDay('2026-12-25')).toBe(false);
  });

  // Observed-day shifting
  it('handles New Year on Saturday (2028-01-01 Sat -> observed Dec 31 2027 Fri)', () => {
    expect(isBCWorkDay('2027-12-31')).toBe(false);
  });

  it('handles Canada Day on Sunday (2029-07-01 Sun -> observed Jul 2 Mon)', () => {
    expect(isBCWorkDay('2029-07-02')).toBe(false);
    expect(isBCWorkDay('2029-07-01')).toBe(false); // Sunday anyway
  });

  // Day before / after holiday is still a work day
  it('returns true for day after a holiday', () => {
    expect(isBCWorkDay('2026-01-02')).toBe(true); // Jan 2, Fri
  });

  it('returns true for day before a holiday', () => {
    expect(isBCWorkDay('2026-02-13')).toBe(true); // Fri before Family Day
  });
});
