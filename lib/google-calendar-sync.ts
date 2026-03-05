import { eq } from 'drizzle-orm';
import { db } from './db';
import { googleTokens, workSegments } from './schema';
import {
  GoogleCalendarEvent,
  listCalendarEvents,
  refreshGoogleToken,
} from './google';
import { recomputeDailyTotalsForDates } from './overtime';

const USER_ID = 'default';
const ROLLING_PAST_DAYS = 60;
const ROLLING_FUTURE_DAYS = 14;

function roundToNearest15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round(minutes / 15) * 15;
}

async function getValidGoogleToken(): Promise<string | null> {
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

/**
 * Build a stable externalId for deduplication.
 * For recurring event instances we combine recurringEventId + start time
 * so each instance gets its own row. For single events, just the event id.
 */
function stableExternalId(event: GoogleCalendarEvent): string {
  if (event.recurringEventId && event.start.dateTime) {
    return `${event.recurringEventId}:${event.start.dateTime}`;
  }
  return event.id;
}

const CATEGORY_DESC_RE = /^category:\s*(.+)$/im;
const CATEGORY_TITLE_RE = /^\[([^\]]+)\]\s*/;

/**
 * Extract category from event description (preferred) or title prefix (fallback).
 */
function extractCategory(event: GoogleCalendarEvent): string {
  if (event.description) {
    const match = event.description.match(CATEGORY_DESC_RE);
    if (match) return match[1].trim();
  }
  const title = event.summary ?? '';
  const titleMatch = title.match(CATEGORY_TITLE_RE);
  if (titleMatch) return titleMatch[1].trim();

  return '(uncategorized)';
}

function cleanTitle(event: GoogleCalendarEvent): string {
  const raw = event.summary ?? '';
  return raw.replace(CATEGORY_TITLE_RE, '').trim() || raw;
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

  try {
    const now = Date.now();
    const timeMin = new Date(
      now - ROLLING_PAST_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const timeMax = new Date(
      now + ROLLING_FUTURE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    console.log(
      `[google-sync] Fetching events from ${timeMin.slice(0, 10)} to ${timeMax.slice(0, 10)}…`,
    );

    const events = await listCalendarEvents(accessToken, { timeMin, timeMax });

    const relevant = events.filter(
      (e) =>
        !isAllDayEvent(e) &&
        e.status !== 'cancelled',
    );

    console.log(
      `[google-sync] Got ${events.length} event(s), ${relevant.length} relevant (non-allday, non-cancelled)`,
    );

    const affectedDates = new Set<string>();
    let segmentsProcessed = 0;

    for (const event of relevant) {
      const dateKey = eventDateKey(event);
      const durationMinutes = roundToNearest15(eventDurationMinutes(event));
      if (durationMinutes <= 0) continue;

      const category = extractCategory(event);
      const externalId = stableExternalId(event);
      const taskTitle = cleanTitle(event);

      affectedDates.add(dateKey);

      await db
        .insert(workSegments)
        .values({
          externalId,
          date: dateKey,
          taskTitle: taskTitle || null,
          category,
          durationMinutes,
          source: 'google_calendar',
          startAt: new Date(event.start.dateTime!),
          endAt: new Date(event.end.dateTime!),
        })
        .onConflictDoUpdate({
          target: [
            workSegments.source,
            workSegments.externalId,
            workSegments.date,
          ],
          set: {
            taskTitle: taskTitle || null,
            category,
            durationMinutes,
            startAt: new Date(event.start.dateTime!),
            endAt: new Date(event.end.dateTime!),
            syncedAt: new Date(),
          },
        });
      segmentsProcessed++;
    }

    if (affectedDates.size > 0) {
      await recomputeDailyTotalsForDates(Array.from(affectedDates));
    }

    console.log(
      `[google-sync] Processed ${segmentsProcessed} segment(s) across ${affectedDates.size} date(s)`,
    );

    return { ok: true, segmentsProcessed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-sync] Error: ${message}`);
    return { ok: false, error: message };
  }
}
