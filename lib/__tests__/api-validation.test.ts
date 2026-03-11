/**
 * Integration-style tests for API route input validation.
 * These test the validation logic without a real database.
 * DB calls are mocked to isolate the validation layer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  runFullReconciliation: vi.fn().mockResolvedValue({ ok: true, segmentsProcessed: 0 }),
  getValidGoogleToken: vi.fn().mockResolvedValue(null),
  getWorkCalendarId: vi.fn().mockResolvedValue(null),
  ensureCalendarWatch: vi.fn().mockResolvedValue({ ok: true }),
  getLastSyncedAt: vi.fn().mockResolvedValue('2026-03-05T12:00:00.000Z'),
  getWatchStatus: vi.fn().mockResolvedValue({ status: 'active', expiration: '2026-03-12T00:00:00.000Z' }),
  shouldThrottleWebhookSync: vi.fn().mockResolvedValue(false),
  stampWebhookSyncStarted: vi.fn().mockResolvedValue(undefined),
  renewCalendarWatchIfNeeded: vi.fn().mockResolvedValue(false),
}));

// Mock category-reclassification
vi.mock('@/lib/category-reclassification', () => ({
  getRecategorizationSuggestions: vi.fn().mockResolvedValue([]),
  previewReclassification: vi.fn().mockResolvedValue([]),
  applyReclassification: vi.fn().mockResolvedValue({ eventsUpdated: 0, affectedDates: [] }),
  getAllowedWindow: vi.fn().mockReturnValue({ from: '2026-02-01', to: '2026-03-31' }),
}));

// Mock lib/google so we can assert stopCalendarWatch is called (webhook unknown-channel flow)
vi.mock('@/lib/google', async () => {
  const actual = await vi.importActual<typeof import('@/lib/google')>('@/lib/google');
  return {
    ...actual,
    stopCalendarWatch: vi.fn().mockResolvedValue(undefined),
  };
});

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

describe('PATCH /api/config/work-calendar', () => {
  let PATCH: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/config/work-calendar/route');
    PATCH = mod.PATCH as unknown as (req: Request) => Promise<Response>;
  });

  it('returns 400 for missing calendarId', async () => {
    const req = await makeNextRequest('/api/config/work-calendar', {
      method: 'PATCH',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('calendarId');
  });

  it('returns 400 for invalid JSON', async () => {
    const req = await makeNextRequest('/api/config/work-calendar', {
      method: 'PATCH',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('calls runGoogleCalendarSync after saving calendar (auto-setup)', async () => {
    const syncMod = await import('@/lib/google-calendar-sync');
    vi.mocked(syncMod.runGoogleCalendarSync).mockClear();
    const req = await makeNextRequest('/api/config/work-calendar', {
      method: 'PATCH',
      body: JSON.stringify({ calendarId: 'my-cal@gmail.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.calendarId).toBe('my-cal@gmail.com');
    expect(syncMod.runGoogleCalendarSync).toHaveBeenCalledTimes(1);
  });

  it('returns sync results including segmentsProcessed', async () => {
    const syncMod = await import('@/lib/google-calendar-sync');
    vi.mocked(syncMod.runGoogleCalendarSync).mockResolvedValueOnce({
      ok: true,
      segmentsProcessed: 12,
    });
    const req = await makeNextRequest('/api/config/work-calendar', {
      method: 'PATCH',
      body: JSON.stringify({ calendarId: 'work@group.calendar.google.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.segmentsProcessed).toBe(12);
  });
});

describe('GET /api/sync/status', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
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

describe('POST /api/auth/google/disconnect', () => {
  let POST: () => Promise<Response>;
  let db: { select: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetModules();
    const dbMod = await import('@/lib/db');
    db = dbMod.db;
    vi.mocked(db.delete).mockClear();
    vi.mocked(db.select).mockClear();
    const mod = await import('@/app/api/auth/google/disconnect/route');
    POST = mod.POST as unknown as () => Promise<Response>;
  });

  it('returns 200 and ok: true', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('stops the remote Google channel before deleting local state', async () => {
    const googleMod = await import('@/lib/google');
    vi.mocked(googleMod.stopCalendarWatch).mockClear();

    const fakeToken = {
      userId: 'default',
      accessToken: 'tok-123',
      refreshToken: 'ref-456',
      expiresAt: new Date(Date.now() + 3600_000),
      updatedAt: new Date(),
    };
    const fakeWatch = {
      userId: 'default',
      calendarId: 'cal@group.calendar.google.com',
      channelId: 'chan-abc',
      resourceId: 'res-def',
      expiration: new Date(Date.now() + 86400_000),
      updatedAt: new Date(),
    };

    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([fakeToken]),
          }),
        }),
      } as never)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([fakeWatch]),
          }),
        }),
      } as never);

    const res = await POST();
    expect(res.status).toBe(200);
    expect(googleMod.stopCalendarWatch).toHaveBeenCalledWith('tok-123', 'chan-abc', 'res-def');
  });

  it('returns 500 when db.delete throws', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as never);
    vi.mocked(db.delete).mockReturnValueOnce({
      where: vi.fn().mockRejectedValueOnce(new Error('DB error')),
    } as unknown as ReturnType<typeof db.delete>);
    const res = await POST();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
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

  it('returns 200 with ok and ignored for unknown channel (no 403)', async () => {
    const req = await makeNextRequest('/api/webhooks/google-calendar', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'unknown-channel',
        'x-goog-resource-state': 'exists',
        'x-goog-resource-id': 'some-resource',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ignored).toBe(true);
  });

  it('calls stopCalendarWatch when unknown channel resource URI matches work calendar', async () => {
    const syncMod = await import('@/lib/google-calendar-sync');
    const googleMod = await import('@/lib/google');
    vi.mocked(syncMod.getWorkCalendarId).mockResolvedValueOnce('my-calendar@gmail.com');
    vi.mocked(syncMod.getValidGoogleToken).mockResolvedValueOnce('fake-access-token');
    vi.mocked(googleMod.stopCalendarWatch).mockResolvedValueOnce(undefined);

    const req = await makeNextRequest('/api/webhooks/google-calendar', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'chan-123',
        'x-goog-resource-id': 'res-456',
        'x-goog-resource-state': 'exists',
        'x-goog-resource-uri': 'https://www.googleapis.com/calendar/v3/calendars/my-calendar%40gmail.com/events',
      },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: true });
    expect(googleMod.stopCalendarWatch).toHaveBeenCalledWith('fake-access-token', 'chan-123', 'res-456');
  });

  it('stops any untrusted channel with a resourceId, even without matching work calendar', async () => {
    const syncMod = await import('@/lib/google-calendar-sync');
    const googleMod = await import('@/lib/google');
    vi.mocked(syncMod.getWorkCalendarId).mockResolvedValueOnce(null);
    vi.mocked(syncMod.getValidGoogleToken).mockResolvedValueOnce('tok-999');
    vi.mocked(googleMod.stopCalendarWatch).mockClear();
    vi.mocked(googleMod.stopCalendarWatch).mockResolvedValueOnce(undefined);

    const req = await makeNextRequest('/api/webhooks/google-calendar', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'stale-chan',
        'x-goog-resource-id': 'stale-res',
        'x-goog-resource-state': 'exists',
      },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: true });
    expect(googleMod.stopCalendarWatch).toHaveBeenCalledWith('tok-999', 'stale-chan', 'stale-res');
  });

  it('returns 200 with throttled:true when debounce fires', async () => {
    const syncMod = await import('@/lib/google-calendar-sync');
    vi.mocked(syncMod.runGoogleCalendarSync).mockClear();
    vi.mocked(syncMod.shouldThrottleWebhookSync).mockResolvedValueOnce(true);

    const dbMod = await import('@/lib/db');
    vi.mocked(dbMod.db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ channelId: 'known-chan', resourceId: 'known-res' }]),
        }),
      }),
    } as never);

    const req = await makeNextRequest('/api/webhooks/google-calendar', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'known-chan',
        'x-goog-resource-id': 'known-res',
        'x-goog-resource-state': 'exists',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.throttled).toBe(true);
    expect(syncMod.runGoogleCalendarSync).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/sync', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = 'test-secret';
    const mod = await import('@/app/api/cron/sync/route');
    GET = mod.GET as unknown as (req: Request) => Promise<Response>;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('calls runFullReconciliation instead of runGoogleCalendarSync', async () => {
    const syncMod = await import('@/lib/google-calendar-sync');
    vi.mocked(syncMod.runFullReconciliation).mockClear();
    vi.mocked(syncMod.runGoogleCalendarSync).mockClear();

    const req = await makeNextRequest('/api/cron/sync', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(syncMod.runFullReconciliation).toHaveBeenCalledTimes(1);
    expect(syncMod.runGoogleCalendarSync).not.toHaveBeenCalled();
  });
});

describe('GET /api/categories/reclassify/suggestions', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/categories/reclassify/suggestions/route');
    GET = mod.GET as unknown as () => Promise<Response>;
  });

  it('returns 200 with proposals array', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('proposals');
    expect(Array.isArray(body.proposals)).toBe(true);
    expect(body).toHaveProperty('window');
  });
});

describe('POST /api/categories/reclassify/apply', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/categories/reclassify/apply/route');
    POST = mod.POST as unknown as (req: Request) => Promise<Response>;
  });

  it('returns 400 when eventIds is missing', async () => {
    const res = await POST(await makeNextRequest('/api/categories/reclassify/apply', {
      method: 'POST',
      body: JSON.stringify({ targetCategoryId: 1 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('eventIds');
  });

  it('returns 400 when targetCategoryId is missing', async () => {
    const res = await POST(await makeNextRequest('/api/categories/reclassify/apply', {
      method: 'POST',
      body: JSON.stringify({ eventIds: [1, 2, 3] }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('targetCategoryId');
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(await makeNextRequest('/api/categories/reclassify/apply', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when eventIds is empty array', async () => {
    const res = await POST(await makeNextRequest('/api/categories/reclassify/apply', {
      method: 'POST',
      body: JSON.stringify({ eventIds: [], targetCategoryId: 5 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('eventIds');
  });

  it('returns 200 with valid payload', async () => {
    const res = await POST(await makeNextRequest('/api/categories/reclassify/apply', {
      method: 'POST',
      body: JSON.stringify({ eventIds: [1, 2, 3], targetCategoryId: 5 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('eventsUpdated');
  });
});
