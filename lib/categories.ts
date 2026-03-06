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
