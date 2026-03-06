import { and, gte, lte, inArray } from 'drizzle-orm';
import { db } from './db';
import { categories, events } from './schema';
import { extractAcronym } from './categorize';
import { recomputeDailyTotalsForDates } from './overtime';

const BROAD_CATEGORY_NAMES = new Set([
  'General tasks/meetings',
  'Learning',
  '1:1s',
]);

const MIN_CLUSTER_SIZE = 3;
const MAX_SAMPLE_EVENTS = 5;

export interface EventRow {
  id: number;
  name: string;
  date: string;
  categoryId: number;
  lengthHours: string;
}

export interface ReclassifyProposal {
  id: string;
  pattern: string;
  matchType: 'acronym' | 'prefix';
  eventCount: number;
  totalHours: number;
  currentCategories: Record<string, number>;
  suggestedCategoryId: number | null;
  suggestedCategoryName: string;
  eventIds: number[];
  sampleEvents: Array<{
    id: number;
    name: string;
    date: string;
    lengthHours: string;
  }>;
}

export function getAllowedWindow(
  now: Date = new Date(),
): { from: string; to: string } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const prevMonth = new Date(year, month - 1, 1);
  const endOfCurrent = new Date(year, month + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}-01`,
    to: `${endOfCurrent.getFullYear()}-${pad(endOfCurrent.getMonth() + 1)}-${pad(endOfCurrent.getDate())}`,
  };
}

/**
 * Pure clustering function: finds recategorization opportunities
 * among events currently sitting in broad/catch-all categories.
 */
export function clusterRecentEvents(
  eventRows: EventRow[],
  categoryNameById: Record<number, string>,
): ReclassifyProposal[] {
  const broadCategoryIds = new Set(
    Object.entries(categoryNameById)
      .filter(([, name]) => BROAD_CATEGORY_NAMES.has(name))
      .map(([id]) => Number(id)),
  );

  const inBroad = eventRows.filter((e) => broadCategoryIds.has(e.categoryId));
  if (inBroad.length === 0) return [];

  const proposals: ReclassifyProposal[] = [];
  const claimedEventIds = new Set<number>();

  // Pass 1: Acronym clusters
  const acronymBuckets = new Map<string, EventRow[]>();
  for (const evt of inBroad) {
    const ac = extractAcronym(evt.name);
    if (!ac) continue;
    const key = ac.toUpperCase();
    if (!acronymBuckets.has(key)) acronymBuckets.set(key, []);
    acronymBuckets.get(key)!.push(evt);
  }

  for (const [acronym, bucket] of acronymBuckets) {
    if (bucket.length < MIN_CLUSTER_SIZE) continue;

    const existingCat = Object.entries(categoryNameById).find(
      ([, name]) =>
        name.toUpperCase() === acronym && !BROAD_CATEGORY_NAMES.has(name),
    );

    const totalHours = bucket.reduce(
      (s, e) => s + parseFloat(e.lengthHours || '0'),
      0,
    );

    const currentCategories: Record<string, number> = {};
    for (const e of bucket) {
      const catName = categoryNameById[e.categoryId] ?? 'Unknown';
      currentCategories[catName] = (currentCategories[catName] ?? 0) + 1;
    }

    const displayAcronym =
      bucket[0] ? extractAcronym(bucket[0].name) ?? acronym : acronym;

    proposals.push({
      id: `acronym:${acronym}`,
      pattern: displayAcronym,
      matchType: 'acronym',
      eventCount: bucket.length,
      totalHours,
      currentCategories,
      suggestedCategoryId: existingCat ? Number(existingCat[0]) : null,
      suggestedCategoryName: displayAcronym,
      eventIds: bucket.map((e) => e.id),
      sampleEvents: bucket.slice(0, MAX_SAMPLE_EVENTS).map((e) => ({
        id: e.id,
        name: e.name,
        date: e.date,
        lengthHours: e.lengthHours,
      })),
    });

    for (const e of bucket) claimedEventIds.add(e.id);
  }

  // Pass 2: Title prefix clusters (first word, 3+ chars, capitalized)
  const prefixBuckets = new Map<string, EventRow[]>();
  for (const evt of inBroad) {
    if (claimedEventIds.has(evt.id)) continue;
    const firstWord = evt.name.trim().split(/\s+/)[0];
    if (!firstWord || firstWord.length < 3) continue;
    if (/^[A-Z0-9]{3,}$/.test(firstWord)) continue; // already handled as acronym
    const key = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
    if (!prefixBuckets.has(key)) prefixBuckets.set(key, []);
    prefixBuckets.get(key)!.push(evt);
  }

  for (const [prefix, bucket] of prefixBuckets) {
    if (bucket.length < MIN_CLUSTER_SIZE) continue;

    const existingCat = Object.entries(categoryNameById).find(
      ([, name]) =>
        name.toLowerCase() === prefix.toLowerCase() &&
        !BROAD_CATEGORY_NAMES.has(name),
    );

    const totalHours = bucket.reduce(
      (s, e) => s + parseFloat(e.lengthHours || '0'),
      0,
    );

    const currentCategories: Record<string, number> = {};
    for (const e of bucket) {
      const catName = categoryNameById[e.categoryId] ?? 'Unknown';
      currentCategories[catName] = (currentCategories[catName] ?? 0) + 1;
    }

    proposals.push({
      id: `prefix:${prefix.toLowerCase()}`,
      pattern: prefix,
      matchType: 'prefix',
      eventCount: bucket.length,
      totalHours,
      currentCategories,
      suggestedCategoryId: existingCat ? Number(existingCat[0]) : null,
      suggestedCategoryName: prefix,
      eventIds: bucket.map((e) => e.id),
      sampleEvents: bucket.slice(0, MAX_SAMPLE_EVENTS).map((e) => ({
        id: e.id,
        name: e.name,
        date: e.date,
        lengthHours: e.lengthHours,
      })),
    });
  }

  proposals.sort((a, b) => b.eventCount - a.eventCount);
  return proposals;
}

/**
 * Fetch recent events and build recategorization proposals.
 */
export async function getRecategorizationSuggestions(
  now?: Date,
): Promise<ReclassifyProposal[]> {
  const window = getAllowedWindow(now);

  const eventRows = await db
    .select({
      id: events.id,
      name: events.name,
      date: events.date,
      categoryId: events.categoryId,
      lengthHours: events.lengthHours,
    })
    .from(events)
    .where(and(gte(events.date, window.from), lte(events.date, window.to)));

  const catRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories);

  const catMap: Record<number, string> = {};
  for (const c of catRows) catMap[c.id] = c.name;

  return clusterRecentEvents(eventRows, catMap);
}

/**
 * Preview which events would be affected by a reclassification.
 */
export async function previewReclassification(
  pattern: string,
  matchType: 'acronym' | 'prefix',
  fromCategoryIds: number[],
  now?: Date,
): Promise<EventRow[]> {
  const window = getAllowedWindow(now);

  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      date: events.date,
      categoryId: events.categoryId,
      lengthHours: events.lengthHours,
    })
    .from(events)
    .where(
      and(
        gte(events.date, window.from),
        lte(events.date, window.to),
        inArray(events.categoryId, fromCategoryIds),
      ),
    );

  return rows.filter((e) => eventMatchesPattern(e.name, pattern, matchType));
}

function eventMatchesPattern(
  title: string,
  pattern: string,
  matchType: 'acronym' | 'prefix',
): boolean {
  if (matchType === 'acronym') {
    const ac = extractAcronym(title);
    return ac !== null && ac.toUpperCase() === pattern.toUpperCase();
  }
  const firstWord = title.trim().split(/\s+/)[0] ?? '';
  return firstWord.toLowerCase() === pattern.toLowerCase();
}

/**
 * Apply a bulk recategorization within the allowed window.
 * Returns the count of updated events and affected dates.
 */
export async function applyReclassification(
  eventIds: number[],
  targetCategoryId: number,
  now?: Date,
): Promise<{ eventsUpdated: number; affectedDates: string[] }> {
  if (eventIds.length === 0) return { eventsUpdated: 0, affectedDates: [] };

  const window = getAllowedWindow(now);

  const matching = await db
    .select({ id: events.id, date: events.date })
    .from(events)
    .where(
      and(
        inArray(events.id, eventIds),
        gte(events.date, window.from),
        lte(events.date, window.to),
      ),
    );

  const validIds = matching.map((r) => r.id);
  const affectedDates = [...new Set(matching.map((r) => r.date))];

  if (validIds.length === 0) return { eventsUpdated: 0, affectedDates: [] };

  await db
    .update(events)
    .set({ categoryId: targetCategoryId, updatedAt: new Date() })
    .where(inArray(events.id, validIds));

  if (affectedDates.length > 0) {
    await recomputeDailyTotalsForDates(affectedDates);
  }

  return { eventsUpdated: validIds.length, affectedDates };
}
