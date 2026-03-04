import { eq } from 'drizzle-orm';
import { db } from './db';
import { syncState, ticktickTokens, workSegments } from './schema';
import {
  getAllCompletedTasksV2,
  getProjects,
  isCompletedTaskWithDuration,
  refreshAccessToken,
  taskDateKey,
  taskDurationMinutes,
} from './ticktick';
import { recomputeDailyTotalsForDates } from './overtime';

const USER_ID = 'default';

/** Round duration to nearest 15 minutes (min 0). */
function roundToNearest15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round(minutes / 15) * 15;
}

async function getStoredTokens(): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
} | null> {
  const rows = await db
    .select()
    .from(ticktickTokens)
    .where(eq(ticktickTokens.userId, USER_ID))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    expiresAt: r.expiresAt,
  };
}

export async function getValidAccessToken(): Promise<string | null> {
  const stored = await getStoredTokens();
  if (!stored) return null;
  const now = new Date();
  const bufferMs = 60 * 1000;
  if (new Date(stored.expiresAt).getTime() - bufferMs > now.getTime()) {
    return stored.accessToken;
  }
  if (!stored.refreshToken?.trim()) {
    return null;
  }
  const refreshed = await refreshAccessToken(stored.refreshToken);
  const expiresAt = new Date(
    Date.now() + (refreshed.expires_in || 3600) * 1000
  );
  await db
    .update(ticktickTokens)
    .set({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || null,
      expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(ticktickTokens.userId, USER_ID));
  return refreshed.access_token;
}

export async function runSync(): Promise<{
  ok: boolean;
  error?: string;
  segmentsProcessed?: number;
}> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { ok: false, error: 'Not connected to TickTick. Connect in Settings.' };
  }

  try {
    const [syncRow] = await db
      .select()
      .from(syncState)
      .where(eq(syncState.userId, USER_ID))
      .limit(1);
    const since =
      syncRow?.lastModifiedTime ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const projects = await getProjects(accessToken);
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));

    console.log(
      `[sync] Fetching completed tasks via v2 API (since ${since.toISOString()}) across ${projects.filter((p) => !p.closed).length} project(s)…`,
    );

    const completedTasks = await getAllCompletedTasksV2(accessToken, {
      since,
      projects,
    });

    const timedTasks = completedTasks.filter(isCompletedTaskWithDuration);

    console.log(
      `[sync] v2 returned ${completedTasks.length} completed task(s), ${timedTasks.length} with duration`,
    );

    const affectedDates = new Set<string>();
    let segmentsProcessed = 0;

    for (const task of timedTasks) {
      const dateKey = taskDateKey(task);
      const projectName = projectMap.get(task.projectId) ?? task.projectId;
      const category = projectName;
      const durationMinutes = roundToNearest15(taskDurationMinutes(task));
      affectedDates.add(dateKey);

      await db
        .insert(workSegments)
        .values({
          ticktickTaskId: task.id,
          date: dateKey,
          projectId: task.projectId,
          projectName,
          taskTitle: task.title ?? null,
          tags: task.tags ?? [],
          category,
          durationMinutes,
          source: 'ticktick',
          startAt: task.startDate ? new Date(task.startDate) : null,
          endAt: task.dueDate ? new Date(task.dueDate) : null,
          completedAt: task.completedTime ? new Date(task.completedTime) : null,
        })
        .onConflictDoUpdate({
          target: [workSegments.ticktickTaskId, workSegments.date],
          set: {
            projectId: task.projectId,
            projectName,
            taskTitle: task.title ?? null,
            tags: task.tags ?? [],
            category,
            durationMinutes,
            source: 'ticktick',
            startAt: task.startDate ? new Date(task.startDate) : null,
            endAt: task.dueDate ? new Date(task.dueDate) : null,
            completedAt: task.completedTime ? new Date(task.completedTime) : null,
            syncedAt: new Date(),
          },
        });
      segmentsProcessed++;
    }

    // Advance watermark only when new tasks are found (based on completedTime, with 5-min buffer).
    const SAFETY_BUFFER_MS = 5 * 60 * 1000;
    let maxCompletedTime: Date | null = null;
    for (const t of timedTasks) {
      if (t.completedTime) {
        const ct = new Date(t.completedTime);
        if (!maxCompletedTime || ct > maxCompletedTime) maxCompletedTime = ct;
      }
    }
    const nextWatermark = maxCompletedTime
      ? new Date(maxCompletedTime.getTime() - SAFETY_BUFFER_MS)
      : since;

    const now = new Date();
    await db
      .insert(syncState)
      .values({
        userId: USER_ID,
        lastModifiedTime: nextWatermark,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: syncState.userId,
        set: { lastModifiedTime: nextWatermark, updatedAt: now },
      });

    if (affectedDates.size > 0) {
      await recomputeDailyTotalsForDates(Array.from(affectedDates));
    }

    return { ok: true, segmentsProcessed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync] Error: ${message}`);
    return { ok: false, error: message };
  }
}
