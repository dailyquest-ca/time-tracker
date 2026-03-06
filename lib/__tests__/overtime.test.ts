import { describe, it, expect } from 'vitest';
import { parseHours } from '../format';
import { aggregateEventsByDate, generateDefaultOvertimeNote } from '../overtime';

describe('parseHours', () => {
  it('parses a numeric string', () => {
    expect(parseHours('7.25')).toBe(7.25);
    expect(parseHours('0.50')).toBe(0.5);
  });

  it('returns number as-is', () => {
    expect(parseHours(3.5)).toBe(3.5);
  });

  it('returns 0 for null/undefined', () => {
    expect(parseHours(null)).toBe(0);
    expect(parseHours(undefined)).toBe(0);
  });

  it('returns 0 for non-numeric strings', () => {
    expect(parseHours('abc')).toBe(0);
    expect(parseHours('')).toBe(0);
  });

  it('parses negative numbers', () => {
    expect(parseHours('-2.5')).toBe(-2.5);
  });
});

describe('aggregateEventsByDate', () => {
  it('aggregates events by date and category', () => {
    const rows = [
      { date: '2026-03-01', categoryName: 'PIS', lengthHours: '2.00' },
      { date: '2026-03-01', categoryName: 'ELAN', lengthHours: '3.50' },
      { date: '2026-03-01', categoryName: 'PIS', lengthHours: '1.00' },
      { date: '2026-03-02', categoryName: 'General tasks/meetings', lengthHours: '8.00' },
    ];

    const result = aggregateEventsByDate(rows);

    const mar1 = result.get('2026-03-01')!;
    expect(mar1.totalMinutes).toBe(Math.round(6.5 * 60)); // 2+3.5+1 = 6.5h
    expect(mar1.byCategory['PIS']).toBe(Math.round(3 * 60));
    expect(mar1.byCategory['ELAN']).toBe(Math.round(3.5 * 60));

    const mar2 = result.get('2026-03-02')!;
    expect(mar2.totalMinutes).toBe(480);
    expect(mar2.byCategory['General tasks/meetings']).toBe(480);
  });

  it('returns empty map for empty input', () => {
    expect(aggregateEventsByDate([]).size).toBe(0);
  });
});

describe('generateDefaultOvertimeNote', () => {
  it('returns generic note for empty events', () => {
    expect(generateDefaultOvertimeNote([])).toBe('Overtime (no event details).');
  });

  it('uses last event name for regular note', () => {
    const events = [
      { name: 'PIS standup' },
      { name: 'Sprint review' },
    ];
    expect(generateDefaultOvertimeNote(events)).toBe('Overtime: last activity — Sprint review');
  });

  it('detects deployment-like events', () => {
    const events = [
      { name: 'PIS standup' },
      { name: 'Emergency deploy to production' },
    ];
    expect(generateDefaultOvertimeNote(events)).toContain('Deployment / late work');
    expect(generateDefaultOvertimeNote(events)).toContain('Emergency deploy to production');
  });

  it('detects release events', () => {
    const events = [{ name: 'Release v2.0' }];
    expect(generateDefaultOvertimeNote(events)).toContain('Deployment / late work');
  });

  it('handles events with empty name', () => {
    const events = [{ name: '' }];
    expect(generateDefaultOvertimeNote(events)).toBe('Overtime: last activity — Event');
  });
});
