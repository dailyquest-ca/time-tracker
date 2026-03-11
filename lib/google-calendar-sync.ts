import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from './db';
import {
  appConfig,
  calendarWatch,
  categories,
  events as eventsTable,
  googleTokens,
} from './schema';
import {
  createCalendarWatch,
  GoogleCalendarEvent,
  listCalendarEventsIncremental,
  listCalendarEventsWithSync,
  refreshGoogleToken,
  stopCalendarWatch,
  SyncTokenInvalidError,
} from './google';
import { recomputeDailyTotalsForDates } from './overtime';
import { resolveCategoryId, type CategoryRow } from './categorize';
import { ensureDefaultCategories } from './categories';

const USER_ID = 'default';
const ROLLING_PAST_DAYS = 90;
const ROLLING_FUTURE_DAYS = 30;

const SYNC_STATE_KEY = 'calendar_sync_state';
const LAST_SYNCED_KEY = 'last_synced_at';
const WEBHOOK_DEBOUNCE_KEY = 'webhook_sync_started_at';
const WEBHOOK_RECEIVED_KEY = 'last_webhook_received_at';
const LEGACY_WEBHOOK_RECEIVED_KEY = 'last_legacy_webhook_received_at';
const WEBHOOK_DEBOUNCE_MS = 30_000;

interface SyncState {
  calendarId: string;
  syncToken: string;
}

interface SyncResult {
  ok: boolean;
  error?: string;
  segmentsProcessed?: number;
  watchError?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB)
// ---------------------------------------------------------------------------

export function roundToNearest15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round(minutes / 15) * 15;
}

export function isAllDayEvent(event: GoogleCalendarEvent): boolean {
  return !event.start.dateTime;
}

export function eventDateKey(event: GoogleCalendarEvent): string {
  if (event.start.dateTime) {
    return new Date(event.start.dateTime).toISOString().slice(0, 10);
  }
  return event.start.date!;
}

export function eventDurationMinutes(event: GoogleCalendarEvent): number {
  const start = new Date(event.start.dateTime!).getTime();
  const end = new Date(event.end.dateTime!).getTime();
  return Math.round((end - start) / 60_000);
}

export function stableExternalId(event: GoogleCalendarEvent): string {
  if (event.recurringEventId && event.start.dateTime) {
    return `${event.recurringEventId}:${event.start.dateTime}`;
  }
  return event.id;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export async function getValidGoogleToken(): Promise<string | null> {
  const rows = await db
    .select()
    .from(googleTokens)
    .where(eq(googleTokens.userId, USER_ID))
    .limit(1);
  if (rows.length === 0) return null;

  const row = rows[0];
  const now = new Date();
  const bufferMs = 60 * 1000;

  if (new Date(row.expiresAt).getTime() - bufferMs > now.getTime()) {
    return row.accessToken;
  }

  if (!row.refreshToken?.trim()) {
    console.warn('[google-sync] No refresh token available');
    return null;
  }

  try {
    const refreshed = await refreshGoogleToken(row.refreshToken);
    const expiresAt = new Date(
      Date.now() + (refreshed.expires_in || 3600) * 1000,
    );
    await db
      .update(googleTokens)
      .set({
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || row.refreshToken,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(googleTokens.userId, USER_ID));
    return refreshed.access_token;
  } catch (err) {
    console.error(
      `[google-sync] Token refresh failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

export async function getWorkCalendarId(): Promise<string | null> {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, 'work_calendar_id'))
    .limit(1);
  const val = rows[0]?.value;
  return typeof val === 'string' ? val : null;
}

// ---------------------------------------------------------------------------
// Sync token persistence
// ---------------------------------------------------------------------------

async function getSyncState(): Promise<SyncState | null> {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, SYNC_STATE_KEY))
    .limit(1);
  const val = rows[0]?.value;
  if (!val || typeof val !== 'object') return null;
  const obj = val as Record<string, unknown>;
  if (typeof obj.calendarId !== 'string' || typeof obj.syncToken !== 'string')
    return null;
  return { calendarId: obj.calendarId, syncToken: obj.syncToken };
}

async function saveSyncState(state: SyncState): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: SYNC_STATE_KEY, value: state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: state, updatedAt: new Date() },
    });
}

async function clearSyncState(): Promise<void> {
  await db.delete(appConfig).where(eq(appConfig.key, SYNC_STATE_KEY));
}

// ---------------------------------------------------------------------------
// Webhook debounce
// ---------------------------------------------------------------------------

export async function shouldThrottleWebhookSync(): Promise<boolean> {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, WEBHOOK_DEBOUNCE_KEY))
    .limit(1);
  const val = rows[0]?.value;
  if (typeof val !== 'string') return false;
  const startedAt = new Date(val).getTime();
  return !isNaN(startedAt) && Date.now() - startedAt < WEBHOOK_DEBOUNCE_MS;
}

export async function stampWebhookSyncStarted(): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(appConfig)
    .values({ key: WEBHOOK_DEBOUNCE_KEY, value: now, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: now, updatedAt: new Date() },
    });
}

// ---------------------------------------------------------------------------
// Webhook receipt tracking
// ---------------------------------------------------------------------------

export async function stampWebhookReceived(): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(appConfig)
    .values({ key: WEBHOOK_RECEIVED_KEY, value: now, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: now, updatedAt: new Date() },
    });
}

export async function getLastWebhookReceivedAt(): Promise<string | null> {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, WEBHOOK_RECEIVED_KEY))
    .limit(1);
  const val = rows[0]?.value;
  return typeof val === 'string' ? val : null;
}

export async function stampLegacyWebhookReceived(): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(appConfig)
    .values({ key: LEGACY_WEBHOOK_RECEIVED_KEY, value: now, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: now, updatedAt: new Date() },
    });
}

export async function getLastLegacyWebhookReceivedAt(): Promise<string | null> {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, LEGACY_WEBHOOK_RECEIVED_KEY))
    .limit(1);
  const val = rows[0]?.value;
  return typeof val === 'string' ? val : null;
}

// ---------------------------------------------------------------------------
// Last-synced timestamp
// ---------------------------------------------------------------------------

export async function stampLastSyncedAt(): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(appConfig)
    .values({ key: LAST_SYNCED_KEY, value: now, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: now, updatedAt: new Date() },
    });
}

export async function getLastSyncedAt(): Promise<string | null> {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, LAST_SYNCED_KEY))
    .limit(1);
  const val = rows[0]?.value;
  return typeof val === 'string' ? val : null;
}

// ---------------------------------------------------------------------------
// Shared event processing
// ---------------------------------------------------------------------------

async function upsertGoogleEvent(
  event: GoogleCalendarEvent,
  calendarId: string,
  categoryRows: CategoryRow[],
): Promise<{ dateKey: string; categoryRows: CategoryRow[] }> {
  const dateKey = eventDateKey(event);
  const durationMinutes = roundToNearest15(eventDurationMinutes(event));
  const externalId = stableExternalId(event);
  const sourceId = `${calendarId}:${externalId}`;
  const title = event.summary ?? '';
  const prevLen = categoryRows.length;
  const categoryId = await resolveCategoryId(title, categoryRows);
  const lengthHours = (durationMinutes / 60).toFixed(2);

  const startTime = event.start.dateTime ? new Date(event.start.dateTime) : null;
  const endTime = event.end.dateTime ? new Date(event.end.dateTime) : null;

  await db
    .insert(eventsTable)
    .values({
      date: dateKey,
      name: title || 'Event',
      categoryId,
      lengthHours,
      sourceType: 'google',
      sourceId,
      sourceGroup: `google:${calendarId}`,
      startTime,
      endTime,
      rawTitle: title || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [eventsTable.sourceType, eventsTable.sourceId],
      set: {
        date: dateKey,
        name: title || 'Event',
        categoryId,
        lengthHours,
        startTime,
        endTime,
        rawTitle: title || null,
        updatedAt: new Date(),
      },
    });

  let updatedRows = categoryRows;
  if (
    !categoryRows.some((c) => c.id === categoryId) ||
    categoryRows.length !== prevLen
  ) {
    updatedRows = await db
      .select({ id: categories.id, name: categories.name, archived: categories.archived })
      .from(categories);
  }
  return { dateKey, categoryRows: updatedRows };
}

async function deleteGoogleEvent(
  event: GoogleCalendarEvent,
  calendarId: string,
): Promise<string | null> {
  const externalId = stableExternalId(event);
  const sourceId = `${calendarId}:${externalId}`;
  const existing = await db
    .select({ date: eventsTable.date })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.sourceType, 'google'),
        eq(eventsTable.sourceId, sourceId),
      ),
    )
    .limit(1);
  if (existing.length === 0) return null;
  await db
    .delete(eventsTable)
    .where(
      and(
        eq(eventsTable.sourceType, 'google'),
        eq(eventsTable.sourceId, sourceId),
      ),
    );
  return existing[0].date;
}

// ---------------------------------------------------------------------------
// Watch management
// ---------------------------------------------------------------------------

function getWebhookBaseUrl(): string {
  const url = process.env.APP_URL ?? process.env.VERCEL_URL;
  if (!url) return '';
  return url.startsWith('http') ? url : `https://${url}`;
}

export async function ensureCalendarWatch(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const accessToken = await getValidGoogleToken();
  if (!accessToken) return { ok: false, error: 'Not connected to Google.' };
  const calId = await getWorkCalendarId();
  if (!calId) return { ok: false, error: 'No work calendar selected.' };
  const base = getWebhookBaseUrl();
  if (!base) {
    console.warn('[watch] Not created: APP_URL and VERCEL_URL are both unset.');
    return { ok: false, error: 'APP_URL or VERCEL_URL not set; cannot create watch.' };
  }
  const address = `${base}/api/webhooks/google-calendar`;
  if (base.includes('localhost')) {
    console.warn('[watch] base URL contains localhost — Google cannot reach this.');
  }

  try {
    const existingRows = await db
      .select()
      .from(calendarWatch)
      .where(eq(calendarWatch.userId, USER_ID))
      .limit(1);

    if (existingRows.length > 0) {
      const old = existingRows[0];
      const stillValid =
        old.calendarId === calId &&
        new Date(old.expiration).getTime() - 24 * 60 * 60 * 1000 > Date.now();
      if (stillValid) {
        return { ok: true };
      }
      const stopResult = await stopCalendarWatch(accessToken, old.channelId, old.resourceId);
      if (!stopResult.ok) {
        console.warn(
          '[watch] Failed to stop old channel',
          old.channelId,
          `— creating new one anyway (${stopResult.status}${stopResult.httpStatus ? ` ${stopResult.httpStatus}` : ''}):`,
          stopResult.message ?? 'unknown error',
        );
      }
    }

    const channel = await createCalendarWatch(accessToken, calId, address, {
      ttlSeconds: 7 * 24 * 60 * 60 - 60,
    });
    const expiration = new Date(Number(channel.expiration));
    await db
      .insert(calendarWatch)
      .values({
        userId: USER_ID,
        calendarId: calId,
        channelId: channel.id,
        resourceId: channel.resourceId,
        expiration,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: calendarWatch.userId,
        set: {
          calendarId: calId,
          channelId: channel.id,
          resourceId: channel.resourceId,
          expiration,
          updatedAt: new Date(),
        },
      });
    console.log('[watch] Created: Google will POST to', address);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-sync] Watch create failed: ${message}`);
    return { ok: false, error: message };
  }
}

export async function getWatchStatus(): Promise<{
  status: 'active' | 'expiring_soon' | 'expired' | 'missing';
  expiration?: string;
  channelId?: string;
  resourceId?: string;
  lastWebhookAt?: string | null;
  lastLegacyWebhookAt?: string | null;
}> {
  const rows = await db
    .select()
    .from(calendarWatch)
    .where(eq(calendarWatch.userId, USER_ID))
    .limit(1);
  const lastWebhookAt = await getLastWebhookReceivedAt();
  const lastLegacyWebhookAt = await getLastLegacyWebhookReceivedAt();
  if (rows.length === 0) return { status: 'missing', lastWebhookAt, lastLegacyWebhookAt };
  const row = rows[0];
  const exp = new Date(row.expiration);
  const now = Date.now();
  const common = {
    expiration: exp.toISOString(),
    channelId: row.channelId,
    resourceId: row.resourceId,
    lastWebhookAt,
    lastLegacyWebhookAt,
  };
  if (exp.getTime() <= now)
    return { status: 'expired', ...common };
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (exp.getTime() - oneDayMs <= now)
    return { status: 'expiring_soon', ...common };
  return { status: 'active', ...common };
}

export async function forceRecreateWatch(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const accessToken = await getValidGoogleToken();
  if (!accessToken) return { ok: false, error: 'Not connected to Google.' };

  const existingRows = await db
    .select()
    .from(calendarWatch)
    .where(eq(calendarWatch.userId, USER_ID))
    .limit(1);
  if (existingRows.length > 0) {
    const old = existingRows[0];
    const stopResult = await stopCalendarWatch(accessToken, old.channelId, old.resourceId);
    if (!stopResult.ok) {
      console.warn(
        '[watch] Force recreate could not stop old channel',
        old.channelId,
        `(${stopResult.status}${stopResult.httpStatus ? ` ${stopResult.httpStatus}` : ''})`,
      );
    }
    await db.delete(calendarWatch).where(eq(calendarWatch.userId, USER_ID));
  }

  return ensureCalendarWatch();
}

export async function renewCalendarWatchIfNeeded(): Promise<boolean> {
  const rows = await db
    .select()
    .from(calendarWatch)
    .where(eq(calendarWatch.userId, USER_ID))
    .limit(1);
  if (rows.length === 0) return false;
  const row = rows[0];
  const oneDayMs = 24 * 60 * 60 * 1000;
  const expiring = new Date(row.expiration).getTime() - oneDayMs <= Date.now();

  const currentCalId = await getWorkCalendarId();
  const calendarChanged = currentCalId != null && row.calendarId !== currentCalId;

  if (!expiring && !calendarChanged) return false;
  const result = await ensureCalendarWatch();
  return result.ok;
}

async function ensureWatchIfNeeded(): Promise<string | undefined> {
  const watchResult = await ensureCalendarWatch().catch((e) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : String(e),
  }));
  if (!watchResult.ok) {
    console.warn('[google-sync] Watch ensure failed:', watchResult.error);
    return watchResult.error;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Incremental sync (webhook path)
// ---------------------------------------------------------------------------

export async function runGoogleCalendarSync(): Promise<SyncResult> {
  const accessToken = await getValidGoogleToken();
  if (!accessToken) {
    return { ok: false, error: 'Not connected to Google. Connect in Settings.' };
  }
  const calendarId = await getWorkCalendarId();
  if (!calendarId) {
    return { ok: false, error: 'No work calendar selected. Choose one in Settings.' };
  }

  try {
    await ensureDefaultCategories();

    const syncState = await getSyncState();
    const hasSyncToken =
      syncState && syncState.calendarId === calendarId && syncState.syncToken;

    if (hasSyncToken) {
      try {
        const { events, nextSyncToken } = await listCalendarEventsIncremental(
          accessToken,
          calendarId,
          syncState.syncToken,
        );

        let categoryRows: CategoryRow[] = await db
          .select({ id: categories.id, name: categories.name, archived: categories.archived })
          .from(categories);

        const affectedDates = new Set<string>();

        for (const event of events) {
          if (isAllDayEvent(event)) continue;

          if (event.status === 'cancelled') {
            const deletedDate = await deleteGoogleEvent(event, calendarId);
            if (deletedDate) affectedDates.add(deletedDate);
            continue;
          }

          const durationMinutes = roundToNearest15(eventDurationMinutes(event));
          if (durationMinutes <= 0) continue;

          const result = await upsertGoogleEvent(event, calendarId, categoryRows);
          affectedDates.add(result.dateKey);
          categoryRows = result.categoryRows;
        }

        if (nextSyncToken) {
          await saveSyncState({ calendarId, syncToken: nextSyncToken });
        }
        if (affectedDates.size > 0) {
          await recomputeDailyTotalsForDates(Array.from(affectedDates));
        }
        await stampLastSyncedAt();
        const watchError = await ensureWatchIfNeeded();
        return { ok: true, segmentsProcessed: events.length, watchError };
      } catch (err) {
        if (err instanceof SyncTokenInvalidError) {
          console.log('[google-sync] Sync token invalid (410), falling back to baseline');
          await clearSyncState();
        } else {
          throw err;
        }
      }
    }

    return await runBaselineSync(accessToken, calendarId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-sync] Error: ${message}`);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Baseline sync (initial load + 410 fallback)
// ---------------------------------------------------------------------------

async function runBaselineSync(
  accessToken: string,
  calendarId: string,
): Promise<SyncResult> {
  const now = Date.now();
  const timeMin = new Date(now - ROLLING_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now + ROLLING_FUTURE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { events: calendarEvents, nextSyncToken } =
    await listCalendarEventsWithSync(accessToken, calendarId, { timeMin, timeMax });

  const relevant = calendarEvents.filter(
    (e) => !isAllDayEvent(e) && e.status !== 'cancelled',
  );

  let categoryRows: CategoryRow[] = await db
    .select({ id: categories.id, name: categories.name, archived: categories.archived })
    .from(categories);

  const affectedDates = new Set<string>();
  const seenKeys = new Set<string>();

  for (const event of relevant) {
    const durationMinutes = roundToNearest15(eventDurationMinutes(event));
    if (durationMinutes <= 0) continue;

    const externalId = stableExternalId(event);
    const sourceId = `${calendarId}:${externalId}`;
    seenKeys.add(sourceId);

    const result = await upsertGoogleEvent(event, calendarId, categoryRows);
    affectedDates.add(result.dateKey);
    categoryRows = result.categoryRows;
  }

  const minDate = new Date(timeMin.slice(0, 10)).toISOString().slice(0, 10);
  const maxDate = new Date(timeMax.slice(0, 10)).toISOString().slice(0, 10);

  const existingInRange = await db
    .select({ sourceId: eventsTable.sourceId, date: eventsTable.date })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.sourceType, 'google'),
        gte(eventsTable.date, minDate),
        lte(eventsTable.date, maxDate),
      ),
    );

  for (const row of existingInRange) {
    if (!seenKeys.has(row.sourceId)) {
      await db
        .delete(eventsTable)
        .where(
          and(
            eq(eventsTable.sourceType, 'google'),
            eq(eventsTable.sourceId, row.sourceId),
          ),
        );
      affectedDates.add(row.date);
    }
  }

  if (nextSyncToken) {
    await saveSyncState({ calendarId, syncToken: nextSyncToken });
  }
  if (affectedDates.size > 0) {
    await recomputeDailyTotalsForDates(Array.from(affectedDates));
  }
  await stampLastSyncedAt();
  const watchError = await ensureWatchIfNeeded();
  return { ok: true, segmentsProcessed: relevant.length, watchError };
}

// ---------------------------------------------------------------------------
// Full reconciliation (cron safety net)
// ---------------------------------------------------------------------------

export async function runFullReconciliation(): Promise<SyncResult> {
  const accessToken = await getValidGoogleToken();
  if (!accessToken) {
    return { ok: false, error: 'Not connected to Google. Connect in Settings.' };
  }
  const calendarId = await getWorkCalendarId();
  if (!calendarId) {
    return { ok: false, error: 'No work calendar selected. Choose one in Settings.' };
  }

  try {
    await ensureDefaultCategories();
    return await runBaselineSync(accessToken, calendarId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-sync] Reconciliation error: ${message}`);
    return { ok: false, error: message };
  }
}
