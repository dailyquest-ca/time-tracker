import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  roundToNearest15,
  isAllDayEvent,
  eventDateKey,
  eventDurationMinutes,
  stableExternalId,
} from '../google-calendar-sync';
import type { GoogleCalendarEvent } from '../google';
import { stopCalendarWatch } from '../google';

function makeEvent(overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    id: 'evt-1',
    summary: 'Test event',
    start: { dateTime: '2026-03-05T09:00:00-08:00' },
    end: { dateTime: '2026-03-05T10:30:00-08:00' },
    ...overrides,
  };
}

describe('roundToNearest15', () => {
  it('rounds 0 to 0', () => {
    expect(roundToNearest15(0)).toBe(0);
  });

  it('returns 0 for negative', () => {
    expect(roundToNearest15(-10)).toBe(0);
  });

  it('rounds 7 minutes to 0 (nearest 15)', () => {
    expect(roundToNearest15(7)).toBe(0);
  });

  it('rounds 8 minutes to 15', () => {
    expect(roundToNearest15(8)).toBe(15);
  });

  it('rounds 23 minutes to 30', () => {
    expect(roundToNearest15(23)).toBe(30);
  });

  it('keeps 30 minutes as-is', () => {
    expect(roundToNearest15(30)).toBe(30);
  });

  it('rounds 90 minutes as-is', () => {
    expect(roundToNearest15(90)).toBe(90);
  });

  it('rounds 52 to 45', () => {
    expect(roundToNearest15(52)).toBe(45);
  });

  it('rounds 53 to 60', () => {
    expect(roundToNearest15(53)).toBe(60);
  });
});

describe('isAllDayEvent', () => {
  it('returns false for timed events', () => {
    expect(isAllDayEvent(makeEvent())).toBe(false);
  });

  it('returns true for all-day events', () => {
    expect(isAllDayEvent(makeEvent({
      start: { date: '2026-03-05' },
      end: { date: '2026-03-06' },
    }))).toBe(true);
  });
});

describe('eventDateKey', () => {
  it('extracts date from dateTime', () => {
    expect(eventDateKey(makeEvent())).toBe('2026-03-05');
  });

  it('uses date field for all-day events', () => {
    expect(eventDateKey(makeEvent({
      start: { date: '2026-03-10' },
      end: { date: '2026-03-11' },
    }))).toBe('2026-03-10');
  });
});

describe('eventDurationMinutes', () => {
  it('calculates duration from start/end dateTime', () => {
    expect(eventDurationMinutes(makeEvent())).toBe(90); // 9:00 to 10:30
  });

  it('handles short events', () => {
    expect(eventDurationMinutes(makeEvent({
      start: { dateTime: '2026-03-05T09:00:00Z' },
      end: { dateTime: '2026-03-05T09:15:00Z' },
    }))).toBe(15);
  });

  it('handles multi-hour events', () => {
    expect(eventDurationMinutes(makeEvent({
      start: { dateTime: '2026-03-05T08:00:00Z' },
      end: { dateTime: '2026-03-05T16:00:00Z' },
    }))).toBe(480);
  });
});

describe('stableExternalId', () => {
  it('returns event id for non-recurring events', () => {
    expect(stableExternalId(makeEvent({ id: 'abc123' }))).toBe('abc123');
  });

  it('returns composite id for recurring event instances', () => {
    const evt = makeEvent({
      id: 'instance-1',
      recurringEventId: 'recurring-base',
      start: { dateTime: '2026-03-05T09:00:00Z' },
    });
    expect(stableExternalId(evt)).toBe('recurring-base:2026-03-05T09:00:00Z');
  });

  it('returns event id if recurringEventId present but no dateTime', () => {
    const evt = makeEvent({
      id: 'instance-1',
      recurringEventId: 'recurring-base',
      start: { date: '2026-03-05' },
    });
    expect(stableExternalId(evt)).toBe('instance-1');
  });
});

describe('stopCalendarWatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls Google channels/stop API with correct payload', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await stopCalendarWatch('test-token', 'channel-123', 'resource-456');

    const stopCall = mockFetch.mock.calls.find(
      (call): call is [string, RequestInit] =>
        typeof call[0] === 'string' && call[0].includes('googleapis.com/calendar/v3/channels/stop'),
    );
    expect(stopCall).toBeDefined();
    const [url, opts] = stopCall!;
    expect(url).toBe('https://www.googleapis.com/calendar/v3/channels/stop');
    expect(opts?.method).toBe('POST');
    expect(opts?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(opts?.body as string);
    expect(body).toEqual({ id: 'channel-123', resourceId: 'resource-456' });
  });

  it('does not throw on non-2xx response (best effort)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    await expect(
      stopCalendarWatch('test-token', 'channel-123', 'resource-456'),
    ).resolves.not.toThrow();
  });
});
