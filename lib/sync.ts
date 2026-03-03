import { eq } from 'drizzle-orm';
import { db } from './db';
import {
  categoryMapping,
  syncState,
  ticktickTokens,
  workSegments,
  type WorkCategory,
} from './schema';
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

export type CategoryMappingRow = {
  type: 'project' | 'tag';
  value: string;
  category: WorkCategory;
};

async function getStoredTokens(): Promise<{
  accessToken: string;
  refreshToken: string;
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
  const refreshed = await refreshAccessToken(stored.refreshToken);
  const expiresAt = new Date(
    Date.now() + (refreshed.expires_in || 3600) * 1000
  );
  await db
    .update(ticktickTokens)
    .set({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(ticktickTokens.userId, USER_ID));
  return refreshed.access_token;
}

export async function getCategoryMappings(): Promise<CategoryMappingRow[]> {
  const rows = await db.select().from(categoryMapping);
  return rows.map((r) => ({
    type: r.type as 'project' | 'tag',
    value: r.value,
    category: r.category as WorkCategory,
  }));
}

function resolveCategory(
  projectId: string,
  projectName: string,
  tags: string[],
  mappings: CategoryMappingRow[]
): WorkCategory {
  for (const m of mappings) {
    if (m.type === 'project' && (m.value === projectId || m.value === projectName)) {
      return m.category;
    }
    if (m.type === 'tag' && tags.includes(m.value)) {
      return m.category;
    }
  }
  return 'general_task';
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

    const [tasks, projects, mappings] = await Promise.all([
      getTasks(accessToken, { modifiedSince }),
      getProjects(accessToken),
      getCategoryMappings(),
    ]);

    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const affectedDates = new Set<string>();

    for (const task of tasks) {
      const dateKey = taskDateKey(task);
      if (isCompletedTaskWithDuration(task)) {
        const projectName = projectMap.get(task.projectId) ?? task.projectId;
        const category = resolveCategory(
          task.projectId,
          projectName,
          task.tags ?? [],
          mappings
        );
        const durationMinutes = taskDurationMinutes(task);
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
