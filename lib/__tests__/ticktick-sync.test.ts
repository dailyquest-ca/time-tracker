/**
 * Unit tests for the pure parts of the TickTick sync (window maths, grouping)
 * and integration-style tests for the cron route's auth and response contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeSyncWindow,
  groupTasksByList,
} from '@/lib/ticktick-sync';
import type { TickTickTask } from '@/lib/ticktick';

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
}));

function task(overrides: Partial<TickTickTask> = {}): TickTickTask {
  return {
    id: 'task-1',
    projectId: 'list-a',
    title: 'Some work',
    status: 0,
    startDate: '2026-08-10T22:15:00+0000',
    dueDate: '2026-08-10T22:45:00+0000',
    isAllDay: false,
    ...overrides,
  };
}

describe('computeSyncWindow', () => {
  const now = new Date('2026-08-10T20:00:00Z'); // 13:00 Vancouver

  it('looks back the configured number of days', () => {
    const w = computeSyncWindow(now, { lookbackDays: 7, futureDays: 2 });
    expect(w.startDateKey).toBe('2026-08-03');
  });

  it('looks forward the configured number of days', () => {
    const w = computeSyncWindow(now, { lookbackDays: 7, futureDays: 2 });
    expect(w.endDateKey).toBe('2026-08-12');
  });

  it('clamps the start to the cutover date when the cutover is later', () => {
    const w = computeSyncWindow(now, {
      lookbackDays: 30,
      futureDays: 2,
      cutover: '2026-08-10',
    });
    expect(w.startDateKey).toBe('2026-08-10');
  });

  it('ignores a cutover earlier than the lookback window', () => {
    const w = computeSyncWindow(now, {
      lookbackDays: 7,
      futureDays: 2,
      cutover: '2026-01-01',
    });
    expect(w.startDateKey).toBe('2026-08-03');
  });

  it('emits ISO bounds carrying a timezone offset for the MCP call', () => {
    const w = computeSyncWindow(now, { lookbackDays: 7, futureDays: 2 });
    expect(w.startIso).toMatch(/^2026-08-03T00:00:00[+-]\d{2}:\d{2}$/);
    expect(w.endIso).toMatch(/^2026-08-12T23:59:59[+-]\d{2}:\d{2}$/);
  });

  it('uses Pacific Daylight Time offset in summer', () => {
    const w = computeSyncWindow(now, { lookbackDays: 1, futureDays: 0 });
    expect(w.startIso).toContain('-07:00');
  });

  it('uses Pacific Standard Time offset in winter', () => {
    const winter = new Date('2026-01-15T20:00:00Z');
    const w = computeSyncWindow(winter, { lookbackDays: 1, futureDays: 0 });
    expect(w.startIso).toContain('-08:00');
  });

  it('bounds the window by Vancouver day, not UTC day', () => {
    // 2026-08-11T04:00Z is still Aug 10 in Vancouver.
    const lateUtc = new Date('2026-08-11T04:00:00Z');
    const w = computeSyncWindow(lateUtc, { lookbackDays: 0, futureDays: 0 });
    expect(w.startDateKey).toBe('2026-08-10');
  });
});

describe('groupTasksByList', () => {
  const lists = [
    { id: 'list-a', name: '🤖ELAN' },
    { id: 'list-b', name: '💳PIS Enhance' },
  ];

  it('files each task under its own list', () => {
    const grouped = groupTasksByList(lists, [
      task({ id: '1', projectId: 'list-a' }),
      task({ id: '2', projectId: 'list-b' }),
    ]);
    expect(grouped.find((l) => l.id === 'list-a')!.tasks).toHaveLength(1);
    expect(grouped.find((l) => l.id === 'list-b')!.tasks).toHaveLength(1);
  });

  it('keeps the list name so the category can be derived from it', () => {
    const grouped = groupTasksByList(lists, [task()]);
    expect(grouped[0].name).toBe('🤖ELAN');
  });

  it('returns every list even when it has no tasks', () => {
    const grouped = groupTasksByList(lists, []);
    expect(grouped).toHaveLength(2);
    expect(grouped.every((l) => l.tasks.length === 0)).toBe(true);
  });

  it('drops tasks belonging to a list that was not requested', () => {
    const grouped = groupTasksByList(lists, [task({ projectId: 'unknown-list' })]);
    expect(grouped.flatMap((l) => l.tasks)).toHaveLength(0);
  });
});

describe('GET /api/cron/ticktick-sync', () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = 'cron-secret';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
    vi.clearAllMocks();
  });

  async function call(secret: string | null) {
    vi.doMock('@/lib/ticktick-sync', () => ({
      runTickTickSync: vi.fn().mockResolvedValue({
        ok: true,
        lists: 1,
        fetched: 1,
        inserted: 1,
        updated: 0,
        skipped: 0,
        deleted: 0,
        datesRecomputed: 1,
      }),
    }));
    const { NextRequest } = await import('next/server');
    const mod = await import('@/app/api/cron/ticktick-sync/route');
    const headers: Record<string, string> = {};
    if (secret != null) headers.Authorization = `Bearer ${secret}`;
    const req = new NextRequest(
      new URL('/api/cron/ticktick-sync', 'http://localhost:3000'),
      { headers },
    );
    return (mod.GET as unknown as (r: Request) => Promise<Response>)(req);
  }

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await call('anything');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Server misconfigured');
  });

  it('does not name the missing env var in the response', async () => {
    delete process.env.CRON_SECRET;
    const res = await call('anything');
    expect(JSON.stringify(await res.json())).not.toContain('CRON_SECRET');
  });

  it('returns 401 without an Authorization header', async () => {
    expect((await call(null)).status).toBe(401);
  });

  it('returns 401 with the wrong bearer token', async () => {
    expect((await call('wrong')).status).toBe(401);
  });

  it('returns 200 and the sync summary when authorized', async () => {
    const res = await call('cron-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.inserted).toBe(1);
    expect(body.elapsedMs).toBeTypeOf('number');
  });
});
