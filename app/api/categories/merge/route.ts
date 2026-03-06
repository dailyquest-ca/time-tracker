import { db } from '@/lib/db';
import { categories } from '@/lib/schema';
import { mergeCategoryInto } from '@/lib/category-merge';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  let body: { sourceName?: string; targetName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const sourceName = typeof body?.sourceName === 'string' ? body.sourceName.trim() : '';
  const targetName = typeof body?.targetName === 'string' ? body.targetName.trim() : '';
  if (!sourceName || !targetName) {
    return NextResponse.json(
      { error: 'sourceName and targetName are required' },
      { status: 400 },
    );
  }
  if (sourceName === targetName) {
    return NextResponse.json(
      { error: 'Source and target must be different' },
      { status: 400 },
    );
  }

  const allCategories = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories);
  const nameToId = new Map(allCategories.map((r) => [r.name, r.id]));
  const sourceId = nameToId.get(sourceName);
  const targetId = nameToId.get(targetName);

  if (sourceId == null) {
    return NextResponse.json(
      { error: `Category "${sourceName}" not found` },
      { status: 404 },
    );
  }
  if (targetId == null) {
    return NextResponse.json(
      { error: `Category "${targetName}" not found` },
      { status: 404 },
    );
  }

  const { eventsUpdated, affectedDates } = await mergeCategoryInto(
    sourceId,
    targetId,
  );
  await db
    .update(categories)
    .set({ archived: true, updatedAt: new Date() })
    .where(eq(categories.id, sourceId));

  return NextResponse.json({
    success: true,
    eventsUpdated,
    affectedDates,
  });
}
