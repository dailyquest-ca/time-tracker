import { eq } from 'drizzle-orm';
import { db } from './db';
import { microsoftTokens, syncState, workSegments } from './schema';
import {
  getCalendarEventsDelta,
  GraphCalendarEvent,
  refreshMicrosoftToken,
} from './microsoft';
import { recomputeDailyTotalsForDates } from './overtime';

const USER_ID = 'default';

function roundToNearest15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round(minutes / 15) * 15;
}

async function getValidMicrosoftToken(): Promise<string | null> {
  const rows = await db
    .select()
    .from(microsoftTokens)
    .where(eq(microsoftTokens.userId, USER_ID))
    .limit(1);
  if (rows.length === 0) return null;

  const row = rows[0];
  const now = new Date();
  const bufferMs = 60 * 1000;

  if (new Date(row.expiresAt).getTime() - bufferMs > now.getTime()) {
    return row.accessToken;
  }

  if (!row.refreshToken?.trim()) {
    console.warn('[calendar-sync] No refresh token available');
    return null;
  }

  try {
    const refreshed = await refreshMicrosoftToken(row.refreshToken);
    const expiresAt = new Date(
      Date.now() + (refreshed.expires_in || 3600) * 1000,
    );
    await db
      .update(microsoftTokens)
      .set({
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || row.refreshToken,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(microsoftTokens.userId, USER_ID));
    return refreshed.access_token;
  } catch (err) {
    console.error(
      `[calendar-sync] Token refresh failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

function eventToDateKey(event: GraphCalendarEvent): string {
  const d = new Date(event.start.dateTime + 'Z');
  return d.toISOString().slice(0, 10);
}

function eventDurationMinutes(event: GraphCalendarEvent): number {
  const start = new Date(event.start.dateTime + 'Z').getTime();
  const end = new Date(event.end.dateTime + 'Z').getTime();
  return Math.round((end - start) / 60_000);
}

export async function runCalendarSync(): Promise<{
  ok: boolean;
  error?: string;
  segmentsProcessed?: number;
}> {
  const accessToken = await getValidMicrosoftToken();
  if (!accessToken) {
    return {
      ok: false,
      error: 'Not connected to Microsoft. Connect in Settings.',
    };
  }

  try {
    const [stateRow] = await db
      .select()
      .from(syncState)
      .where(eq(syncState.userId, USER_ID))
      .limit(1);
    const deltaLink = stateRow?.microsoftDeltaLink ?? null;

    console.log(
      `[calendar-sync] Fetching calendar events (delta=${!!deltaLink})…`,
    );

    const { events, nextDeltaLink } = await getCalendarEventsDelta(
      accessToken,
      { deltaLink },
    );

    const relevantEvents = events.filter(
      (e) => !e.isAllDay && !e.isCancelled,
    );

    console.log(
      `[calendar-sync] Graph returned ${events.length} event(s), ${relevantEvents.length} relevant (non-allday, non-cancelled)`,
    );

    const affectedDates = new Set<string>();
    let segmentsProcessed = 0;

    for (const event of relevantEvents) {
      const dateKey = eventToDateKey(event);
      const durationMinutes = roundToNearest15(eventDurationMinutes(event));
      if (durationMinutes <= 0) continue;

      const category =
        event.categories.length > 0
          ? event.categories[0]
          : '(uncategorized)';

      affectedDates.add(dateKey);

      await db
        .insert(workSegments)
        .values({
          externalId: event.id,
          date: dateKey,
          taskTitle: event.subject || null,
          category,
          durationMinutes,
          source: 'calendar',
          startAt: new Date(event.start.dateTime + 'Z'),
          endAt: new Date(event.end.dateTime + 'Z'),
        })
        .onConflictDoUpdate({
          target: [
            workSegments.source,
            workSegments.externalId,
            workSegments.date,
          ],
          set: {
            taskTitle: event.subject || null,
            category,
            durationMinutes,
            startAt: new Date(event.start.dateTime + 'Z'),
            endAt: new Date(event.end.dateTime + 'Z'),
            syncedAt: new Date(),
          },
        });
      segmentsProcessed++;
    }

    const now = new Date();
    if (nextDeltaLink) {
      await db
        .insert(syncState)
        .values({
          userId: USER_ID,
          microsoftDeltaLink: nextDeltaLink,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: syncState.userId,
          set: { microsoftDeltaLink: nextDeltaLink, updatedAt: now },
        });
    }

    if (affectedDates.size > 0) {
      await recomputeDailyTotalsForDates(Array.from(affectedDates));
    }

    return { ok: true, segmentsProcessed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[calendar-sync] Error: ${message}`);
    return { ok: false, error: message };
  }
}
