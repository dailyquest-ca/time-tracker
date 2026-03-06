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
  listCalendarEvents,
  refreshGoogleToken,
  stopCalendarWatch,
} from './google';
import { recomputeDailyTotalsForDates } from './overtime';
import { resolveCategoryId, type CategoryRow } from './categorize';
import { ensureDefaultCategories } from './categories';

const USER_ID = 'default';
const ROLLING_PAST_DAYS = 90;
const ROLLING_FUTURE_DAYS = 30;

export function roundToNearest15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round(minutes / 15) * 15;
}

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

export async function runGoogleCalendarSync(): Promise<{
  ok: boolean;
  error?: string;
  segmentsProcessed?: number;
  watchError?: string;
}> {
  const accessToken = await getValidGoogleToken();
  if (!accessToken) {
    return {
      ok: false,
      error: 'Not connected to Google. Connect in Settings.',
    };
  }

  const calendarId = await getWorkCalendarId();
  if (!calendarId) {
    return {
      ok: false,
      error: 'No work calendar selected. Choose one in Settings.',
    };
  }

  try {
    await ensureDefaultCategories();

    const now = Date.now();
    const timeMin = new Date(
      now - ROLLING_PAST_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const timeMax = new Date(
      now + ROLLING_FUTURE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const calendarEvents = await listCalendarEvents(accessToken, calendarId, {
      timeMin,
      timeMax,
    });

    const relevant = calendarEvents.filter(
      (e) => !isAllDayEvent(e) && e.status !== 'cancelled',
    );

    let categoryRows: CategoryRow[] = await db
      .select({
        id: categories.id,
        name: categories.name,
        archived: categories.archived,
      })
      .from(categories);

    const affectedDates = new Set<string>();
    const seenKeys = new Set<string>();

    for (const event of relevant) {
      const dateKey = eventDateKey(event);
      const durationMinutes = roundToNearest15(eventDurationMinutes(event));
      if (durationMinutes <= 0) continue;

      const externalId = stableExternalId(event);
      const sourceId = `${calendarId}:${externalId}`;
      const key = `${sourceId}`;
      seenKeys.add(key);

      const title = event.summary ?? '';
      const prevCategoryCount = categoryRows.length;
      const categoryId = await resolveCategoryId(title, categoryRows);
      const lengthHours = (durationMinutes / 60).toFixed(2);

      const startTime = event.start.dateTime
        ? new Date(event.start.dateTime)
        : null;
      const endTime = event.end.dateTime
        ? new Date(event.end.dateTime)
        : null;

      affectedDates.add(dateKey);

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

      if (!categoryRows.some((c) => c.id === categoryId) || categoryRows.length !== prevCategoryCount) {
        categoryRows = await db
          .select({
            id: categories.id,
            name: categories.name,
            archived: categories.archived,
          })
          .from(categories);
      }
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
        )
      );

    for (const row of existingInRange) {
      if (!seenKeys.has(row.sourceId)) {
        await db
          .delete(eventsTable)
          .where(
            and(
              eq(eventsTable.sourceType, 'google'),
              eq(eventsTable.sourceId, row.sourceId),
            )
          );
        affectedDates.add(row.date);
      }
    }

    if (affectedDates.size > 0) {
      await recomputeDailyTotalsForDates(Array.from(affectedDates));
    }

    await stampLastSyncedAt();

    let watchError: string | undefined;
    const watchRows = await db
      .select()
      .from(calendarWatch)
      .where(eq(calendarWatch.userId, USER_ID))
      .limit(1);
    const watchValid =
      watchRows.length > 0 &&
      new Date(watchRows[0].expiration).getTime() > Date.now();
    if (!watchValid) {
      const watchResult = await ensureCalendarWatch().catch((e) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!watchResult.ok) {
        watchError = watchResult.error;
        console.warn('[google-sync] Watch ensure failed:', watchError);
      }
    }

    return { ok: true, segmentsProcessed: relevant.length, watchError };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-sync] Error: ${message}`);
    return { ok: false, error: message };
  }
}

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
  if (!accessToken) {
    return { ok: false, error: 'Not connected to Google.' };
  }
  const calId = await getWorkCalendarId();
  if (!calId) {
    return { ok: false, error: 'No work calendar selected.' };
  }
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
      await stopCalendarWatch(accessToken, old.channelId, old.resourceId);
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
    console.warn('[watch] Created: Google will POST to', address);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[google-sync] Watch create failed: ${message}`,
      '\n  address:', address,
      '\n  calendarId:', calId,
      err instanceof Error && 'cause' in err ? `\n  cause: ${err.cause}` : '',
    );
    return { ok: false, error: message };
  }
}

const LAST_SYNCED_KEY = 'last_synced_at';

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

export async function getWatchStatus(): Promise<{
  status: 'active' | 'expiring_soon' | 'expired' | 'missing';
  expiration?: string;
}> {
  const rows = await db
    .select()
    .from(calendarWatch)
    .where(eq(calendarWatch.userId, USER_ID))
    .limit(1);
  if (rows.length === 0) return { status: 'missing' };
  const row = rows[0];
  const exp = new Date(row.expiration);
  const now = Date.now();
  if (exp.getTime() <= now) {
    return { status: 'expired', expiration: exp.toISOString() };
  }
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (exp.getTime() - oneDayMs <= now) {
    return { status: 'expiring_soon', expiration: exp.toISOString() };
  }
  return { status: 'active', expiration: exp.toISOString() };
}

export async function renewCalendarWatchIfNeeded(): Promise<boolean> {
  const rows = await db.select().from(calendarWatch).where(eq(calendarWatch.userId, USER_ID)).limit(1);
  if (rows.length === 0) return false;
  const row = rows[0];
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (new Date(row.expiration).getTime() - oneDayMs > now.getTime()) {
    return false;
  }
  const result = await ensureCalendarWatch();
  return result.ok;
}
