import { db } from '@/lib/db';
import { categories } from '@/lib/schema';
import { ensureDefaultCategories } from '@/lib/categories';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  await ensureDefaultCategories();
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      archived: categories.archived,
      displayOrder: categories.displayOrder,
    })
    .from(categories)
    .orderBy(categories.displayOrder, categories.name);
  return NextResponse.json({ data: rows });
}

/** Body: { categories: Array<{ id?: number, name: string, archived?: number }> } — replace all or update. */
export async function PATCH(request: NextRequest) {
  await ensureDefaultCategories();
  let body: { categories?: Array<{ id?: number; name: string; archived?: number }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const list = body?.categories;
  if (!Array.isArray(list)) {
    return NextResponse.json(
      { error: 'Body must include categories (array)' },
      { status: 400 },
    );
  }

  const activeCount = list.filter((c) => (c.archived ?? 0) === 0).length;
  if (activeCount === 0) {
    return NextResponse.json(
      { error: 'At least one active category is required' },
      { status: 400 },
    );
  }

  const existing = await db.select().from(categories);
  const byId = new Map(existing.map((r) => [r.id, r]));

  for (const item of list) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    if (item.id != null && byId.has(item.id)) {
      await db
        .update(categories)
        .set({
          name,
          archived: item.archived ?? 0,
        })
        .where(eq(categories.id, item.id));
    } else if (item.id == null) {
      await db.insert(categories).values({
        name,
        archived: item.archived ?? 0,
        displayOrder: existing.length + list.indexOf(item),
      });
    }
  }

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      archived: categories.archived,
      displayOrder: categories.displayOrder,
    })
    .from(categories)
    .orderBy(categories.displayOrder, categories.name);
  return NextResponse.json({ data: rows });
}
