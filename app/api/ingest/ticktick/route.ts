/**
 * Ingest endpoint for TickTick items.
 *
 * TickTick is read over the **MCP connector**, which is OAuth-bound to the user's
 * Claude account and cannot be called from this app's runtime. A scheduled Claude
 * session does the polling and POSTs batches here, authenticated with the shared
 * `INGEST_SECRET` — the same pattern the calendar ingest webhook uses.
 *
 * Writes are idempotent: events are keyed on (sourceType, sourceId) so re-posting
 * the same batch updates rows in place rather than duplicating them.
 */
import { getOrCreateCategoryByName } from '@/lib/categories';
import { db } from '@/lib/db';
import { recomputeDailyTotalsForDates } from '@/lib/overtime';
import { events as eventsTable } from '@/lib/schema';
import {
  selectIngestableItems,
  todayInVancouver,
  type IngestList,
} from '@/lib/ticktick';
import { and, eq, gte, inArray, not } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOURCE_TYPE = 'ticktick';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface IngestBody {
  lists: IngestList[];
  /** Vancouver day to treat as "today"; defaults to the server's current day. */
  today?: string;
  /**
   * Remove previously-synced TickTick events dated today or later that are no
   * longer present in this batch (deleted or rescheduled upstream). Past events
   * are never pruned, so completed work is preserved.
   */
  prune?: boolean;
}

function parseBody(raw: unknown): { body: IngestBody } | { error: string } {
  if (raw == null || typeof raw !== 'object') {
    return { error: 'Body must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.lists)) {
    return { error: 'Body must include "lists" (array)' };
  }

  const lists: IngestList[] = [];
  for (const entry of obj.lists) {
    if (entry == null || typeof entry !== 'object') {
      return { error: 'Each entry in "lists" must be an object' };
    }
    const list = entry as Record<string, unknown>;
    if (typeof list.id !== 'string' || list.id.trim() === '') {
      return { error: 'Each list requires a string "id"' };
    }
    if (typeof list.name !== 'string' || list.name.trim() === '') {
      return { error: 'Each list requires a string "name"' };
    }
    if (list.tasks != null && !Array.isArray(list.tasks)) {
      return { error: 'A list\'s "tasks" must be an array when present' };
    }
    lists.push({
      id: list.id,
      name: list.name,
      tasks: (list.tasks ?? []) as IngestList['tasks'],
    });
  }

  if (obj.today != null) {
    if (typeof obj.today !== 'string' || !DATE_RE.test(obj.today)) {
      return { error: 'Field "today" must be a date in YYYY-MM-DD format' };
    }
  }

  return {
    body: {
      lists,
      today: obj.today as string | undefined,
      prune: obj.prune === true,
    },
  };
}

export async function POST(request: NextRequest) {
  const ingestSecret = process.env.INGEST_SECRET;
  if (!ingestSecret) {
    // Do not name the variable in the response — see .cursor/rules/api-routes.mdc.
    console.error('[ingest/ticktick] Shared ingest secret is not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${ingestSecret}`) {
    console.warn('[ingest/ticktick] Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { lists, today: requestedToday, prune } = parsed.body;

  try {
    const today = requestedToday ?? todayInVancouver();
    const items = selectIngestableItems(lists, today);

    const affectedDates = new Set<string>();
    const categoryIds = new Map<string, number>();
    const seenSourceIds: string[] = [];

    for (const item of items) {
      let categoryId = categoryIds.get(item.categoryName);
      if (categoryId === undefined) {
        categoryId = await getOrCreateCategoryByName(item.categoryName);
        categoryIds.set(item.categoryName, categoryId);
      }

      const title = item.task.title?.trim() || 'TickTick task';
      const lengthHours = (item.durationMinutes / 60).toFixed(2);
      const startTime = item.task.startDate ? new Date(item.task.startDate) : null;
      const endTime = item.task.dueDate ? new Date(item.task.dueDate) : null;
      const sourceId = item.task.id;

      await db
        .insert(eventsTable)
        .values({
          date: item.dateKey,
          name: title,
          categoryId,
          lengthHours,
          sourceType: SOURCE_TYPE,
          sourceId,
          sourceGroup: `${SOURCE_TYPE}:${item.listId}`,
          startTime,
          endTime,
          rawTitle: title,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [eventsTable.sourceType, eventsTable.sourceId],
          set: {
            date: item.dateKey,
            name: title,
            categoryId,
            lengthHours,
            sourceGroup: `${SOURCE_TYPE}:${item.listId}`,
            startTime,
            endTime,
            rawTitle: title,
            updatedAt: new Date(),
          },
        });

      seenSourceIds.push(sourceId);
      affectedDates.add(item.dateKey);
    }

    let pruned = 0;
    if (prune) {
      const stale = await db
        .select({ sourceId: eventsTable.sourceId, date: eventsTable.date })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.sourceType, SOURCE_TYPE),
            gte(eventsTable.date, today),
            seenSourceIds.length > 0
              ? not(inArray(eventsTable.sourceId, seenSourceIds))
              : undefined,
          ),
        );

      for (const row of stale) {
        await db
          .delete(eventsTable)
          .where(
            and(
              eq(eventsTable.sourceType, SOURCE_TYPE),
              eq(eventsTable.sourceId, row.sourceId),
            ),
          );
        affectedDates.add(row.date);
        pruned += 1;
      }
    }

    const dates = Array.from(affectedDates).sort();
    if (dates.length > 0) {
      await recomputeDailyTotalsForDates(dates);
    }

    console.log(
      `[ingest/ticktick] ${items.length} ingested, ${pruned} pruned across ${dates.length} date(s)`,
    );

    return NextResponse.json({
      ok: true,
      ingested: items.length,
      pruned,
      dates,
      today,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest/ticktick] Error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
