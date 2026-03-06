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

export async function PATCH(request: NextRequest) {
  await ensureDefaultCategories();
  let body: {
    categories?: Array<{
      id?: number;
      name: string;
      archived?: boolean;
      displayOrder?: number;
    }>;
  };
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

  const activeCount = list.filter((c) => !c.archived).length;
  if (activeCount === 0) {
    return NextResponse.json(
      { error: 'At least one active category is required' },
      { status: 400 },
    );
  }

  const existing = await db.select().from(categories);
  const byId = new Map(existing.map((r) => [r.id, r]));
  const existingNames = new Set(existing.map((r) => r.name));

  for (const item of list) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    if (item.id != null && byId.has(item.id)) {
      const row = byId.get(item.id)!;
      const nameChanged = row.name !== name;
      if (nameChanged && existingNames.has(name) && name !== row.name) {
        return NextResponse.json(
          { error: `Another category already has the name "${name}"` },
          { status: 400 },
        );
      }
      await db
        .update(categories)
        .set({
          name,
          archived: item.archived ?? row.archived,
          displayOrder:
            item.displayOrder !== undefined ? item.displayOrder : row.displayOrder,
          updatedAt: new Date(),
        })
        .where(eq(categories.id, item.id));
      if (nameChanged) {
        existingNames.delete(row.name);
        existingNames.add(name);
      }
    } else if (item.id == null) {
      if (existingNames.has(name)) {
        return NextResponse.json(
          { error: `Category "${name}" already exists` },
          { status: 400 },
        );
      }
      const maxOrder =
        existing.length === 0
          ? 0
          : Math.max(...existing.map((r) => r.displayOrder), 0);
      await db.insert(categories).values({
        name,
        archived: item.archived ?? false,
        displayOrder:
          item.displayOrder !== undefined
            ? item.displayOrder
            : maxOrder + 1 + list.indexOf(item),
      });
      existingNames.add(name);
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
