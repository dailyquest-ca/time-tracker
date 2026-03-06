import { describe, it, expect } from 'vitest';
import {
  getAllowedWindow,
  clusterRecentEvents,
  type EventRow,
} from '../category-reclassification';

describe('getAllowedWindow', () => {
  it('returns previous month start through current month end', () => {
    const w = getAllowedWindow(new Date(2026, 2, 15)); // Mar 15 2026
    expect(w.from).toBe('2026-02-01');
    expect(w.to).toBe('2026-03-31');
  });

  it('handles January (wraps to previous year December)', () => {
    const w = getAllowedWindow(new Date(2026, 0, 5)); // Jan 5 2026
    expect(w.from).toBe('2025-12-01');
    expect(w.to).toBe('2026-01-31');
  });

  it('handles December', () => {
    const w = getAllowedWindow(new Date(2026, 11, 20)); // Dec 20 2026
    expect(w.from).toBe('2026-11-01');
    expect(w.to).toBe('2026-12-31');
  });
});

describe('clusterRecentEvents', () => {
  const GENERAL_ID = 1;
  const LEARNING_ID = 2;
  const PIS_ID = 3;

  const catMap: Record<number, string> = {
    [GENERAL_ID]: 'General tasks/meetings',
    [LEARNING_ID]: 'Learning',
    [PIS_ID]: 'PIS',
  };

  function makeEvent(
    overrides: Partial<EventRow> & { name: string; categoryId: number },
  ): EventRow {
    return {
      id: Math.floor(Math.random() * 10000),
      date: '2026-03-05',
      lengthHours: '1.00',
      ...overrides,
    };
  }

  it('returns empty when no events in a broad category', () => {
    const events: EventRow[] = [
      makeEvent({ name: 'PIS Standup', categoryId: PIS_ID }),
      makeEvent({ name: 'PIS Review', categoryId: PIS_ID }),
      makeEvent({ name: 'PIS Deploy', categoryId: PIS_ID }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals).toEqual([]);
  });

  it('detects acronym cluster in General with 3+ events', () => {
    const events: EventRow[] = [
      makeEvent({ id: 1, name: 'WSBC Standup', categoryId: GENERAL_ID }),
      makeEvent({ id: 2, name: 'WSBC Review', categoryId: GENERAL_ID }),
      makeEvent({ id: 3, name: 'WSBC Deploy', categoryId: GENERAL_ID }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals.length).toBe(1);
    expect(proposals[0].pattern).toBe('WSBC');
    expect(proposals[0].matchType).toBe('acronym');
    expect(proposals[0].eventCount).toBe(3);
    expect(proposals[0].suggestedCategoryName).toBe('WSBC');
  });

  it('does not propose acronym clusters with fewer than 3 events', () => {
    const events: EventRow[] = [
      makeEvent({ name: 'WSBC Standup', categoryId: GENERAL_ID }),
      makeEvent({ name: 'WSBC Review', categoryId: GENERAL_ID }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals).toEqual([]);
  });

  it('suggests existing category when acronym matches one', () => {
    const events: EventRow[] = [
      makeEvent({ id: 1, name: 'PIS Standup', categoryId: GENERAL_ID }),
      makeEvent({ id: 2, name: 'PIS Review', categoryId: GENERAL_ID }),
      makeEvent({ id: 3, name: 'PIS Deploy', categoryId: GENERAL_ID }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals.length).toBe(1);
    expect(proposals[0].suggestedCategoryId).toBe(PIS_ID);
    expect(proposals[0].suggestedCategoryName).toBe('PIS');
  });

  it('detects title prefix cluster for non-acronym events', () => {
    const events: EventRow[] = [
      makeEvent({ id: 1, name: 'Productivity planning', categoryId: GENERAL_ID }),
      makeEvent({ id: 2, name: 'Productivity review', categoryId: GENERAL_ID }),
      makeEvent({ id: 3, name: 'Productivity check-in', categoryId: GENERAL_ID }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals.length).toBe(1);
    expect(proposals[0].pattern).toBe('Productivity');
    expect(proposals[0].matchType).toBe('prefix');
    expect(proposals[0].eventCount).toBe(3);
  });

  it('does not double-count events that match both acronym and prefix', () => {
    const events: EventRow[] = [
      makeEvent({ id: 1, name: 'WSBC Standup', categoryId: GENERAL_ID }),
      makeEvent({ id: 2, name: 'WSBC Review', categoryId: GENERAL_ID }),
      makeEvent({ id: 3, name: 'WSBC Deploy', categoryId: GENERAL_ID }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    // WSBC is an acronym, should only appear once as 'acronym' type
    expect(proposals.length).toBe(1);
    expect(proposals[0].matchType).toBe('acronym');
  });

  it('includes sample events capped at 5', () => {
    const events: EventRow[] = Array.from({ length: 8 }, (_, i) =>
      makeEvent({ id: i + 1, name: `WSBC Task ${i}`, categoryId: GENERAL_ID, date: '2026-03-05' }),
    );
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals[0].sampleEvents.length).toBeLessThanOrEqual(5);
  });

  it('computes totalHours from matching events', () => {
    const events: EventRow[] = [
      makeEvent({ id: 1, name: 'WSBC A', categoryId: GENERAL_ID, lengthHours: '1.50' }),
      makeEvent({ id: 2, name: 'WSBC B', categoryId: GENERAL_ID, lengthHours: '2.00' }),
      makeEvent({ id: 3, name: 'WSBC C', categoryId: GENERAL_ID, lengthHours: '0.75' }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals[0].totalHours).toBeCloseTo(4.25);
  });

  it('ignores events already in a specific non-broad category for prefix clustering', () => {
    const events: EventRow[] = [
      makeEvent({ id: 1, name: 'Productivity A', categoryId: PIS_ID }),
      makeEvent({ id: 2, name: 'Productivity B', categoryId: PIS_ID }),
      makeEvent({ id: 3, name: 'Productivity C', categoryId: PIS_ID }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals).toEqual([]);
  });

  it('includes all matching eventIds in proposal', () => {
    const events: EventRow[] = Array.from({ length: 7 }, (_, i) =>
      makeEvent({ id: 100 + i, name: `WSBC Task ${i}`, categoryId: GENERAL_ID }),
    );
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals[0].eventIds).toHaveLength(7);
    expect(proposals[0].eventIds).toEqual(expect.arrayContaining([100, 101, 102, 103, 104, 105, 106]));
  });

  it('sorts proposals by event count descending', () => {
    const events: EventRow[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeEvent({ id: i, name: `WSBC Task ${i}`, categoryId: GENERAL_ID }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeEvent({ id: 100 + i, name: `ELAN Task ${i}`, categoryId: GENERAL_ID }),
      ),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals.length).toBe(2);
    expect(proposals[0].pattern).toBe('ELAN');
    expect(proposals[1].pattern).toBe('WSBC');
  });

  it('ignores short prefix words (fewer than 3 chars)', () => {
    const events: EventRow[] = [
      makeEvent({ id: 1, name: 'Do something', categoryId: GENERAL_ID }),
      makeEvent({ id: 2, name: 'Do another thing', categoryId: GENERAL_ID }),
      makeEvent({ id: 3, name: 'Do a third thing', categoryId: GENERAL_ID }),
    ];
    const proposals = clusterRecentEvents(events, catMap);
    expect(proposals).toEqual([]);
  });
});

describe('getAllowedWindow edge cases', () => {
  it('February has correct end date in non-leap year', () => {
    const w = getAllowedWindow(new Date(2027, 1, 15)); // Feb 15 2027
    expect(w.from).toBe('2027-01-01');
    expect(w.to).toBe('2027-02-28');
  });

  it('February has correct end date in leap year', () => {
    const w = getAllowedWindow(new Date(2028, 1, 15)); // Feb 15 2028
    expect(w.from).toBe('2028-01-01');
    expect(w.to).toBe('2028-02-29');
  });
});
