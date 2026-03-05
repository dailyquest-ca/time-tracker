import { db } from './db';
import { categories } from './schema';

const DEFAULT_CATEGORIES = [
  'Learning',
  '1:1s',
  'General tasks/meetings',
] as const;

/**
 * Ensure default categories exist (idempotent). Call when loading categories for sync or API.
 */
export async function ensureDefaultCategories(): Promise<void> {
  const existing = await db.select().from(categories).limit(1);
  if (existing.length > 0) return;

  await db.insert(categories).values(
    DEFAULT_CATEGORIES.map((name, i) => ({
      name,
      archived: 0,
      displayOrder: i,
    })),
  );
}
