/**
 * TickTick sync: pull scheduled work from the WSBC folder into `events`.
 *
 * Additive — the Google Calendar pipeline is untouched and runs in parallel.
 * Idempotent — a run with no upstream changes performs zero writes, because each
 * row stores the task's upstream `etag` and unchanged rows are skipped.
 *
 * Lists are resolved by folder membership, never a hardcoded id table, so a list
 * added to the WSBC folder later is picked up with no code change.
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from './db';
import { getOrCreateCategoryByName } from './categories';
import { roundToNearest15 } from './google-calendar-sync';
import { recomputeDailyTotalsForDates } from './overtime';
import { events as eventsTable } from './schema';
import { TickTickClient, TickTickNotConnectedError } from './ticktick-client';
import {
  selectFolderLists,
  selectIngestableItems,
  type IngestList,
  type TickTickTask,
} from './ticktick';

const SOURCE_TYPE = 'ticktick';
const TRACKING_TIME_ZONE = 'America/Vancouver';

/** The WSBC folder ("project group") in TickTick. Override only for testing. */
const WSBC_FOLDER_ID =
  process.env.TICKTICK_WSBC_FOLDER_ID?.trim() || '6a7a7032e42bdd11f74ff016';

const DEFAULT_LOOKBACK_DAYS = 7;
const FUTURE_DAYS = 2;
/** Beyond this, a "time block" is almost certainly a mistake — imported, but flagged. */
const IMPLAUSIBLE_DURATION_MINUTES = 12 * 60;

export interface TickTickSyncResult {
  ok: boolean;
  error?: string;
  fetched?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  deleted?: number;
  datesRecomputed?: number;
  lists?: number;
}

function lookbackDays(): number {
  const raw = Number(process.env.TICKTICK_LOOKBACK_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LOOKBACK_DAYS;
}

/** Entries starting before this date are ignored entirely. */
function cutoverDate(): string | null {
  const raw = process.env.TICKTICK_CUTOVER_DATE?.trim();
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function dateKeyInVancouver(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TRACKING_TIME_ZONE });
}

/** Vancouver's UTC offset right now, e.g. "-07:00". */
function vancouverOffset(at: Date): string {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: TRACKING_TIME_ZONE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  return label?.replace('GMT', '') || '-08:00';
}

export interface SyncWindow {
  /** Inclusive date keys used for database reconciliation. */
  startDateKey: string;
  endDateKey: string;
  /** ISO datetimes with offset, as the MCP server expects. */
  startIso: string;
  endIso: string;
}

/**
 * The window each run reconciles. Rows outside it are frozen history and are
 * never deleted, so completed work from earlier runs is preserved.
 */
export function computeSyncWindow(
  now: Date,
  options: { lookbackDays: number; futureDays: number; cutover?: string | null },
): SyncWindow {
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(now.getTime() - options.lookbackDays * dayMs);
  const end = new Date(now.getTime() + options.futureDays * dayMs);

  let startDateKey = dateKeyInVancouver(start);
  const endDateKey = dateKeyInVancouver(end);
  if (options.cutover && options.cutover > startDateKey) {
    startDateKey = options.cutover;
  }

  const offset = vancouverOffset(now);
  return {
    startDateKey,
    endDateKey,
    startIso: `${startDateKey}T00:00:00${offset}`,
    endIso: `${endDateKey}T23:59:59${offset}`,
  };
}

/** Group a flat task list back under the list it belongs to. */
export function groupTasksByList(
  lists: Array<{ id: string; name: string }>,
  tasks: TickTickTask[],
): IngestList[] {
  const byId = new Map<string, IngestList>(
    lists.map((l) => [l.id, { id: l.id, name: l.name, tasks: [] }]),
  );
  for (const task of tasks) {
    byId.get(task.projectId)?.tasks.push(task);
  }
  return Array.from(byId.values());
}

export async function runTickTickSync(): Promise<TickTickSyncResult> {
  let client: TickTickClient;
  try {
    client = await TickTickClient.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof TickTickNotConnectedError) {
      console.error(`[ticktick-sync] Not connected: ${message}`);
      return { ok: false, error: message };
    }
    console.error(`[ticktick-sync] Connect failed: ${message}`);
    return { ok: false, error: message };
  }

  try {
    const projects = await client.listProjects();
    const lists = selectFolderLists(projects, WSBC_FOLDER_ID);
    if (lists.length === 0) {
      console.warn(
        `[ticktick-sync] No task lists found in folder ${WSBC_FOLDER_ID}; nothing to sync.`,
      );
      return { ok: true, lists: 0, fetched: 0, inserted: 0, updated: 0, skipped: 0, deleted: 0 };
    }

    const now = new Date();
    const cutover = cutoverDate();
    const window = computeSyncWindow(now, {
      lookbackDays: lookbackDays(),
      futureDays: FUTURE_DAYS,
      cutover,
    });

    const tasks = await client.filterTasks({
      projectIds: lists.map((l) => l.id),
      startDate: window.startIso,
      endDate: window.endIso,
    });

    const grouped = groupTasksByList(
      lists.map((l) => ({ id: l.id, name: l.name })),
      tasks,
    );
    // The floor is the cutover when set, otherwise the window start.
    const items = selectIngestableItems(grouped, cutover ?? window.startDateKey);

    const existing = await db
      .select({
        sourceId: eventsTable.sourceId,
        date: eventsTable.date,
        sourceEtag: eventsTable.sourceEtag,
      })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.sourceType, SOURCE_TYPE),
          gte(eventsTable.date, window.startDateKey),
          lte(eventsTable.date, window.endDateKey),
        ),
      );
    const existingById = new Map(existing.map((r) => [r.sourceId, r]));

    const affectedDates = new Set<string>();
    const categoryIds = new Map<string, number>();
    const seen = new Set<string>();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      const sourceId = item.task.id;
      seen.add(sourceId);

      const prior = existingById.get(sourceId);
      const etag = item.task.etag ?? null;
      if (prior && etag && prior.sourceEtag === etag && prior.date === item.dateKey) {
        skipped += 1;
        continue;
      }

      let categoryId = categoryIds.get(item.categoryName);
      if (categoryId === undefined) {
        categoryId = await getOrCreateCategoryByName(item.categoryName);
        categoryIds.set(item.categoryName, categoryId);
      }

      const minutes = roundToNearest15(item.durationMinutes);
      if (minutes <= 0) {
        skipped += 1;
        continue;
      }
      if (item.durationMinutes > IMPLAUSIBLE_DURATION_MINUTES) {
        console.warn(
          `[ticktick-sync] Task "${item.task.title}" spans ${(item.durationMinutes / 60).toFixed(1)}h — importing anyway.`,
        );
      }

      const title = item.task.title?.trim() || 'TickTick task';
      const values = {
        date: item.dateKey,
        name: title,
        categoryId,
        lengthHours: (minutes / 60).toFixed(2),
        sourceType: SOURCE_TYPE,
        sourceId,
        sourceGroup: `${SOURCE_TYPE}:${item.listId}`,
        startTime: item.task.startDate ? new Date(item.task.startDate) : null,
        endTime: item.task.dueDate ? new Date(item.task.dueDate) : null,
        rawTitle: title,
        sourceEtag: etag,
        updatedAt: new Date(),
      };

      await db
        .insert(eventsTable)
        .values(values)
        .onConflictDoUpdate({
          target: [eventsTable.sourceType, eventsTable.sourceId],
          set: {
            date: values.date,
            name: values.name,
            categoryId: values.categoryId,
            lengthHours: values.lengthHours,
            sourceGroup: values.sourceGroup,
            startTime: values.startTime,
            endTime: values.endTime,
            rawTitle: values.rawTitle,
            sourceEtag: values.sourceEtag,
            updatedAt: values.updatedAt,
          },
        });

      if (prior) {
        updated += 1;
        if (prior.date !== item.dateKey) affectedDates.add(prior.date);
      } else {
        inserted += 1;
      }
      affectedDates.add(item.dateKey);
    }

    // Reconcile deletions inside the window only. Completed tasks stay fetchable,
    // so absence here means deleted, unscheduled, or moved out of a synced list.
    let deleted = 0;
    for (const row of existing) {
      if (seen.has(row.sourceId)) continue;
      await db
        .delete(eventsTable)
        .where(
          and(
            eq(eventsTable.sourceType, SOURCE_TYPE),
            eq(eventsTable.sourceId, row.sourceId),
          ),
        );
      affectedDates.add(row.date);
      deleted += 1;
    }

    const dates = Array.from(affectedDates).sort();
    if (dates.length > 0) {
      await recomputeDailyTotalsForDates(dates);
    }

    console.log(
      `[ticktick-sync] ${lists.length} list(s), ${tasks.length} fetched → ` +
        `${inserted} inserted, ${updated} updated, ${skipped} skipped, ${deleted} deleted, ` +
        `${dates.length} date(s) recomputed`,
    );

    return {
      ok: true,
      lists: lists.length,
      fetched: tasks.length,
      inserted,
      updated,
      skipped,
      deleted,
      datesRecomputed: dates.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ticktick-sync] Error: ${message}`);
    return { ok: false, error: message };
  } finally {
    await client.close().catch(() => undefined);
  }
}
