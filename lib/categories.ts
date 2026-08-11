import { eq } from 'drizzle-orm';
import { db } from './db';
import { categories } from './schema';

const DEFAULT_CATEGORIES = [
  { name: 'General tasks/meetings', kind: 'system' as const },
  { name: 'Learning', kind: 'system' as const },
  { name: '1:1s', kind: 'system' as const },
] as const;

/**
 * Ensure default categories exist (idempotent). Call when loading categories for sync or API.
 */
export async function ensureDefaultCategories(): Promise<void> {
  const existing = await db.select().from(categories).limit(1);
  if (existing.length > 0) return;

  await db.insert(categories).values(
    DEFAULT_CATEGORIES.map((c, i) => ({
      name: c.name,
      kind: c.kind,
      archived: false,
      displayOrder: i,
    })),
  );
}

/**
 * Look up a category by exact name, creating it if it does not exist yet.
 *
 * Used by sources that carry their own grouping (a TickTick list name) rather
 * than deriving a category from the event title. Concurrent callers race on the
 * unique name, so a lost insert falls back to reading the winner's row.
 */
export async function getOrCreateCategoryByName(name: string): Promise<number> {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const [created] = await db
    .insert(categories)
    .values({ name, kind: 'auto_created', archived: false, displayOrder: 0 })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  if (created) return created.id;

  const winner = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  if (winner.length > 0) return winner[0].id;

  throw new Error(`Could not create or find category "${name}"`);
}
