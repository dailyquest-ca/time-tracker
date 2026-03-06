/**
 * Integration-style tests for API route input validation.
 * These test the validation logic without a real database.
 * DB calls are mocked to isolate the validation layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB module before any route imports
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({ rowCount: 0 }),
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 0 }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 0 }),
    }),
  },
}));

// Mock overtime module
vi.mock('@/lib/overtime', () => ({
  getDailyTotalsInRange: vi.fn().mockResolvedValue([]),
  recomputeDailyTotalsForDates: vi.fn().mockResolvedValue(undefined),
}));

// Mock categories
vi.mock('@/lib/categories', () => ({
  ensureDefaultCategories: vi.fn().mockResolvedValue(undefined),
}));

// Mock ai-note
vi.mock('@/lib/ai-note', () => ({
  generateOvertimeNoteFromContext: vi.fn().mockResolvedValue(null),
}));

// Mock google-calendar-sync
vi.mock('@/lib/google-calendar-sync', () => ({
  runGoogleCalendarSync: vi.fn().mockResolvedValue({ ok: true, segmentsProcessed: 0 }),
  getValidGoogleToken: vi.fn().mockResolvedValue(null),
  ensureCalendarWatch: vi.fn().mockResolvedValue({ ok: true }),
  getLastSyncedAt: vi.fn().mockResolvedValue('2026-03-05T12:00:00.000Z'),
  getWatchStatus: vi.fn().mockResolvedValue({ status: 'active', expiration: '2026-03-12T00:00:00.000Z' }),
}));

// NextRequest needs a full URL to populate nextUrl.searchParams
async function makeNextRequest(url: string, init?: RequestInit) {
  const { NextRequest: NR } = await import('next/server');
  return new NR(new URL(url, 'http://localhost:3000'), init);
}

describe('GET /api/hours validation', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/hours/route');
    GET = mod.GET as unknown as (req: Request) => Promise<Response>;
  });

  it('returns 400 when from/to are missing', async () => {
    const res = await GET(await makeNextRequest('/api/hours'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('from');
  });

  it('returns 400 when from is invalid format', async () => {
    const res = await GET(await makeNextRequest('/api/hours?from=2026-1-1&to=2026-03-01'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('YYYY-MM-DD');
  });

  it('returns 400 when from > to', async () => {
    const res = await GET(await makeNextRequest('/api/hours?from=2026-03-10&to=2026-03-01'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('from must be <= to');
  });

  it('returns 200 with valid params', async () => {
    const res = await GET(await makeNextRequest('/api/hours?from=2026-03-01&to=2026-03-05'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});

describe('GET /api/day validation', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/day/route');
    GET = mod.GET as unknown as (req: Request) => Promise<Response>;
  });

  it('returns 400 when date is missing', async () => {
    const res = await GET(await makeNextRequest('/api/day'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('date');
  });

  it('returns 400 for invalid date format', async () => {
    const res = await GET(await makeNextRequest('/api/day?date=March5'));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/day validation', () => {
  let PATCH: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/day/route');
    PATCH = mod.PATCH as unknown as (req: Request) => Promise<Response>;
  });

  it('returns 400 when date is missing', async () => {
    const res = await PATCH(await makeNextRequest('/api/day', {
      method: 'PATCH',
      body: JSON.stringify({ note: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await PATCH(await makeNextRequest('/api/day?date=2026-03-05', {
      method: 'PATCH',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns 400 when note field is missing from body', async () => {
    const res = await PATCH(await makeNextRequest('/api/day?date=2026-03-05', {
      method: 'PATCH',
      body: JSON.stringify({ somethingElse: true }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('note');
  });
});

describe('POST /api/categories/merge validation', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/categories/merge/route');
    POST = mod.POST as unknown as (req: Request) => Promise<Response>;
  });

  it('returns 400 for missing sourceName/targetName', async () => {
    const res = await POST(await makeNextRequest('/api/categories/merge', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('returns 400 when source equals target', async () => {
    const res = await POST(await makeNextRequest('/api/categories/merge', {
      method: 'POST',
      body: JSON.stringify({ sourceName: 'PIS', targetName: 'PIS' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('different');
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(await makeNextRequest('/api/categories/merge', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/sync', () => {
  let POST: () => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/sync/route');
    POST = mod.POST as unknown as () => Promise<Response>;
  });

  it('returns 200 when sync succeeds', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('includes watchError in response when sync ok but watch failed', async () => {
    const syncMod = await import('@/lib/google-calendar-sync');
    vi.mocked(syncMod.runGoogleCalendarSync).mockResolvedValueOnce({
      ok: true,
      segmentsProcessed: 5,
      watchError: 'Rate limit exceeded',
    });
    vi.resetModules();
    vi.doMock('@/lib/google-calendar-sync', () => ({
      ...syncMod,
      runGoogleCalendarSync: vi.fn().mockResolvedValue({
        ok: true,
        segmentsProcessed: 5,
        watchError: 'Rate limit exceeded',
      }),
    }));
    const mod = await import('@/app/api/sync/route');
    const res = await (mod.POST as unknown as () => Promise<Response>)();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.watchError).toBe('Rate limit exceeded');
  });
});

describe('GET /api/sync/status', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/sync/status/route');
    GET = mod.GET as unknown as () => Promise<Response>;
  });

  it('returns 200 with lastSyncedAt', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('lastSyncedAt');
    expect(body.lastSyncedAt).toBe('2026-03-05T12:00:00.000Z');
  });
});

describe('GET /api/sync/watch-status', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/sync/watch-status/route');
    GET = mod.GET as unknown as () => Promise<Response>;
  });

  it('returns 200 with watch status', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body.status).toBe('active');
    expect(body).toHaveProperty('expiration');
  });
});

describe('POST /api/webhooks/google-calendar', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/webhooks/google-calendar/route');
    POST = mod.POST as unknown as (req: Request) => Promise<Response>;
  });

  it('returns 400 when channel id header is missing', async () => {
    const req = await makeNextRequest('/api/webhooks/google-calendar', {
      method: 'POST',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('channel');
  });

  it('returns 403 for unknown channel id', async () => {
    const req = await makeNextRequest('/api/webhooks/google-calendar', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'unknown-channel',
        'x-goog-resource-state': 'exists',
        'x-goog-resource-id': 'some-resource',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
