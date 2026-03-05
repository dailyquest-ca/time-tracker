import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from './db';
import {
  appConfig,
  calendarWatch,
  categories,
  googleTokens,
  workSegments,
} from './schema';
import {
  createCalendarWatch,
  GoogleCalendarEvent,
  listCalendarEvents,
  refreshGoogleToken,
} from './google';
import { recomputeDailyTotalsForDates } from './overtime';
import { resolveCategory, type CategoryRow } from './categorize';
import { ensureDefaultCategories } from './categories';

const USER_ID = 'default';
const ROLLING_PAST_DAYS = 90;
const ROLLING_FUTURE_DAYS = 30;

function roundToNearest15(minutes: number): number {
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

function isAllDayEvent(event: GoogleCalendarEvent): boolean {
  return !event.start.dateTime;
}

function eventDateKey(event: GoogleCalendarEvent): string {
  if (event.start.dateTime) {
    return new Date(event.start.dateTime).toISOString().slice(0, 10);
  }
  return event.start.date!;
}

function eventDurationMinutes(event: GoogleCalendarEvent): number {
  const start = new Date(event.start.dateTime!).getTime();
  const end = new Date(event.end.dateTime!).getTime();
  return Math.round((end - start) / 60_000);
}

/** Stable external id for deduplication: event id or recurring instance id. */
function stableExternalId(event: GoogleCalendarEvent): string {
  if (event.recurringEventId && event.start.dateTime) {
    return `${event.recurringEventId}:${event.start.dateTime}`;
  }
  return event.id;
}

export async function runGoogleCalendarSync(): Promise<{
  ok: boolean;
  error?: string;
  segmentsProcessed?: number;
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

    const events = await listCalendarEvents(accessToken, calendarId, {
      timeMin,
      timeMax,
    });

    const relevant = events.filter(
      (e) => !isAllDayEvent(e) && e.status !== 'cancelled',
    );

    const categoryRows: CategoryRow[] = await db
      .select({ id: categories.id, name: categories.name, archived: categories.archived })
      .from(categories);
    const affectedDates = new Set<string>();
    const seenKeys = new Set<string>();

    for (const event of relevant) {
      const dateKey = eventDateKey(event);
      const durationMinutes = roundToNearest15(eventDurationMinutes(event));
      if (durationMinutes <= 0) continue;

      const externalId = stableExternalId(event);
      const key = `${calendarId}:${externalId}:${dateKey}`;
      seenKeys.add(key);

      const title = event.summary ?? '';
      const category = resolveCategory(title, categoryRows);

      affectedDates.add(dateKey);

      await db
        .insert(workSegments)
        .values({
          calendarId,
          externalId,
          date: dateKey,
          title: title || null,
          category,
          durationMinutes,
          startAt: new Date(event.start.dateTime!),
          endAt: new Date(event.end.dateTime!),
        })
        .onConflictDoUpdate({
          target: [workSegments.calendarId, workSegments.externalId, workSegments.date],
          set: {
            title: title || null,
            category,
            durationMinutes,
            startAt: new Date(event.start.dateTime!),
            endAt: new Date(event.end.dateTime!),
            syncedAt: new Date(),
          },
        });
    }

    const minDate = new Date(timeMin.slice(0, 10)).toISOString().slice(0, 10);
    const maxDate = new Date(timeMax.slice(0, 10)).toISOString().slice(0, 10);

    const existingInRange = await db
      .select({ externalId: workSegments.externalId, date: workSegments.date })
      .from(workSegments)
      .where(
        and(
          eq(workSegments.calendarId, calendarId),
          gte(workSegments.date, minDate),
          lte(workSegments.date, maxDate),
        )
      );

    for (const row of existingInRange) {
      const key = `${calendarId}:${row.externalId}:${row.date}`;
      if (!seenKeys.has(key)) {
        await db
          .delete(workSegments)
          .where(
            and(
              eq(workSegments.calendarId, calendarId),
              eq(workSegments.externalId, row.externalId),
              eq(workSegments.date, row.date),
            )
          );
        affectedDates.add(row.date);
      }
    }

    if (affectedDates.size > 0) {
      await recomputeDailyTotalsForDates(Array.from(affectedDates));
    }

    await ensureCalendarWatch().catch((e) =>
      console.warn('[google-sync] Watch ensure failed:', e),
    );

    return { ok: true, segmentsProcessed: relevant.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-sync] Error: ${message}`);
    return { ok: false, error: message };
  }
}

/** Base URL for webhook (e.g. https://your-app.vercel.app). */
function getWebhookBaseUrl(): string {
  const url = process.env.APP_URL ?? process.env.VERCEL_URL;
  if (!url) return '';
  return url.startsWith('http') ? url : `https://${url}`;
}

/**
 * Create or replace the calendar watch so we get push notifications on calendar changes.
 */
export async function ensureCalendarWatch(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const accessToken = await getValidGoogleToken();
  if (!accessToken) {
    return { ok: false, error: 'Not connected to Google.' };
  }
  const calendarId = await getWorkCalendarId();
  if (!calendarId) {
    return { ok: false, error: 'No work calendar selected.' };
  }
  const base = getWebhookBaseUrl();
  if (!base) {
    return { ok: false, error: 'APP_URL or VERCEL_URL not set; cannot create watch.' };
  }
  const address = `${base}/api/webhooks/google-calendar`;
  try {
    const channel = await createCalendarWatch(accessToken, calendarId, address, {
      ttlSeconds: 7 * 24 * 60 * 60 - 60,
    });
    const expiration = new Date(Number(channel.expiration));
    await db
      .insert(calendarWatch)
      .values({
        userId: USER_ID,
        calendarId,
        channelId: channel.id,
        resourceId: channel.resourceId,
        expiration,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: calendarWatch.userId,
        set: {
          calendarId,
          channelId: channel.id,
          resourceId: channel.resourceId,
          expiration,
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-sync] Watch create failed: ${message}`);
    return { ok: false, error: message };
  }
}

/** Renew the calendar watch if it expires within the next 24 hours. */
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
