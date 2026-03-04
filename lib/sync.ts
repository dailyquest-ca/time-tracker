import { eq } from 'drizzle-orm';
import { db } from './db';
import { syncState, ticktickTokens, workSegments } from './schema';
import {
  getProjects,
  getTasks,
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
    const modifiedSince =
      syncRow?.lastModifiedTime ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [tasks, projects] = await Promise.all([
      getTasks(accessToken, { modifiedSince }),
      getProjects(accessToken),
    ]);

    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const affectedDates = new Set<string>();

    for (const task of tasks) {
      const dateKey = taskDateKey(task);
      if (isCompletedTaskWithDuration(task)) {
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
            tags: task.tags ?? [],
            category,
            durationMinutes,
          })
          .onConflictDoUpdate({
            target: [workSegments.ticktickTaskId, workSegments.date],
            set: {
              projectId: task.projectId,
              projectName,
              tags: task.tags ?? [],
              category,
              durationMinutes,
              syncedAt: new Date(),
            },
          });
      } else {
        const segmentsForTask = await db
          .select({ date: workSegments.date })
          .from(workSegments)
          .where(eq(workSegments.ticktickTaskId, task.id));
        segmentsForTask.forEach((s) => affectedDates.add(s.date));
        await db
          .delete(workSegments)
          .where(eq(workSegments.ticktickTaskId, task.id));
      }
    }

    const now = new Date();
    await db
      .insert(syncState)
      .values({
        userId: USER_ID,
        lastModifiedTime: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: syncState.userId,
        set: { lastModifiedTime: now, updatedAt: now },
      });

    if (affectedDates.size > 0) {
      await recomputeDailyTotalsForDates(Array.from(affectedDates));
    }

    return {
      ok: true,
      segmentsProcessed: tasks.filter(isCompletedTaskWithDuration).length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
