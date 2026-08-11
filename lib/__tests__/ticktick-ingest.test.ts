/**
 * Integration-style tests for the TickTick ingest endpoint.
 * DB and aggregate recomputation are mocked to isolate auth, validation and
 * the response contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upsertedRows: Array<Record<string, unknown>> = [];

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        upsertedRows.push(row);
        return {
          onConflictDoUpdate: vi.fn().mockResolvedValue({ rowCount: 1 }),
        };
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 0 }),
    }),
  },
}));

vi.mock('@/lib/overtime', () => ({
  recomputeDailyTotalsForDates: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/categories', () => ({
  ensureDefaultCategories: vi.fn().mockResolvedValue(undefined),
  getOrCreateCategoryByName: vi.fn().mockResolvedValue(42),
}));

const SECRET = 'test-ingest-secret';

function timedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Wrapping up Product Planning tasks',
    status: 0,
    startDate: '2026-08-10T22:15:00+0000',
    dueDate: '2026-08-10T22:45:00+0000',
    isAllDay: false,
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    lists: [{ id: 'proj-1', name: '🤖ELAN', tasks: [timedTask()] }],
    today: '2026-08-10',
    ...overrides,
  };
}

async function post(payload: unknown, secret: string | null = SECRET) {
  const { NextRequest } = await import('next/server');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret != null) headers.Authorization = `Bearer ${secret}`;
  const mod = await import('@/app/api/ingest/ticktick/route');
  const req = new NextRequest(new URL('/api/ingest/ticktick', 'http://localhost:3000'), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return (mod.POST as unknown as (r: Request) => Promise<Response>)(req);
}

describe('POST /api/ingest/ticktick', () => {
  const originalSecret = process.env.INGEST_SECRET;

  beforeEach(() => {
    upsertedRows.length = 0;
    process.env.INGEST_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = originalSecret;
    vi.clearAllMocks();
  });

  describe('auth', () => {
    it('returns 500 when the shared secret is not configured', async () => {
      delete process.env.INGEST_SECRET;
      const res = await post(body());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Server misconfigured');
    });

    it('does not name the missing env var in the error body', async () => {
      delete process.env.INGEST_SECRET;
      const res = await post(body());
      const json = await res.json();
      expect(JSON.stringify(json)).not.toContain('INGEST_SECRET');
    });

    it('returns 401 when the Authorization header is missing', async () => {
      const res = await post(body(), null);
      expect(res.status).toBe(401);
    });

    it('returns 401 when the bearer token is wrong', async () => {
      const res = await post(body(), 'wrong-secret');
      expect(res.status).toBe(401);
    });

    it('does not reveal which part of the auth check failed', async () => {
      const missing = await (await post(body(), null)).json();
      const wrong = await (await post(body(), 'wrong-secret')).json();
      expect(missing.error).toBe(wrong.error);
    });
  });

  describe('validation', () => {
    it('returns 400 for a malformed JSON body', async () => {
      const { NextRequest } = await import('next/server');
      const mod = await import('@/app/api/ingest/ticktick/route');
      const req = new NextRequest(
        new URL('/api/ingest/ticktick', 'http://localhost:3000'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SECRET}`,
          },
          body: 'not json',
        },
      );
      const res = await (mod.POST as unknown as (r: Request) => Promise<Response>)(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when lists is missing', async () => {
      const res = await post({ today: '2026-08-10' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('lists');
    });

    it('returns 400 when lists is not an array', async () => {
      const res = await post({ lists: 'nope' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when a list is missing its name', async () => {
      const res = await post({ lists: [{ id: 'a', tasks: [] }] });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('name');
    });

    it('returns 400 when today is not YYYY-MM-DD', async () => {
      const res = await post(body({ today: '10-08-2026' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('YYYY-MM-DD');
    });

    it('accepts a request with no today, defaulting to the current Vancouver day', async () => {
      const res = await post({ lists: [{ id: 'a', name: '🤖ELAN', tasks: [] }] });
      expect(res.status).toBe(200);
    });
  });

  describe('ingest', () => {
    it('returns 200 and reports how many items were ingested', async () => {
      const res = await post(body());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.ingested).toBe(1);
    });

    it('writes the event with the ticktick source type', async () => {
      await post(body());
      expect(upsertedRows[0]).toMatchObject({ sourceType: 'ticktick' });
    });

    it('keys the event on the TickTick task id', async () => {
      await post(body());
      expect(upsertedRows[0]).toMatchObject({ sourceId: 'task-1' });
    });

    it('records the list on the event so it can be grouped by list', async () => {
      await post(body());
      expect(upsertedRows[0].sourceGroup).toBe('ticktick:proj-1');
    });

    it('stores duration in hours', async () => {
      await post(body());
      expect(upsertedRows[0].lengthHours).toBe('0.50');
    });

    it('files the event on its Vancouver date', async () => {
      await post(body());
      expect(upsertedRows[0].date).toBe('2026-08-10');
    });

    it('skips tasks dated before today and reports them as skipped', async () => {
      const res = await post(
        body({
          lists: [
            {
              id: 'proj-1',
              name: '🤖ELAN',
              tasks: [
                timedTask({
                  id: 'old',
                  startDate: '2026-08-01T17:00:00+0000',
                  dueDate: '2026-08-01T18:00:00+0000',
                }),
              ],
            },
          ],
        }),
      );
      const json = await res.json();
      expect(json.ingested).toBe(0);
      expect(upsertedRows).toHaveLength(0);
    });

    it('reports the dates it touched so totals can be verified', async () => {
      const res = await post(body());
      expect((await res.json()).dates).toEqual(['2026-08-10']);
    });

    it('recomputes daily totals for affected dates', async () => {
      const { recomputeDailyTotalsForDates } = await import('@/lib/overtime');
      await post(body());
      expect(recomputeDailyTotalsForDates).toHaveBeenCalledWith(['2026-08-10']);
    });

    it('does not recompute when nothing was ingested', async () => {
      const { recomputeDailyTotalsForDates } = await import('@/lib/overtime');
      await post({ lists: [{ id: 'a', name: '🤖ELAN', tasks: [] }] });
      expect(recomputeDailyTotalsForDates).not.toHaveBeenCalled();
    });
  });
});
