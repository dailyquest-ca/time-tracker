/**
 * Categorize event title into a category, returning a category id.
 *
 * Multi-step algorithm:
 * 1. Extract leading acronym if present (e.g. "PIS Standup" -> "PIS").
 * 2. If acronym, try exact match against active categories.
 * 3. If acronym, try fuzzy match (Levenshtein distance <= 1) for typos.
 * 4. If acronym with no match, auto-create a new category and return its id.
 * 5. If not an acronym, try semantic keyword matching (Learning, 1:1s).
 * 6. Fall back to "General tasks/meetings".
 */

import { eq } from 'drizzle-orm';
import { db } from './db';
import { categories } from './schema';

/** Acronyms must be at least 3 letters (e.g. PIS, ELAN); 2-letter prefixes like "PO" are likely something else (e.g. Product Owner). */
const ACRONYM_RE = /^([A-Z0-9]{3,})(?:\s|$|[-:])/;

const BROAD_KEYWORDS: Record<string, string[]> = {
  Learning: ['learning', 'course', 'training', 'read', 'study'],
  '1:1s': ['1:1', 'one-on-one', '1-on-1', 'one on one'],
  'General tasks/meetings': [],
};

const DEFAULT_CATEGORY = 'General tasks/meetings';

export interface CategoryRow {
  id: number;
  name: string;
  archived: boolean;
}

export function extractAcronym(title: string): string | null {
  const m = title.trim().match(ACRONYM_RE);
  return m ? m[1] : null;
}

export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () =>
    Array(lb + 1).fill(0),
  );
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[la][lb];
}

export function resolveBroadCategory(title: string): string | null {
  const lower = title.toLowerCase();
  for (const [category, keywords] of Object.entries(BROAD_KEYWORDS)) {
    if (keywords.length === 0) continue;
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return null;
}

/**
 * Resolve category id for a new event, with auto-create for unknown acronyms.
 * Returns the category id to assign to the event.
 */
export async function resolveCategoryId(
  title: string,
  activeCategoriesSnapshot: CategoryRow[],
): Promise<number> {
  const active = activeCategoriesSnapshot.filter((c) => !c.archived);
  const acronym = extractAcronym(title);

  if (acronym) {
    const exactMatch = active.find(
      (c) => c.name.toUpperCase() === acronym.toUpperCase(),
    );
    if (exactMatch) return exactMatch.id;

    let bestMatch: CategoryRow | null = null;
    let bestDist = Infinity;
    for (const c of active) {
      const dist = levenshtein(acronym.toUpperCase(), c.name.toUpperCase());
      if (dist <= 1 && dist < bestDist) {
        bestDist = dist;
        bestMatch = c;
      }
    }
    if (bestMatch) return bestMatch.id;

    const [created] = await db
      .insert(categories)
      .values({
        name: acronym,
        kind: 'auto_created',
        archived: false,
        displayOrder: active.length,
      })
      .onConflictDoNothing()
      .returning({ id: categories.id });

    if (created) return created.id;

    const existing = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, acronym))
      .limit(1);
    if (existing.length > 0) return existing[0].id;
  }

  const broadName = resolveBroadCategory(title);
  if (broadName) {
    const match = active.find((c) => c.name === broadName);
    if (match) return match.id;
  }

  const defaultCat = active.find((c) => c.name === DEFAULT_CATEGORY);
  if (defaultCat) return defaultCat.id;

  if (active.length > 0) return active[0].id;

  const allCats = activeCategoriesSnapshot;
  if (allCats.length > 0) return allCats[0].id;

  throw new Error('No categories exist; cannot categorize event.');
}

/**
 * Simpler sync-compatible version: resolve from snapshot, return category id.
 * For backward-compat callers that just need a quick resolution without DB auto-create.
 */
export function resolveCategoryIdFromSnapshot(
  title: string,
  activeCategories: CategoryRow[],
): number | null {
  const active = activeCategories.filter((c) => !c.archived);
  const acronym = extractAcronym(title);

  if (acronym) {
    const exactMatch = active.find(
      (c) => c.name.toUpperCase() === acronym.toUpperCase(),
    );
    if (exactMatch) return exactMatch.id;

    let bestMatch: CategoryRow | null = null;
    let bestDist = Infinity;
    for (const c of active) {
      const dist = levenshtein(acronym.toUpperCase(), c.name.toUpperCase());
      if (dist <= 1 && dist < bestDist) {
        bestDist = dist;
        bestMatch = c;
      }
    }
    if (bestMatch) return bestMatch.id;
    return null;
  }

  const broadName = resolveBroadCategory(title);
  if (broadName) {
    const match = active.find((c) => c.name === broadName);
    if (match) return match.id;
  }

  const defaultCat = active.find((c) => c.name === DEFAULT_CATEGORY);
  if (defaultCat) return defaultCat.id;

  if (active.length > 0) return active[0].id;
  return null;
}
