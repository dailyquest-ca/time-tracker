/**
 * Categorize event title into a category name.
 * 1) If title starts with a capitalized acronym (e.g. PIS, ELAN), use it if it's an active category.
 * 2) Otherwise match broad categories by keywords (Learning, 1:1s, General tasks/meetings).
 * Only active (non-archived) categories are used for new events; otherwise fall back to default.
 */

const ACRONYM_RE = /^([A-Z0-9]{2,})(?:\s|$|[-:])/;

/** Broad category keywords: category name -> list of lowercase phrases to match in title. */
const BROAD_KEYWORDS: Record<string, string[]> = {
  Learning: ['learning', 'course', 'training', 'read', 'study'],
  '1:1s': ['1:1', 'one-on-one', '1-on-1', 'one on one'],
  'General tasks/meetings': [],
};

const DEFAULT_CATEGORY = 'General tasks/meetings';

export interface CategoryRow {
  id: number;
  name: string;
  archived: number;
}

/**
 * Extract potential acronym from start of title (e.g. "PIS Standup" -> "PIS").
 */
export function extractAcronym(title: string): string | null {
  const m = title.trim().match(ACRONYM_RE);
  return m ? m[1] : null;
}

/**
 * Resolve broad category from title keywords (no acronym match).
 */
function resolveBroadCategory(title: string): string {
  const lower = title.toLowerCase();
  for (const [category, keywords] of Object.entries(BROAD_KEYWORDS)) {
    if (keywords.length === 0) continue;
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return DEFAULT_CATEGORY;
}

/**
 * Resolve category for a new event.
 * If title starts with a capitalized acronym (e.g. ELAN, PIS), use it as the category.
 * Otherwise use broad categories (Learning, 1:1s, General) when they match or are active.
 */
export function resolveCategory(
  title: string,
  activeCategories: CategoryRow[]
): string {
  const activeNames = new Set(
    activeCategories.filter((c) => c.archived === 0).map((c) => c.name),
  );

  const acronym = extractAcronym(title);
  if (acronym) return acronym;

  const broad = resolveBroadCategory(title);
  if (activeNames.has(broad)) return broad;

  if (activeNames.has(DEFAULT_CATEGORY)) return DEFAULT_CATEGORY;
  if (activeNames.size > 0) return [...activeNames][0];
  return DEFAULT_CATEGORY;
}
