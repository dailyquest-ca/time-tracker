/**
 * TickTick task shapes and the rules for turning a task into tracked time.
 *
 * Data reaches this app from the **TickTick MCP connector**, which is OAuth-bound
 * to the user's Claude account and therefore only reachable from a Claude session
 * — not from this app's server runtime. A scheduled Claude session reads TickTick
 * over MCP and POSTs batches to `/api/ingest/ticktick`, which uses these helpers.
 *
 * Everything here is pure and transport-agnostic: it describes the task shape the
 * MCP returns, so it is unit-testable without network or database access.
 */

/** A task as returned by the TickTick MCP (`filter_tasks`, `list_completed_tasks_by_date`, ...). */
export interface TickTickTask {
  id: string;
  projectId: string;
  title: string;
  /** 0 = undone. 1 (v1) and 2 (v2) both mean completed. */
  status: number;
  startDate?: string | null;
  dueDate?: string | null;
  isAllDay?: boolean | null;
  timeZone?: string | null;
  completedTime?: string | null;
  modifiedTime?: string | null;
  /** Upstream version marker; changes on every modification. */
  etag?: string | null;
  kind?: string | null;
}

/** A list ("project") as returned by the TickTick MCP `list_projects`. */
export interface TickTickProject {
  id: string;
  name: string;
  /** Folder ("project group") the list belongs to; null when the list is top-level. */
  groupId?: string | null;
  closed?: boolean | null;
  kind?: string | null;
}

/**
 * The app buckets every source by Vancouver day so a TickTick task and a calendar
 * event at the same instant land on the same date. See `eventDateKey` in
 * `lib/google-calendar-sync.ts`; a UTC `toISOString().slice(0, 10)` is a bug here.
 */
const TRACKING_TIME_ZONE = 'America/Vancouver';

/** Leading characters that are neither letters nor digits — emoji, ZWJ, variation selectors. */
const LEADING_SYMBOLS_RE = /^[^\p{L}\p{N}]+/u;

/**
 * Turn a TickTick list name into a category name by dropping its leading emoji,
 * so "🤖ELAN" and "📄ELAN" both collapse onto the existing "ELAN" category.
 * Falls back to the original name when stripping would leave nothing.
 */
export function listNameToCategory(listName: string): string {
  const stripped = listName.replace(LEADING_SYMBOLS_RE, '').trim();
  return stripped.length > 0 ? stripped : listName;
}

/** Completed in either the v1 (status 1) or v2 (status 2) encoding. */
export function isCompletedTask(task: TickTickTask): boolean {
  return task.status !== 0;
}

/** Minutes between start and due; 0 when either bound is missing. */
export function taskDurationMinutes(task: TickTickTask): number {
  if (!task.startDate || !task.dueDate) return 0;
  const start = new Date(task.startDate).getTime();
  const end = new Date(task.dueDate).getTime();
  if (isNaN(start) || isNaN(end)) return 0;
  return Math.round((end - start) / 60_000);
}

/**
 * Only tasks with a real scheduled span become tracked time. All-day and undated
 * tasks are skipped, mirroring how the calendar sync skips all-day events.
 */
export function isTimedTask(task: TickTickTask): boolean {
  if (task.isAllDay) return false;
  if (!task.startDate || !task.dueDate) return false;
  return taskDurationMinutes(task) > 0;
}

/** Calendar day (YYYY-MM-DD) the task belongs to, in Vancouver time. */
export function taskDateKey(task: TickTickTask): string | null {
  if (!task.startDate) return null;
  const start = new Date(task.startDate);
  if (isNaN(start.getTime())) return null;
  return start.toLocaleDateString('en-CA', { timeZone: TRACKING_TIME_ZONE });
}

/**
 * Stable identity for the `events` unique key (sourceType, sourceId).
 * TickTick task ids are unique account-wide and survive a move between lists,
 * so re-syncing a moved task updates its row instead of duplicating it.
 */
export function ticktickSourceId(task: TickTickTask): string {
  return task.id;
}

/** Today's date (YYYY-MM-DD) in Vancouver time. */
export function todayInVancouver(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: TRACKING_TIME_ZONE });
}

/**
 * TickTick issues no refresh token, so an expiring access token is a manual fix
 * (re-run the spike, re-seed). Tokens live ~180 days, which means this comes up
 * about twice a year — long enough to have forgotten it exists — so warn a month
 * out rather than a fortnight.
 */
export const TOKEN_EXPIRY_WARNING_DAYS = 30;

export type TokenExpiryState = 'unknown' | 'valid' | 'expiring_soon' | 'expired';

export interface TokenExpiry {
  state: TokenExpiryState;
  /** Whole days until expiry; negative once past. Null when unknown. */
  daysRemaining: number | null;
}

/** How much life the stored access token has left. */
export function tokenExpiryStatus(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): TokenExpiry {
  if (expiresAt == null) return { state: 'unknown', daysRemaining: null };

  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (isNaN(expiry.getTime())) return { state: 'unknown', daysRemaining: null };

  const msRemaining = expiry.getTime() - now.getTime();
  const daysRemaining = Math.floor(msRemaining / (24 * 60 * 60 * 1000));

  if (msRemaining <= 0) return { state: 'expired', daysRemaining };
  if (daysRemaining <= TOKEN_EXPIRY_WARNING_DAYS) {
    return { state: 'expiring_soon', daysRemaining };
  }
  return { state: 'valid', daysRemaining };
}

/**
 * Lists in a given TickTick folder that can hold trackable time.
 *
 * Selection is by folder membership rather than a hardcoded id table, so a list
 * added to the folder later is synced with no code change. Note lists hold no
 * time, and archived lists are historical.
 */
export function selectFolderLists(
  projects: TickTickProject[],
  folderId: string,
): TickTickProject[] {
  return projects.filter(
    (p) => p.groupId === folderId && p.kind !== 'NOTE' && p.closed !== true,
  );
}

/** One TickTick list plus the tasks the poller read from it. */
export interface IngestList {
  id: string;
  name: string;
  tasks: TickTickTask[];
}

/** A task that qualifies as tracked time, with everything the upsert needs. */
export interface IngestableItem {
  task: TickTickTask;
  listId: string;
  /** Raw list name, kept for display (e.g. "🤖ELAN"). */
  listName: string;
  /** Category the event is filed under — the list name without its emoji. */
  categoryName: string;
  dateKey: string;
  durationMinutes: number;
  completed: boolean;
}

/**
 * Pick the tasks that should become tracked time: timed (not all-day, not
 * undated) and dated `today` or later.
 *
 * Completed tasks are kept — finished work is the most real time there is, and
 * dropping it would erase hours the user actually spent.
 *
 * A task appearing in more than one list is taken from the first list that
 * carries it, so a single task can never be counted twice.
 */
export function selectIngestableItems(
  lists: IngestList[],
  today: string,
): IngestableItem[] {
  const items: IngestableItem[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const task of list.tasks ?? []) {
      if (!isTimedTask(task)) continue;

      const dateKey = taskDateKey(task);
      if (dateKey == null || dateKey < today) continue;

      const sourceId = ticktickSourceId(task);
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);

      items.push({
        task,
        listId: list.id,
        listName: list.name,
        categoryName: listNameToCategory(list.name),
        dateKey,
        durationMinutes: taskDurationMinutes(task),
        completed: isCompletedTask(task),
      });
    }
  }

  return items;
}
