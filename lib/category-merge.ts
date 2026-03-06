import { eq } from 'drizzle-orm';
import { db } from './db';
import { events } from './schema';
import { recomputeDailyTotalsForDates } from './overtime';

/**
 * Merge source category into target: update events from sourceCategoryId to targetCategoryId.
 * Caller handles archiving the source category row.
 */
export async function mergeCategoryInto(
  sourceCategoryId: number,
  targetCategoryId: number,
): Promise<{ eventsUpdated: number; affectedDates: string[] }> {
  const sourceRows = await db
    .select({ date: events.date })
    .from(events)
    .where(eq(events.categoryId, sourceCategoryId));
  const targetRows = await db
    .select({ date: events.date })
    .from(events)
    .where(eq(events.categoryId, targetCategoryId));
  const affectedDates = [
    ...new Set([
      ...sourceRows.map((r) => r.date),
      ...targetRows.map((r) => r.date),
    ]),
  ];

  await db
    .update(events)
    .set({ categoryId: targetCategoryId, updatedAt: new Date() })
    .where(eq(events.categoryId, sourceCategoryId));

  if (affectedDates.length > 0) {
    await recomputeDailyTotalsForDates(affectedDates);
  }

  return { eventsUpdated: sourceRows.length, affectedDates };
}
