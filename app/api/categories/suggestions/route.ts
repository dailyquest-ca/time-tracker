import { db } from '@/lib/db';
import { categories, events } from '@/lib/schema';
import { extractAcronym } from '@/lib/categorize';
import { gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const SUGGESTION_DAYS = 90;

export async function GET() {
  const categoryNames = await db
    .select({ name: categories.name })
    .from(categories);
  const existingNames = new Set(categoryNames.map((r) => r.name));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SUGGESTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentEvents = await db
    .select({ name: events.name })
    .from(events)
    .where(gte(events.date, cutoffStr));
  const acronyms = new Set<string>();
  for (const row of recentEvents) {
    const name = row.name?.trim() ?? '';
    const ac = extractAcronym(name);
    if (ac && !existingNames.has(ac)) acronyms.add(ac);
  }
  const suggestedFromTitles = [...acronyms].sort();

  return NextResponse.json({
    suggestedFromSegments: [] as string[],
    suggestedFromTitles,
  });
}
