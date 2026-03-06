import { describe, it, expect } from 'vitest';
import {
  fmtHours,
  dateLabel,
  topCategories,
  getYearRange,
  getPayPeriods,
  sumByCategory,
  parseHours,
} from '../format';

describe('fmtHours', () => {
  it('formats 0 minutes', () => {
    expect(fmtHours(0)).toBe('0');
  });

  it('formats whole hours', () => {
    expect(fmtHours(480)).toBe('8');
  });

  it('formats fractional hours', () => {
    expect(fmtHours(435)).toBe('7.25');
    expect(fmtHours(330)).toBe('5.5');
  });

  it('formats negative overtime', () => {
    expect(fmtHours(-120)).toBe('-2');
    expect(fmtHours(-90)).toBe('-1.5');
  });

  it('handles small values', () => {
    expect(fmtHours(15)).toBe('0.25');
  });
});

describe('dateLabel', () => {
  it('formats a known date', () => {
    const label = dateLabel('2026-03-05');
    expect(label).toContain('Thu');
    expect(label).toContain('Mar');
    expect(label).toContain('5');
  });

  it('formats a weekend date', () => {
    const label = dateLabel('2026-03-07');
    expect(label).toContain('Sat');
  });
});

describe('topCategories', () => {
  it('returns all categories when under limit', () => {
    const mins = { PIS: 120, ELAN: 60 };
    const result = topCategories(mins, 5);
    expect(result.shown).toHaveLength(2);
    expect(result.extra).toBe(0);
  });

  it('truncates to limit and counts extras', () => {
    const mins = { PIS: 120, ELAN: 60, WOR: 30, Learning: 15 };
    const result = topCategories(mins, 2);
    expect(result.shown).toHaveLength(2);
    expect(result.extra).toBe(2);
    expect(result.shown[0][0]).toBe('PIS'); // highest first
  });

  it('handles empty input', () => {
    const result = topCategories({}, 3);
    expect(result.shown).toHaveLength(0);
    expect(result.extra).toBe(0);
  });
});

describe('getYearRange', () => {
  it('returns correct range for 2026', () => {
    expect(getYearRange(2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('getPayPeriods', () => {
  const rows = [
    { date: '2026-03-02', totalMinutes: 480, minutesByCategory: { PIS: 480 } },
    { date: '2026-03-10', totalMinutes: 480, minutesByCategory: { ELAN: 480 } },
    { date: '2026-03-16', totalMinutes: 480, minutesByCategory: { PIS: 240, WOR: 240 } },
    { date: '2026-03-25', totalMinutes: 480, minutesByCategory: { PIS: 480 } },
  ];

  it('splits rows into first and second pay periods', () => {
    const pp = getPayPeriods(rows, 2026, 3);
    expect(pp.first.from).toBe('2026-03-01');
    expect(pp.first.to).toBe('2026-03-15');
    expect(pp.first.rows).toHaveLength(2);

    expect(pp.second.from).toBe('2026-03-16');
    expect(pp.second.to).toBe('2026-03-31');
    expect(pp.second.rows).toHaveLength(2);
  });
});

describe('sumByCategory', () => {
  it('aggregates categories across rows', () => {
    const rows = [
      { date: '2026-03-01', totalMinutes: 480, minutesByCategory: { PIS: 240, ELAN: 240 } },
      { date: '2026-03-02', totalMinutes: 480, minutesByCategory: { PIS: 300, WOR: 180 } },
    ];
    const result = sumByCategory(rows);
    expect(result.PIS).toBe(540);
    expect(result.ELAN).toBe(240);
    expect(result.WOR).toBe(180);
  });

  it('returns empty for empty input', () => {
    expect(sumByCategory([])).toEqual({});
  });
});

describe('parseHours (shared)', () => {
  it('parses DB numeric string', () => {
    expect(parseHours('7.25')).toBe(7.25);
  });

  it('returns 0 for null', () => {
    expect(parseHours(null)).toBe(0);
  });
});
